import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Instance } from "@unframed/contracts";
import { describe, expect, it } from "vitest";
import { decodePng } from "../src/screens/pngScale.ts";
import { chromeOnMachine as chrome } from "./chrome.ts";
import { makeRepo, repoEngineEnv } from "./gitRepos.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import type { TestRpcClient } from "./rpcClient.ts";

const POLICY = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self' data:; sandbox";
const LOGO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const KEY = /^[a-f0-9]{40}$/;

const hash = (content: Buffer | string) => createHash("sha256").update(content).digest("hex").slice(0, 40);

const eventually = async <T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 60_000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const becomes = (rpc: TestRpcClient, project: string, id: string, state: Instance["state"]) =>
  eventually(
    () => rpc.call("instances.status", { project, id }),
    (instance) => instance.state === state,
  );

const screensOf = async (rpc: TestRpcClient, project: string) =>
  ((await rpc.call("testCanvas.read", { project })).records as any[]).filter((record) => record.typeName === "shape" && record.type === "screen");

const screenOf = async (rpc: TestRpcClient, project: string, id: string) => (await screensOf(rpc, project)).find((record) => record.id === id);

const put = (rpc: TestRpcClient, project: string, records: any[]) => rpc.call("testCanvas.apply", { project, change: { put: records, remove: [] }, origin: { kind: "server", id: "test" } });

const pictureOf = (rpc: TestRpcClient, project: string, id: string, unlike?: string) =>
  eventually(
    async () => (await screenOf(rpc, project, id))?.props.picture as string | undefined,
    (picture) => picture !== undefined && picture !== unlike,
  ) as Promise<string>;

const addRepository = async (env: Record<string, string> = {}) => {
  const root = await makeRepo();
  const engine = await startEngine({ env: await repoEngineEnv({ UNFRAMED_TEST_CANVAS: "1", ...env }) });
  const rpc = await engine.rpc();
  const added = await rpc.call("repositories.add", { path: root });
  const [screen] = await screensOf(rpc, added.name);
  return { root, engine, rpc, project: added.name as string, instance: added.instance as Instance, screen };
};

const goLive = async (rpc: TestRpcClient, project: string, instance: Instance) => {
  await becomes(rpc, project, instance.id, "stopped");
  await rpc.call("instances.demand", { project, client: "window-1", ids: [instance.id] });
  return becomes(rpc, project, instance.id, "live");
};

const store = (engine: TestEngine, project: string) => join(engine.dataDir, "output", project, ".cache", "pictures");

const captures = (engine: TestEngine) => engine.stdout().split("\n").filter((line) => line.includes(": captured a picture of ")).length;

const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

const drawn = (engine: TestEngine, project: string, key: string) =>
  Promise.all([`${key}.png`, `${key}.w384.png`, `${key}.w128.png`].map(async (name) => (await engine.request(`/api/pictures/${encodeURIComponent(project)}/${name}`)).status));

const pixelAt = async (png: Buffer, x: number, y: number) => {
  const { width, channels, data } = await decodePng(png);
  return Array.from(data.subarray((y * width + x) * channels, (y * width + x) * channels + channels));
};

