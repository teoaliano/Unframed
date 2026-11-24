import { writeFile } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { makeRepo, repoEngineEnv } from "./gitRepos.ts";
import { rawRequest, startEngine } from "./harness.ts";

const TAG = '<script src="/__unframed/bridge.js"></script>';

const answers = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });

const eventually = async <T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 20_000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const liveInstance = async (env: Record<string, string> = {}) => {
  const root = await makeRepo();
  await writeFile(join(root, ".env.local"), "SECRET=shh\n");
  const engine = await startEngine({ env: await repoEngineEnv(env) });
  const rpc = await engine.rpc();
  const added = await rpc.call("repositories.add", { path: root });
  const project = added.name;
  const id = added.instance.id;
  await eventually(
    () => rpc.call("instances.status", { project, id }),
    (instance) => instance.state === "stopped",
  );
  const live = await rpc.call("instances.start", { project, id });
  expect(live.state).toBe("live");
  return { engine, rpc, project, id, live, proxy: live.proxyPort!, upstream: live.upstreamPort! };
};

const at = (proxy: number) => ({ host: `127.0.0.1:${proxy}` });

const firstMessage = (proxy: number, path: string, headers: Record<string, string>) =>
  new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${proxy}${path}`, { headers });
    socket.once("message", (data) => {
      resolve(String(data));
      socket.close();
    });
    socket.once("error", reject);
  });

describe("serving a live Instance through its proxy", () => {
  it("gives a live Instance a proxy on 127.0.0.1 that injects the bridge after <head>, keeps Host, and closes on stop", async () => {
    const { rpc, project, id, live, proxy, upstream } = await liveInstance();
    expect(proxy).toBeGreaterThan(0);
    expect(proxy).not.toBe(upstream);
    expect(await rpc.call("instances.status", { project, id })).toMatchObject({ state: "live", proxyPort: proxy, upstreamPort: upstream });
    expect(live.proxyPort).toBe(proxy);

    const page = await rawRequest(proxy, "/dashboard", { headers: { ...at(proxy), accept: "text/html" } });
    expect(page.status).toBe(200);
    expect(page.text).toBe(`<!doctype html><html><head>${TAG}<title>Fake app</title></head><body><h1>Fake app</h1><p id="path">/dashboard</p></body></html>`);

    const info = (await rawRequest(proxy, "/__fake/info", { headers: { ...at(proxy), accept: "text/html", "accept-encoding": "gzip" } })).json();
    expect(info.host).toBe(`127.0.0.1:${proxy}`);
    expect(info.acceptEncoding).toBe("identity");

    const bridge = await rawRequest(proxy, "/__unframed/bridge.js", { headers: at(proxy) });
    expect(bridge.status).toBe(200);
    expect(bridge.headers["content-type"]).toMatch(/javascript/);
    expect(bridge.text).toContain("unframed:screen:ready");
    expect(bridge.text).toContain("unframed:dials");

    const stopped = await rpc.call("instances.stop", { project, id });
    expect(stopped).toMatchObject({ state: "stopped", proxyPort: null });
    expect(await answers(proxy)).toBe(false);
  });

  it("injects into a <head> split across chunks, unzips HTML that came encoded anyway, and leaves a page with no <head> alone", async () => {
    const { proxy } = await liveInstance();
    expect((await rawRequest(proxy, "/split", { headers: { ...at(proxy), accept: "text/html" } })).text).toBe(
      `<!doctype html><html><head>${TAG}<title>Split</title></head><body>split</body></html>`,
    );
    const zipped = await rawRequest(proxy, "/", { headers: { ...at(proxy), accept: "*/*", "accept-encoding": "gzip" } });
    expect(zipped.headers["content-encoding"]).toBeUndefined();
    expect(zipped.text).toContain(`<head>${TAG}<title>Fake app</title>`);
    expect((await rawRequest(proxy, "/headless", { headers: { ...at(proxy), accept: "text/html" } })).text).toBe("<body>no head here</body>");
  });

  it("strips frame refusals, keeps the rest of the CSP and puts its nonce on the bridge tag", async () => {
    const { proxy } = await liveInstance();
    const page = await rawRequest(proxy, "/deny", { headers: { ...at(proxy), accept: "text/html" } });
    expect(page.headers["x-frame-options"]).toBeUndefined();
    expect(page.headers["content-security-policy"]).toBe("script-src 'self' 'nonce-fake123'");
    expect(page.text).toBe('<html><head><script src="/__unframed/bridge.js" nonce="fake123"></script><title>Deny</title></head><body>deny</body></html>');
  });

  it("keeps a login on the proxy origin: the redirect is rewritten and the Lax cookie comes back", async () => {
    const { proxy } = await liveInstance();
    const login = await rawRequest(proxy, "/login", { headers: { ...at(proxy), accept: "text/html" } });
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe(`http://127.0.0.1:${proxy}/`);
    expect(login.headers["set-cookie"]).toEqual(["session=signed-in; Path=/; SameSite=Lax; HttpOnly"]);
    const info = (await rawRequest(proxy, "/__fake/info", { headers: { ...at(proxy), cookie: "session=signed-in" } })).json();
    expect(info.cookie).toBe("session=signed-in");
  });

  it("forwards WebSocket upgrades on every path with the query, Origin rewritten to localhost and Host kept", async () => {
    const { proxy, upstream } = await liveInstance();
    const origin = `http://127.0.0.1:${proxy}`;
    expect(await firstMessage(proxy, "/_next/webpack-hmr?page=%2F", { origin, ...at(proxy) })).toBe(
      `hello /_next/webpack-hmr?page=%2F from http://localhost:${upstream} at 127.0.0.1:${proxy}`,
    );
    expect(await firstMessage(proxy, "/?token=abc", { origin, ...at(proxy) })).toBe(`hello /?token=abc from http://localhost:${upstream} at 127.0.0.1:${proxy}`);
    const page = (await rawRequest(proxy, "/__fake/info", { headers: { ...at(proxy), origin } })).json();
    expect(page.origin).toBe(origin);
    const dev = (await rawRequest(proxy, "/_next/__fake/info?y=1", { headers: { ...at(proxy), origin } })).json();
    expect(dev.origin).toBe(`http://localhost:${upstream}`);
  });

  it("falls back to [::1] when the dev server listens only there", async () => {
    const { proxy } = await liveInstance({ FAKE_DEV_HOST: "::1" });
    const page = await rawRequest(proxy, "/", { headers: { ...at(proxy), accept: "text/html" } });
    expect(page.status).toBe(200);
    expect(page.text).toContain(TAG);
    expect(await firstMessage(proxy, "/ws", at(proxy))).toBe(`hello /ws from nowhere at 127.0.0.1:${proxy}`);
  });

  it("refuses a request addressed to a host that is not this machine", async () => {
    const { proxy } = await liveInstance();
    expect((await rawRequest(proxy, "/", { headers: { host: "evil.example" } })).status).toBe(403);
  });
});
