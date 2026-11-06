import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type TestEngine } from "./harness.ts";
import { deviceRequest, deviceSocket, ipadPortOf, readAuthority, startIpadEngine, TEST_NAME } from "./ipadClient.ts";

const freePort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
};

const pairDevice = async (engine: TestEngine, port: number, ca: string, userAgent = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"): Promise<string> => {
  const started = await (await engine.rpc()).call("ipad.pairStart");
  const answer = await deviceRequest(port, ca, "/api/ipad/pair", {
    method: "POST",
    body: `code=${started.code}`,
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": userAgent },
  });
  expect(answer.status).toBe(303);
  const cookie = String(answer.headers["set-cookie"]?.[0] ?? "");
  const token = /unframed_device=([0-9a-f]+)/.exec(cookie)?.[1];
  if (token === undefined) throw new Error(`no device cookie in ${cookie}`);
  return token;
};

describe("the iPad listener", () => {
  it("is up with the switch on and gone without it", async () => {
    const engine = await startIpadEngine();
    const rpc = await engine.rpc();
    const port = await ipadPortOf(engine);
    expect(port).toBeGreaterThan(0);

    await rpc.call("settings.update", { ipadAccess: "" });
    const off = await rpc.call("ipad.status");
    expect(off.listening).toBe(false);
    await expect(deviceRequest(port, await readAuthority(engine.dataDir), "/")).rejects.toThrow();
  });

  it("stays off with no switch, and the engine boots as usual", async () => {
    const engine = await startIpadEngine({ access: false });
    expect(await (await engine.rpc()).call("ipad.status")).toMatchObject({ listening: false, portTaken: false });
  });

  it("leaves the port alone and finishes the boot when another app holds it", async () => {
    const other = createServer((_req, res) => res.end("someone else"));
    await new Promise<void>((done) => other.listen(0, "0.0.0.0", done));
    const address = other.address();
    const taken = typeof address === "object" && address !== null ? address.port : 0;
    try {
      const engine = await startIpadEngine({ port: String(taken) });
      expect(await (await engine.rpc()).call("ipad.status")).toMatchObject({ listening: false, portTaken: true, port: taken });
      expect(engine.stdout()).toContain(`port ${taken} is in use by another app`);
    } finally {
      other.close();
    }
  });

  it("serves the app to a paired device over TLS it signed itself", async () => {
    const engine = await startIpadEngine();
    const port = await ipadPortOf(engine);
    const ca = await readAuthority(engine.dataDir);
    const token = await pairDevice(engine, port, ca);
    const page = await deviceRequest(port, ca, "/", { token });
    expect(page.status).toBe(200);
    expect(page.text).toContain("<title>Unframed</title>");
  });
});

describe("changing the port", () => {
  it("moves the listener and closes the device's sockets with 1001", async () => {
    const engine = await startIpadEngine();
    const port = await ipadPortOf(engine);
    const ca = await readAuthority(engine.dataDir);
    const rpc = await engine.rpc();

    const started = await rpc.call("ipad.pairStart");
    const answer = await deviceRequest(port, ca, "/api/ipad/pair", {
      method: "POST",
      body: `code=${started.code}`,
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" },
    });
    const token = /unframed_device=([0-9a-f]+)/.exec(String(answer.headers["set-cookie"]?.[0]))?.[1] ?? "";
    const socket = deviceSocket(port, ca, "/ws", { token });
    await new Promise<void>((done, fail) => {
      socket.on("open", () => done());
      socket.on("error", fail);
    });
    const closed = new Promise<number>((done) => socket.on("close", (code) => done(code)));

    const next = await freePort();
    await rpc.call("settings.update", { ipadPort: String(next) });
    expect(await Promise.race([closed, new Promise((done) => setTimeout(() => done(0), 1000))])).toBe(1001);

    const moved = await (await engine.rpc()).call("ipad.status");
    expect(moved).toMatchObject({ listening: true, port: next });
    const page = await deviceRequest(next, ca, "/", { token, host: `${TEST_NAME}:${next}` });
    expect(page.status).toBe(200);
    await expect(deviceRequest(port, ca, "/", { token })).rejects.toThrow();
  });
});