describe("Screen pictures", () => {
  it("stores a live copy from screens.capture under the hash of its content, with its parts, and sets the Screen's picture", async () => {
    const { engine, rpc, project, screen } = await addRepository({ UNFRAMED_TEST_RENDERER: "ok" });
    const html = '<!doctype html><html><head><style>body { background: url(uf-part:1); }</style></head><body><img src="uf-part:0"><img src="uf-part:2"><img src="uf-part:3"></body></html>';
    const parts = [
      { url: "http://127.0.0.1/logo.png", type: "image/png", data: LOGO.toString("base64") },
      { url: "http://127.0.0.1/gone.png", type: "image/png", data: null },
      { url: "http://127.0.0.1/page.html", type: "text/html", data: Buffer.from("<p>no</p>").toString("base64") },
      { url: "http://127.0.0.1/logo-again.png", type: "image/png; charset=binary", data: LOGO.toString("base64") },
    ];
    const answer = await rpc.call("screens.capture", { project, shape: screen.id, w: 1280, h: 800, html, parts });
    const part = `${hash(LOGO)}.png`;
    const resolved = `<!doctype html><html><head><style>body { background: url(data:,); }</style></head><body><img src="parts/${part}"><img src="data:,"><img src="parts/${part}"></body></html>`;
    expect(answer).toEqual({ key: hash(`1280x800\n${resolved}`) });
    const key = answer.key!;
    expect((await screenOf(rpc, project, screen.id)).props.picture).toBe(key);
    expect((await readdir(join(store(engine, project), "parts"))).filter((name) => !name.endsWith(".tmp"))).toEqual([part]);
    expect(await readFile(join(store(engine, project), `${key}.html`), "utf8")).toBe(resolved);
    expect(await drawn(engine, project, key)).toEqual([200, 200, 200]);
    for (const name of [`${key}.png`, `${key}.w384.png`, `${key}.w128.png`]) expect(existsSync(join(store(engine, project), name))).toBe(true);

    const again = await rpc.call("screens.capture", { project, shape: screen.id, w: 1280, h: 800, html, parts });
    expect(again).toEqual({ key });
    await expect(rpc.call("screens.capture", { project, shape: "shape:nothing", w: 1280, h: 800, html, parts })).rejects.toMatchObject({ code: "not_found" });

    for (const [name, type] of [
      [`${key}.html`, "text/html; charset=utf-8"],
      [`${key}.png`, "image/png"],
      [`${key}.w384.png`, "image/png"],
      [`${key}.w128.png`, "image/png"],
      [`parts/${part}`, "image/png"],
    ] as const) {
      const served = await engine.request(`/api/pictures/${encodeURIComponent(project)}/${name}`);
      expect(served.status).toBe(200);
      expect(served.headers).toMatchObject({
        "content-type": type,
        "cache-control": "private, max-age=31536000, immutable",
        etag: `"${/[a-f0-9]{40}/.exec(name)![0]}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": POLICY,
      });
    }
    expect((await engine.request(`/api/pictures/${encodeURIComponent(project)}/${key}.html`)).text).toBe(resolved);
    expect((await engine.request(`/api/pictures/${encodeURIComponent(project)}/parts/${part}`)).body.equals(LOGO)).toBe(true);
    const head = await engine.request(`/api/pictures/${encodeURIComponent(project)}/${key}.png`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    const cached = await engine.request(`/api/pictures/${encodeURIComponent(project)}/${key}.png`, { headers: { "if-none-match": `"${key}"` } });
    expect(cached.status).toBe(304);
    expect(cached.body.length).toBe(0);

    expect(existsSync(join(store(engine, project), "signatures"))).toBe(false);
    const signature = hash("a signature");
    for (const name of [`${"0".repeat(40)}.png`, `${key}.js`, `${key}.w256.png`, `signatures/${signature}`, `parts/${hash(LOGO)}.html`, `..%2F..%2Fcanvas.db`, `parts%2F..%2F${key}.png`, key]) {
      expect((await engine.request(`/api/pictures/${encodeURIComponent(project)}/${name}`)).status).toBe(404);
    }
    expect((await engine.request(`/api/pictures/nothing-here/${key}.png`)).status).toBe(404);
  });

  it("captures a Screen of a live Instance once, gives a second Screen with the same state the same key with no capture, and captures again when the worktree is touched", { timeout: 120_000 }, async () => {
    const { engine, rpc, project, instance, screen } = await addRepository({ UNFRAMED_TEST_RENDERER: "ok" });
    const live = await goLive(rpc, project, instance);
    const first = await pictureOf(rpc, project, screen.id);
    expect(first).toMatch(KEY);
    expect(await readFile(join(store(engine, project), `${first}.html`), "utf8")).toContain(`<p>http://127.0.0.1:${live.proxyPort}/</p>`);
    expect(existsSync(join(engine.dataDir, "output", project, ".cache", "screens"))).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const counted = captures(engine);
    expect(counted).toBeGreaterThanOrEqual(1);

    await put(rpc, project, [{ ...screen, id: "shape:copy", x: 2000, props: { ...screen.props } }]);
    expect(await pictureOf(rpc, project, "shape:copy")).toBe(first);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(captures(engine)).toBe(counted);

    await put(rpc, project, [{ ...screen, id: "shape:other", x: 4000, props: { ...screen.props, route: "/settings" } }]);
    const other = await pictureOf(rpc, project, "shape:other");
    expect(other).not.toBe(first);
    expect(captures(engine)).toBe(counted + 1);

    await writeFile(join(live.worktree, "touched.txt"), "changed\n");
    await eventually(async () => captures(engine), (count) => count >= counted + 3);
    expect((await screenOf(rpc, project, screen.id)).props.picture).toBe(first);
  });

  it("gives the same page at another size its own key and rasters", async () => {
    const { engine, rpc, project, screen } = await addRepository({ UNFRAMED_TEST_RENDERER: "ok" });
    const html = "<!doctype html><html><head></head><body><p>Same page</p></body></html>";
    const short = await rpc.call("screens.capture", { project, shape: screen.id, w: 1280, h: 800, html, parts: [] });
    const tall = await rpc.call("screens.capture", { project, shape: screen.id, w: 1280, h: 1200, html, parts: [] });
    expect(tall.key).toMatch(KEY);
    expect(tall.key).not.toBe(short.key);
    expect((await screenOf(rpc, project, screen.id)).props.picture).toBe(tall.key);
    await drawn(engine, project, short.key!);
    await drawn(engine, project, tall.key!);
    const dir = store(engine, project);
    expect((await readFile(join(dir, `${tall.key}.png`))).equals(await readFile(join(dir, `${short.key}.png`)))).toBe(false);
  });

  it("keeps the picture of the latest live copy when an earlier one finishes after it", async () => {
    const { rpc, project, screen } = await addRepository({ UNFRAMED_TEST_RENDERER: "ok" });
    const earlier = `<!doctype html><html><head></head><body><p>${"Earlier ".repeat(5000)}</p></body></html>`;
    const later = "<!doctype html><html><head></head><body><p>Later</p></body></html>";
    const slow = rpc.call("screens.capture", { project, shape: screen.id, w: 1280, h: 800, html: earlier, parts: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const fast = await rpc.call("screens.capture", { project, shape: screen.id, w: 1280, h: 800, html: later, parts: [] });
    expect((await slow).key).toMatch(KEY);
    expect((await screenOf(rpc, project, screen.id)).props.picture).toBe(fast.key);
  });

  it("sets a live copy's key as soon as its page is stored, and holds a request for its rasters until they are drawn", async () => {
    const { engine, rpc, project, screen } = await addRepository({ UNFRAMED_TEST_RENDERER: "ok" });
    const html = `<!doctype html><html><head></head><body><p>${"Slow to draw ".repeat(5000)}</p></body></html>`;
    const { key } = await rpc.call("screens.capture", { project, shape: screen.id, w: 1280, h: 800, html, parts: [] });
    const dir = store(engine, project);
    expect((await screenOf(rpc, project, screen.id)).props.picture).toBe(key);
    expect(existsSync(join(dir, `${key}.html`))).toBe(true);
    expect(existsSync(join(dir, `${key}.w384.png`))).toBe(false);
    expect((await engine.request(`/api/pictures/${encodeURIComponent(project)}/${key}.html`)).status).toBe(200);
    expect(await drawn(engine, project, key!)).toEqual([200, 200, 200]);
    for (const name of [`${key}.png`, `${key}.w384.png`, `${key}.w128.png`]) expect(existsSync(join(dir, name))).toBe(true);
  });

  it("keeps a live capture that lands while a headless render of the Screen's default state is still running", { timeout: 120_000 }, async () => {
    const { engine, rpc, project, instance, screen } = await addRepository({ UNFRAMED_TEST_RENDERER: "ok" });
    await goLive(rpc, project, instance);
    const first = await pictureOf(rpc, project, screen.id);
    const counted = captures(engine);
    await put(rpc, project, [{ ...(await screenOf(rpc, project, screen.id)), props: { ...screen.props, picture: first, route: "/slow-render?render-ms=3000" } }]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const { key } = await rpc.call("screens.capture", { project, shape: screen.id, w: 1280, h: 800, html: "<!doctype html><html><head></head><body><p>Left by the person</p></body></html>", parts: [] });
    await eventually(async () => captures(engine), (count) => count > counted, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await screenOf(rpc, project, screen.id)).props.picture).toBe(key);
    expect(captures(engine)).toBe(counted + 1);
  });

  it("keeps a Screen's live picture as its own: no later render replaces it, and a copy of the Screen does not inherit it as its state's picture", { timeout: 120_000 }, async () => {
    const { engine, rpc, project, instance, screen } = await addRepository({ UNFRAMED_TEST_RENDERER: "ok" });
    await goLive(rpc, project, instance);
    const headless = await pictureOf(rpc, project, screen.id);
    const { key } = await rpc.call("screens.capture", { project, shape: screen.id, w: 1280, h: 800, html: "<!doctype html><html><head></head><body><p>Typed into</p></body></html>", parts: [] });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await screenOf(rpc, project, screen.id)).props.picture).toBe(key);
    const counted = captures(engine);
    const { picture: _, ...props } = (await screenOf(rpc, project, screen.id)).props;
    await put(rpc, project, [{ ...screen, id: "shape:copy", x: 2000, props }]);
    expect(await pictureOf(rpc, project, "shape:copy")).toBe(headless);
    expect(captures(engine)).toBe(counted);
  });

  it("does not capture a Screen whose Instance never runs", async () => {
    const { engine, rpc, project, instance, screen } = await addRepository({ UNFRAMED_TEST_RENDERER: "ok" });
    await becomes(rpc, project, instance.id, "stopped");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect((await screenOf(rpc, project, screen.id)).props.picture).toBeUndefined();
    expect(captures(engine)).toBe(0);
  });
});

if (chrome === undefined) console.log("  Screen picture tests with Chrome skipped: no Chrome, Chromium, Edge or Brave on this machine");

describe.skipIf(chrome === undefined)("Screen pictures in headless Chrome", () => {
  it("captures a page as HTML with its parts resolved and three rasters of the right widths", { timeout: 120_000 }, async () => {
    const { engine, rpc, project, instance, screen } = await addRepository();
    await put(rpc, project, [{ ...screen, props: { ...screen.props, route: "/busy" } }]);
    await goLive(rpc, project, instance);
    const key = await pictureOf(rpc, project, screen.id);
    const dir = store(engine, project);
    expect(pngSize(await readFile(join(dir, `${key}.png`)))).toEqual({ width: 2560, height: 1600 });
    expect(pngSize(await readFile(join(dir, `${key}.w384.png`)))).toEqual({ width: 384, height: 240 });
    expect(pngSize(await readFile(join(dir, `${key}.w128.png`)))).toEqual({ width: 128, height: 80 });
    const html = await readFile(join(dir, `${key}.html`), "utf8");
    expect(key).toBe(hash(`1280x800\n${html}`));
    expect(html).not.toContain("uf-part:");
    expect(html).not.toContain("<script");
    expect(html).toContain("Busy app");
    const logo = `${hash(await (await fetch(`http://127.0.0.1:${(await rpc.call("instances.status", { project, id: instance.id })).proxyPort}/logo.png`)).arrayBuffer().then(Buffer.from))}.png`;
    expect(html).toContain(`parts/${logo}`);
    expect(await readdir(join(dir, "parts"))).toContain(logo);
  });

  it("captures a new picture with a new key when a change in the worktree changes the page", { timeout: 120_000 }, async () => {
    const { rpc, project, instance, screen } = await addRepository();
    await put(rpc, project, [{ ...screen, props: { ...screen.props, route: "/page-text" } }]);
    const live = await goLive(rpc, project, instance);
    await writeFile(join(live.worktree, "page.txt"), "First");
    const first = await eventually(
      async () => (await screenOf(rpc, project, screen.id))?.props.picture as string | undefined,
      (picture) => picture !== undefined,
    );
    await writeFile(join(live.worktree, "page.txt"), "A much longer second text");
    const second = await pictureOf(rpc, project, screen.id, first);
    expect(second).toMatch(KEY);
    expect(second).not.toBe(first);
  });

  it("keeps what a WebGL canvas drew in the copy, not a black or empty buffer", { timeout: 120_000 }, async () => {
    const { engine, rpc, project, instance, screen } = await addRepository();
    await put(rpc, project, [{ ...screen, props: { ...screen.props, route: "/webgl", w: 400, h: 300 } }]);
    await goLive(rpc, project, instance);
    const key = await pictureOf(rpc, project, screen.id);
    const dir = store(engine, project);
    const html = await readFile(join(dir, `${key}.html`), "utf8");
    const part = /<img[^>]*src="parts\/([0-9a-f]{40}\.png)"/.exec(html)?.[1];
    expect(part).toBeDefined();
    const [r, g, b, a] = await pixelAt(await readFile(join(dir, "parts", part!)), 100, 50);
    expect({ r, b, a: a ?? 255 }).toEqual({ r: 0, b: 255, a: 255 });
    expect(Math.abs(g! - 128)).toBeLessThanOrEqual(1);
  });

  it("rasterises a live copy from screens.capture with its parts served from the store", { timeout: 120_000 }, async () => {
    const { engine, rpc, project, screen } = await addRepository();
    const html = '<!doctype html><html><head><style>body { margin: 0; background: rgb(0, 128, 0); }</style></head><body><img src="uf-part:0" width="64" height="64"></body></html>';
    const { key } = await rpc.call("screens.capture", { project, shape: screen.id, w: 390, h: 844, html, parts: [{ url: "http://x/logo.png", type: "image/png", data: LOGO.toString("base64") }] });
    expect(key).toMatch(KEY);
    expect((await screenOf(rpc, project, screen.id)).props.picture).toBe(key);
    expect(await drawn(engine, project, key!)).toEqual([200, 200, 200]);
    const dir = store(engine, project);
    expect(pngSize(await readFile(join(dir, `${key}.png`)))).toEqual({ width: 780, height: 1688 });
    expect(pngSize(await readFile(join(dir, `${key}.w384.png`))).width).toBe(384);
    expect(pngSize(await readFile(join(dir, `${key}.w128.png`))).width).toBe(128);
  });
});
