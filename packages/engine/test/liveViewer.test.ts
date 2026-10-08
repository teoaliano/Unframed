import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { liveCheckSource, livePointerSource, liveViewerSource } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { motionShape, roomShape } from "./agentCanvas.ts";
import { pageShape } from "./canvasRecords.ts";

const CSP =
  "default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors http://localhost:* http://127.0.0.1:* http://[::1]:*";

/**
 * The viewer the engine wrote. Its script is a function's source text, which the engine's
 * runtime and the test's transform print differently, so the lines around it are compared.
 */
const expectViewer = (text: string) => {
  const outside = (html: string) => html.replace(/<script>[\s\S]*<\/script>/, "<script></script>");
  expect(outside(text)).toBe(outside(liveViewerSource()));
  expect(text).toContain("unframed-live-");
};

/** What a pointer file says, read the way the viewer reads it: by calling its `unframedLive`. */
const pointerOf = async (agent: AgentEngine, key: string): Promise<any> => {
  const text = await readFile(join(agent.folder, `unframed-live-${key}.js`), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  let read: unknown;
  new Function("unframedLive", text)((pointer: unknown) => (read = pointer));
  return read;
};

const eventually = async <T>(read: () => Promise<T>, check: (value: T) => boolean, what: string): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (check(value)) return value;
    if (Date.now() - started > 10_000) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

/** Writes records the way a tab would. The engine's own `system` writes run no commit work. */
const put = (agent: AgentEngine, records: TLRecord[]) =>
  agent.rpc.call("testCanvas.apply", { project: "board", change: { put: records, remove: [] }, origin: { kind: "server", id: "test" } });

const remove = (agent: AgentEngine, ids: string[], kind: "server" | "system" = "server") =>
  agent.rpc.call("testCanvas.apply", { project: "board", change: { put: [], remove: ids }, origin: { kind, id: "test" } });

const preview = (agent: AgentEngine, path: string) =>
  agent.engine.request(path, { port: agent.engine.previewPort, headers: { host: `localhost:${agent.engine.previewPort}` } });

/** What "Open in a new tab" asks of the engine. */
const openLive = (agent: AgentEngine, shapeId: string) => agent.rpc.call("artifact.openLive", { project: "board", shapeId });

const liveFiles = async (agent: AgentEngine) => (await readdir(agent.folder)).filter((name) => name.startsWith("unframed-live")).sort();

describe("the live viewer's pointer", () => {
  it("is written only once the shape is opened in a tab, then names each new version and carries the dials", async () => {
    const agent = await startAgentEngine({
      script: await scriptFolder({ artifacts: { when: "^go", turns: [{ text: "Done.", tools: [{ name: "page_write", input: { shapeId: "pg1", html: "<body>v2</body>" } }] }] } }),
    });
    await writeFile(join(agent.folder, "1-landing.html"), "<body>v1</body>");
    await put(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" }), pageShape("pg2", "101", { file: "1-landing.html" }, { y: 500 })]);
    const shape = await roomShape(agent, "pg1");
    await put(agent, [{ ...shape, props: { ...shape.props, dials: { size: 1 } } }]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await liveFiles(agent)).toEqual([]);

    await openLive(agent, "shape:pg1");
    expect(await pointerOf(agent, "pg1")).toEqual({ kind: "page", file: "1-landing.html", title: "Landing", dials: { size: 1 } });
    expect(await liveFiles(agent)).toEqual(["unframed-live-pg1.js", "unframed-live.html", "unframed-live.js"]);

    const chatId = await agent.createChat();
    await agent.send(chatId, "go");
    await agent.settled(chatId, 1);
    const written = (await roomShape(agent, "pg1")).props.file as string;
    expect(written).not.toBe("1-landing.html");
    await eventually(() => pointerOf(agent, "pg1"), (pointer) => pointer?.file === written, "the new version");
    // The versioned files are untouched: the old one still plays as written.
    expect(await readFile(join(agent.folder, "1-landing.html"), "utf8")).toBe("<body>v1</body>");

    const current = await roomShape(agent, "pg1");
    await put(agent, [{ ...current, props: { ...current.props, dials: { accent: "#ff0000", size: 30 } } }]);
    expect(await eventually(() => pointerOf(agent, "pg1"), (pointer) => pointer?.dials?.size === 30, "the dials")).toEqual({
      kind: "page",
      file: written,
      title: "Landing",
      dials: { accent: "#ff0000", size: 30 },
    });
    // The shape never opened in a tab still has no pointer.
    expect(await liveFiles(agent)).toEqual(["unframed-live-pg1.js", "unframed-live.html", "unframed-live.js"]);
  });

  it("marks the pointer deleted when the shape leaves the canvas, and current again when it comes back", async () => {
    const agent = await startAgentEngine();
    await put(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    await openLive(agent, "shape:pg1");
    const shape = await roomShape(agent, "pg1");
    await remove(agent, ["shape:pg1"]);
    expect(await eventually(() => pointerOf(agent, "pg1"), (pointer) => pointer?.deleted === true, "the deleted mark")).toEqual({
      kind: "page",
      file: "1-landing.html",
      title: "Landing",
      dials: null,
      deleted: true,
    });
    await put(agent, [shape]);
    expect(await eventually(() => pointerOf(agent, "pg1"), (pointer) => pointer?.deleted === undefined, "the shape back")).toEqual({
      kind: "page",
      file: "1-landing.html",
      title: "Landing",
      dials: null,
    });
  });

  it("refuses a shape that is not a page or motion on the canvas, and writes nothing", async () => {
    const agent = await startAgentEngine();
    await put(agent, [motionShape("m1", "101", "Intro")]);
    await expect(openLive(agent, "shape:nope")).rejects.toMatchObject({ code: "not_found", message: "There is no page or motion shape:nope on this canvas." });
    await expect(openLive(agent, "shape:a.b")).rejects.toMatchObject({ code: "not_found" });
    expect(await liveFiles(agent)).toEqual([]);
    // An empty motion can be opened: its tab says it has no file yet.
    await openLive(agent, "shape:m1");
    expect(await pointerOf(agent, "m1")).toEqual({ kind: "motion", file: "", title: "Intro", dials: null });
  });

  it("brings opened shapes' pointers up to date when the project opens again after a restart", async () => {
    const first = await startAgentEngine();
    await put(first, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" }), pageShape("pg2", "101", { file: "2-other.html" }, { y: 500 })]);
    await openLive(first, "shape:pg1");
    await openLive(first, "shape:pg2");
    // Removed by the engine's own write, which runs no commit work: only the next open notices.
    await remove(first, ["shape:pg2"], "system");
    await first.engine.stop();
    // A pointer left behind with a stale file, as after a crash.
    await writeFile(join(first.folder, "unframed-live-pg1.js"), livePointerSource({ kind: "page", file: "0-stale.html", title: "Landing", dials: null }));

    const second = await startAgentEngine({ dataDir: first.engine.dataDir });
    await second.rpc.call("testCanvas.read", { project: "board" });
    await eventually(() => pointerOf(second, "pg1"), (pointer) => pointer?.file === "1-landing.html", "the refreshed pointer");
    await eventually(() => pointerOf(second, "pg2"), (pointer) => pointer?.deleted === true, "the shape deleted while away");
  });

  it("serves the viewer, the check and a pointer under the preview origin's one path shape with its usual headers", async () => {
    const agent = await startAgentEngine();
    await put(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    await openLive(agent, "shape:pg1");

    const viewer = await preview(agent, "/p/board/unframed-live.html?s=pg1");
    expect(viewer.status).toBe(200);
    expect(viewer.headers["content-type"]).toBe("text/html; charset=utf-8");
    expectViewer(viewer.text);
    const check = await preview(agent, "/p/board/unframed-live.js?n=3");
    expect(check.status).toBe(200);
    expect(check.text).toBe(liveCheckSource());
    const pointer = await preview(agent, "/p/board/unframed-live-pg1.js?n=4");
    expect(pointer.status).toBe(200);
    for (const response of [check, pointer]) expect(response.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    for (const response of [viewer, check, pointer]) {
      expect(response.headers).toMatchObject({
        "content-security-policy": CSP,
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "cache-control": "no-cache",
        etag: expect.stringMatching(/^"[0-9a-f]+-[0-9a-f]+"$/),
      });
    }
    // A shape never opened has no pointer to serve.
    expect((await preview(agent, "/p/board/unframed-live-pg9.js")).status).toBe(404);
  });

  it("rewrites a viewer that differs from the engine's own when a frame asks for it", async () => {
    const agent = await startAgentEngine();
    await put(agent, [pageShape("pg1", "100", { file: "1-landing.html" })]);
    await openLive(agent, "shape:pg1");
    await writeFile(join(agent.folder, "unframed-live.html"), "<p>an older viewer</p>");
    expectViewer((await preview(agent, "/p/board/unframed-live.html")).text);
    // A request never makes a project folder, for the viewer or the bridge.
    for (const name of ["unframed-live.html", "unframed-dials.js"]) expect((await preview(agent, `/p/nothere/${name}`)).status).toBe(404);
    expect(await readdir(join(agent.folder, "..", "nothere")).catch(() => "missing")).toBe("missing");
  });
});
