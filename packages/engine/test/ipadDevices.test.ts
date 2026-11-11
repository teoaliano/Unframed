import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type TestEngine } from "./harness.ts";
import { deviceRequest, deviceRpc, deviceSocket, ipadPortOf, readAuthority, startIpadEngine, TEST_NAME } from "./ipadClient.ts";

const IPAD_AGENT = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
const PAIR_FIRST = "Pair this device in Unframed's Settings on your Mac.";
const MAC_ONLY = "This works only in Unframed on your Mac.";

const start = (options: { hosted?: boolean } = {}): Promise<TestEngine> => startIpadEngine(options);

const attempt = (port: number, ca: string, code: string, userAgent = IPAD_AGENT) =>
  deviceRequest(port, ca, "/api/ipad/pair", {
    method: "POST",
    body: `code=${code}`,
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": userAgent },
  });

const tokenOf = (setCookie: string | undefined): string => /unframed_device=([0-9a-f]+)/.exec(setCookie ?? "")?.[1] ?? "";

interface Paired {
  readonly engine: TestEngine;
  readonly port: number;
  readonly ca: string;
  readonly token: string;
}

const paired = async (options: { hosted?: boolean } = {}): Promise<Paired> => {
  const engine = await start(options);
  const port = await ipadPortOf(engine);
  const ca = await readAuthority(engine.dataDir);
  const started = await (await engine.rpc()).call("ipad.pairStart");
  const answer = await attempt(port, ca, started.code);
  return { engine, port, ca, token: tokenOf(answer.headers["set-cookie"]?.[0]) };
};