describe("the device guard", () => {
  it("refuses a Host that is not this Mac's name at this port", async () => {
    const engine = await startIpadEngine();
    const port = await ipadPortOf(engine);
    const ca = await readAuthority(engine.dataDir);
    for (const host of [`127.0.0.1:${port}`, `mbp-other.local:${port}`, `${TEST_NAME}:1`, TEST_NAME]) {
      const answer = await deviceRequest(port, ca, "/", { host });
      expect(answer.status).toBe(403);
      expect(answer.json().error).toBe(`Open Unframed at https://${TEST_NAME}:${port}.`);
    }
  });

  it("refuses a foreign Origin and allows its own", async () => {
    const engine = await startIpadEngine();
    const port = await ipadPortOf(engine);
    const ca = await readAuthority(engine.dataDir);
    const foreign = await deviceRequest(port, ca, "/pair", { headers: { origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
    expect(foreign.json().error).toBe("Unframed answers only same-machine requests.");
    const own = await deviceRequest(port, ca, "/pair", { headers: { origin: `https://${TEST_NAME}:${port}` } });
    expect(own.status).toBe(200);
  });

  it("carries no CORS allow header", async () => {
    const engine = await startIpadEngine();
    const port = await ipadPortOf(engine);
    const answer = await deviceRequest(port, await readAuthority(engine.dataDir), "/pair");
    expect(answer.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("destroys a connection from an address it does not accept", async () => {
    const lan = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .find((entry) => entry.family === "IPv4" && !entry.internal);
    if (lan === undefined) return;
    const engine = await startIpadEngine();
    const port = await ipadPortOf(engine);
    const ca = await readAuthority(engine.dataDir);
    await expect(deviceRequest(port, ca, "/pair", { address: lan.address })).rejects.toThrow();
  });
});

describe("an unpaired device", () => {
  it("lands on the pairing page, and app code is refused", async () => {
    const engine = await startIpadEngine();
    const port = await ipadPortOf(engine);
    const ca = await readAuthority(engine.dataDir);

    const navigation = await deviceRequest(port, ca, "/", { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
    expect(navigation.status).toBe(303);
    expect(navigation.headers.location).toBe("/pair");

    const fetched = await deviceRequest(port, ca, "/api/file/default/missing.png", { headers: { accept: "application/json" } });
    expect(fetched.status).toBe(401);
    expect(fetched.json().error).toBe("Pair this device in Unframed's Settings on your Mac.");
  });

  it("gets the pairing page itself, with its code filled in", async () => {
    const engine = await startIpadEngine();
    const port = await ipadPortOf(engine);
    const page = await deviceRequest(port, await readAuthority(engine.dataDir), "/pair?code=123456");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.text).toContain('value="123456"');
    expect(page.text).toContain("Find the code in Unframed's Settings on your Mac, under iPad.");
  });

  it("is refused the socket with no handshake", async () => {
    const engine = await startIpadEngine();
    const port = await ipadPortOf(engine);
    const socket = deviceSocket(port, await readAuthority(engine.dataDir), "/ws");
    const failure = await new Promise<string>((resolve) => {
      socket.on("unexpected-response", (_req, res) => resolve(`status ${res.statusCode}`));
      socket.on("open", () => resolve("open"));
      socket.on("error", (error) => resolve(error.message));
    });
    expect(failure).toBe("status 401");
  });

  it("may still ask for the Home Screen files", async () => {
    const engine = await startIpadEngine();
    const port = await ipadPortOf(engine);
    const answer = await deviceRequest(port, await readAuthority(engine.dataDir), "/manifest.webmanifest", { headers: { accept: "application/manifest+json" } });
    expect(answer.status).not.toBe(401);
  });
});
