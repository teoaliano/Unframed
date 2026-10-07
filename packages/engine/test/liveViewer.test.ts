import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { liveViewerSource } from "@unframed/domain";

/**
 * The viewer the engine wrote. Its script is a function's source text, which the engine's
 * runtime and the test's transform print differently, so the lines around it are compared.
 */
const expectViewer = (text: string) => {
  const outside = (html: string) => html.replace(/<script>[\s\S]*<\/script>/, "<script></script>");
  expect(outside(text)).toBe(outside(liveViewerSource()));
  expect(text).toContain("unframed-live-");
};
import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { motionShape, roomShape } from "./agentCanvas.ts";
import { pageShape } from "./canvasRecords.ts";

const CSP =
  "default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors http://localhost:* http://127.0.0.1:* http://[::1]:*";

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

const preview = (agent: AgentEngine, path: string) =>
  agent.engine.request(path, { port: agent.engine.previewPort, headers: { host: `localhost:${agent.engine.previewPort}` } });

describe("the live viewer's pointer", () => {
  it("names the new file after a page_write makes a new version, and carries the shape's dials after a dial change", async () => {
    const agent = await startAgentEngine({
      script: await scriptFolder({ artifacts: { when: "^go", turns: [{ text: "Done.", tools: [{ name: "page_write", input: { shapeId: "pg1", html: "<body>v2</body>" } }] }] } }),
    });
    await writeFile(join(agent.folder, "1-landing.html"), "<body>v1</body>");
    await put(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    expect(await eventually(() => pointerOf(agent, "pg1"), (pointer) => pointer !== undefined, "the first pointer")).toEqual({
      kind: "page",
      file: "1-landing.html",
      title: "Landing",
      dials: null,
    });

    const chatId = await agent.createChat();
    await agent.send(chatId, "go");
    await agent.settled(chatId, 1);
    const written = (await roomShape(agent, "pg1")).props.file as string;
    expect(written).not.toBe("1-landing.html");
    await eventually(() => pointerOf(agent, "pg1"), (pointer) => pointer?.file === written, "the new version");
    // The versioned files are untouched: the old one still plays as written.
    expect(await readFile(join(agent.folder, "1-landing.html"), "utf8")).toBe("<body>v1</body>");

    const shape = await roomShape(agent, "pg1");
    await put(agent, [{ ...shape, props: { ...shape.props, dials: { accent: "#ff0000", size: 30 } } }]);
    expect(await eventually(() => pointerOf(agent, "pg1"), (pointer) => pointer?.dials !== null, "the dials")).toEqual({
      kind: "page",
      file: written,
      title: "Landing",
      dials: { accent: "#ff0000", size: 30 },
    });
  });

  it("writes one pointer per artifact and one viewer, and the preview origin serves both under its one path shape with its usual headers", async () => {
    const agent = await startAgentEngine();
    await put(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" }), motionShape("m1", "101", "Intro", { file: "2-intro.html" }, { y: 500 })]);
    expect(await eventually(() => pointerOf(agent, "m1"), (pointer) => pointer !== undefined, "the motion's pointer")).toEqual({ kind: "motion", file: "2-intro.html", title: "Intro", dials: null });
    await eventually(() => pointerOf(agent, "pg1"), (pointer) => pointer !== undefined, "the page's pointer");
    expect((await readdir(agent.folder)).filter((name) => name.startsWith("unframed-live")).sort()).toEqual(["unframed-live-m1.js", "unframed-live-pg1.js", "unframed-live.html"]);

    const viewer = await preview(agent, "/p/board/unframed-live.html?s=pg1");
    expect(viewer.status).toBe(200);
    expect(viewer.headers["content-type"]).toBe("text/html; charset=utf-8");
    expectViewer(viewer.text);
    const pointer = await preview(agent, "/p/board/unframed-live-pg1.js?n=4");
    expect(pointer.status).toBe(200);
    expect(pointer.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    for (const response of [viewer, pointer]) {
      expect(response.headers).toMatchObject({
        "content-security-policy": CSP,
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "cache-control": "no-cache",
        etag: expect.stringMatching(/^"[0-9a-f]+-[0-9a-f]+"$/),
      });
    }
  });

  it("rewrites a viewer that differs from the engine's own when a frame asks for it", async () => {
    const agent = await startAgentEngine();
    await put(agent, [pageShape("pg1", "100", { file: "1-landing.html" })]);
    await eventually(() => pointerOf(agent, "pg1"), (pointer) => pointer !== undefined, "the pointer");
    await writeFile(join(agent.folder, "unframed-live.html"), "<p>an older viewer</p>");
    expectViewer((await preview(agent, "/p/board/unframed-live.html")).text);
    // A request never makes a project folder, for the viewer or the bridge.
    for (const name of ["unframed-live.html", "unframed-dials.js"]) expect((await preview(agent, `/p/nothere/${name}`)).status).toBe(404);
    expect(await readdir(join(agent.folder, "..", "nothere")).catch(() => "missing")).toBe("missing");
  });
});