describe("pairing a device", () => {
  it("answers a six-digit code, the link the QR carries, and five minutes", async () => {
    const engine = await start();
    const port = await ipadPortOf(engine);
    const started = await (await engine.rpc()).call("ipad.pairStart");
    expect(started.code).toMatch(/^\d{6}$/);
    expect(started.url).toBe(`https://${TEST_NAME}:${port}/pair?code=${started.code}`);
    const left = Date.parse(started.expiresAt) - Date.now();
    expect(left).toBeGreaterThan(4 * 60_000);
    expect(left).toBeLessThanOrEqual(5 * 60_000);
  });

  it("refuses to start pairing while iPad access is off", async () => {
    const engine = await startIpadEngine({ access: false, hosted: false });
    await expect((await engine.rpc()).call("ipad.pairStart")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("sets a cookie the engine keeps only as a hash", async () => {
    const { engine, token } = await paired();
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const path = join(engine.dataDir, "ipad-devices.json");
    expect(((await stat(path)).mode & 0o777).toString(8)).toBe("600");
    const text = await readFile(path, "utf8");
    expect(text).not.toContain(token);
    expect(JSON.parse(text).devices[0].tokenSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sets the cookie with the flags a shared device needs", async () => {
    const engine = await start();
    const port = await ipadPortOf(engine);
    const ca = await readAuthority(engine.dataDir);
    const started = await (await engine.rpc()).call("ipad.pairStart");
    const answer = await attempt(port, ca, started.code);
    const cookie = String(answer.headers["set-cookie"]?.[0]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=34560000");
    expect(answer.headers.location).toBe("/");
  });

  it("uses a code once, and locks it after five wrong tries", async () => {
    const engine = await start();
    const port = await ipadPortOf(engine);
    const ca = await readAuthority(engine.dataDir);
    const rpc = await engine.rpc();

    const started = await rpc.call("ipad.pairStart");
    const again = await attempt(port, ca, started.code);
    expect(again.status).toBe(303);
    const reused = await attempt(port, ca, started.code);
    expect(reused.status).toBe(400);
    expect(reused.text).toContain("That code is not right.");

    await rpc.call("ipad.pairStart");
    for (const wrong of ["000001", "000002", "000003", "000004"]) {
      const answer = await attempt(port, ca, wrong);
      expect(answer.text).toContain("That code is not right.");
    }
    const locked = await attempt(port, ca, "000005");
    expect(locked.text).toContain("This code is locked. Start pairing again on your Mac.");
  });

  it("names the device after what it looks like and the day it paired", async () => {
    const { engine } = await paired();
    const { devices } = await (await engine.rpc()).call("ipad.devices");
    expect(devices).toHaveLength(1);
    expect(devices[0]?.name).toMatch(/^iPad \(\d{1,2} \w{3} \d{4}\)$/);
    expect(devices[0]?.pairedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("what a paired device reaches", () => {
  it("gets the app and its assets, and the routes the API listener serves", async () => {
    const { engine, port, ca, token } = await paired();
    expect((await deviceRequest(port, ca, "/", { token })).status).toBe(200);
    expect((await deviceRequest(port, ca, "/assets/app.js", { token })).status).toBe(200);
    expect((await deviceRequest(port, ca, "/api/file/default/missing.png", { token })).status).toBe(404);
    await (await engine.rpc()).call("projects.create", { name: "sketches" });
    const rpc = await deviceRpc(port, ca, token);
    expect((await rpc.call("projects.list")).projects).toContain("sketches");
  });

  it("never reaches the OAuth callback or the MCP endpoint", async () => {
    const { engine, port, ca, token } = await paired();
    expect((await deviceRequest(port, ca, "/api/oauth/callback/abc", { token })).status).toBe(404);
    expect((await deviceRequest(port, ca, "/mcp", { token, method: "POST", body: "{}" })).status).toBe(404);
    expect((await engine.request("/mcp", { method: "POST", body: "{}" })).status).not.toBe(404);
  });

  it("is told which listener it came through, and the Mac is told too", async () => {
    const { engine, port, ca, token } = await paired();
    const device = await deviceRpc(port, ca, token);
    expect((await device.call("server.health")).client).toBe("device");
    expect((await (await engine.rpc()).call("server.health")).client).toBe("mac");
  });
});

describe("what only the Mac may do", () => {
  it.each([
    ["files.reveal", { fileNames: [] }],
    ["files.path", { project: "default", fileName: "a.png" }],
    ["settings.pickFolder", {}],
    ["oauth.start", {}],
    ["oauth.cancel", {}],
    ["agentConnections.create", { name: "x", client: "other" }],
    ["agentConnections.revoke", { id: "x" }],
    ["ipad.pairStart", {}],
    ["ipad.devices", {}],
    ["ipad.revoke", { id: "x" }],
    ["ipad.exportProfile", {}],
  ])("refuses %s from a device", async (method, payload) => {
    const { port, ca, token } = await paired();
    const rpc = await deviceRpc(port, ca, token);
    await expect((rpc.call as (m: string, p: unknown) => Promise<unknown>)(method, payload)).rejects.toMatchObject({
      code: "mac_only",
      message: MAC_ONLY,
    });
  });

  it("refuses a settings write of the iPad variables, and allows the others", async () => {
    const { port, ca, token } = await paired();
    const rpc = await deviceRpc(port, ca, token);
    await expect(rpc.call("settings.update", { ipadAccess: "" })).rejects.toMatchObject({ code: "mac_only" });
    await expect(rpc.call("settings.update", { ipadPort: "18999" })).rejects.toMatchObject({ code: "mac_only" });
    expect(await rpc.call("settings.update", { imageModel: "openai/gpt-image-2" })).toMatchObject({ imageModel: "openai/gpt-image-2" });
  });

  it("refuses a write of the Mac's tabs, and allows another preference", async () => {
    const { port, ca, token } = await paired();
    const rpc = await deviceRpc(port, ca, token);
    await expect(rpc.call("preferences.set", { key: "project.tabs", value: { order: [] } })).rejects.toMatchObject({ code: "mac_only" });
    await expect(rpc.call("preferences.set", { key: "project.active", value: "default" })).rejects.toMatchObject({ code: "mac_only" });
    expect(await rpc.call("preferences.set", { key: "canvas.theme", value: "dark" })).toEqual({});
  });

  it("lets a device read its own status", async () => {
    const { port, ca, token } = await paired();
    const rpc = await deviceRpc(port, ca, token);
    expect((await rpc.call("ipad.status")).listening).toBe(true);
  });
});

describe("revoking a device", () => {
  it("cuts its sockets at once and refuses it from then on", async () => {
    const { engine, port, ca, token } = await paired();
    const socket = deviceSocket(port, ca, "/ws", { token });
    await new Promise<void>((done, fail) => {
      socket.on("open", () => done());
      socket.on("error", fail);
    });
    const closed = new Promise<number>((done) => socket.on("close", (code) => done(code)));

    const rpc = await engine.rpc();
    const { devices } = await rpc.call("ipad.devices");
    await rpc.call("ipad.revoke", { id: devices[0]!.id });

    expect(await Promise.race([closed, new Promise((done) => setTimeout(() => done(0), 1000))])).toBe(1008);
    expect((await rpc.call("ipad.devices")).devices).toEqual([]);
    const refused = await deviceRequest(port, ca, "/", { token, headers: { accept: "application/json" } });
    expect(refused.status).toBe(401);
    expect(refused.json().error).toBe(PAIR_FIRST);
  });

  it("is not there to revoke twice", async () => {
    const { engine } = await paired();
    const rpc = await engine.rpc();
    const { devices } = await rpc.call("ipad.devices");
    await rpc.call("ipad.revoke", { id: devices[0]!.id });
    await expect(rpc.call("ipad.revoke", { id: devices[0]!.id })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("turning the switch off", () => {
  it("closes the device's sockets with 1001 and keeps the pairing", async () => {
    const { engine, port, ca, token } = await paired();
    const socket = deviceSocket(port, ca, "/ws", { token });
    await new Promise<void>((done, fail) => {
      socket.on("open", () => done());
      socket.on("error", fail);
    });
    const closed = new Promise<number>((done) => socket.on("close", (code) => done(code)));

    const rpc = await engine.rpc();
    await rpc.call("settings.update", { ipadAccess: "" });
    expect(await Promise.race([closed, new Promise((done) => setTimeout(() => done(0), 1000))])).toBe(1001);
    expect((await rpc.call("ipad.devices")).devices).toHaveLength(1);

    await rpc.call("settings.update", { ipadAccess: "on" });
    const again = await ipadPortOf(engine);
    expect((await deviceRequest(again, ca, "/", { token })).status).toBe(200);
  });
});

describe("keeping the Mac awake", () => {
  it("asks for it at the first device socket and lets it go after the last", async () => {
    const { engine, port, ca, token } = await paired();
    const socket = deviceSocket(port, ca, "/ws", { token });
    await new Promise<void>((done, fail) => {
      socket.on("open", () => done());
      socket.on("error", fail);
    });
    await engine.waitForMessage((message) => message.type === "keep-awake" && message.on);

    socket.close();
    await engine.waitForMessage((message) => message.type === "keep-awake" && !message.on);
  });

  it("says nothing when the engine is not hosted", async () => {
    const { engine, port, ca, token } = await paired({ hosted: false });
    const socket = deviceSocket(port, ca, "/ws", { token });
    await new Promise<void>((done, fail) => {
      socket.on("open", () => done());
      socket.on("error", fail);
    });
    await new Promise((done) => setTimeout(done, 1000));
    expect(engine.messages.filter((message) => message.type === "keep-awake")).toEqual([]);
  });
});
