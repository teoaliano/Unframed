import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_TAG, RUNTIME_TAG } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { motionShape } from "./agentCanvas.ts";
import { makeTempDir, startEngine, type TestEngine } from "./harness.ts";
import type { TestRpcClient } from "./rpcClient.ts";

const COMPOSITION = '<html><body><div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360"></div></body></html>';
const LIBRARY = ["gsap.js", "hyperframes-player.js", "hyperframes-runtime.js", "hyperframes-viewer.html", "unframed-dials.js"];

interface Rendering {
  readonly engine: TestEngine;
  readonly rpc: TestRpcClient;
  readonly folder: string;
}

const startRendering = async (renderer: "ok" | "fail" | "no-chrome" = "ok"): Promise<Rendering> => {
  const engine = await startEngine({ env: { UNFRAMED_TEST_RENDERER: renderer, UNFRAMED_TEST_CANVAS: "1" } });
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "board" });
  const folder = join(engine.dataDir, "output", "board");
  await writeFile(join(folder, "1-intro.html"), COMPOSITION);
  await rpc.call("testCanvas.apply", {
    project: "board",
    change: { put: [motionShape("m1", "150", "Intro", { file: "1-intro.html", w: 480, h: 300 }, { x: 100, y: 100 })], remove: [] },
    origin: { kind: "system", id: "test-seed" },
  });
  return { engine, rpc, folder };
};

const room = async (rpc: TestRpcClient): Promise<any[]> => (await rpc.call("testCanvas.read", { project: "board" })).records as any[];

/** Polls a render until it settles, answering every status it passed through. */
const follow = async (rpc: TestRpcClient, id: string) => {
  const seen: any[] = [];
  for (let i = 0; i < 400; i++) {
    const status = await rpc.call("motion.renderStatus", { project: "board", id });
    seen.push(status);
    if (status.status === "done" || status.status === "failed") return seen;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("the render never settled");
};

const projectFiles = async (folder: string) => (await readdir(folder)).filter((name) => !LIBRARY.includes(name) && name !== "1-intro.html" && !name.startsWith("unframed.sqlite")).sort();

describe("motion.upload", () => {
  it("injects the tags, ensures the library and saves an upload with its sidecar", async () => {
    const { rpc, folder } = await startRendering();
    const saved = await rpc.call("motion.upload", { project: "board", fileName: "../elsewhere/My Intro.html", html: "<head></head><div id=root></div>" });
    expect(saved).toEqual({ file: expect.stringMatching(/^\d+-my-intro\.html$/), fileName: "My Intro.html", bytes: expect.any(Number), mime: "text/html" });
    const html = await readFile(join(folder, saved.file), "utf8");
    expect(html).toBe(`<head>${RUNTIME_TAG}\n${BRIDGE_TAG}\n</head><div id=root></div>`);
    expect(saved.bytes).toBe(Buffer.byteLength(html));
    expect(JSON.parse(await readFile(join(folder, saved.file.replace(/\.html$/, ".json")), "utf8"))).toEqual({
      source: "upload",
      fileName: "My Intro.html",
      mime: "text/html",
      bytes: saved.bytes,
      at: expect.any(String),
    });
    for (const name of LIBRARY) expect(existsSync(join(folder, name)), name).toBe(true);
    const unnamed = await rpc.call("motion.upload", { project: "board", fileName: "", html: "<div id=root></div>" });
    expect(unnamed.fileName).toBe("motion.html");
    expect(unnamed.file).toMatch(/^\d+-motion\.html$/);
  });

  it("refuses an empty body and one over 20 MB", async () => {
    const { rpc, folder } = await startRendering();
    for (const html of ["", "  \n\t "]) {
      await expect(rpc.call("motion.upload", { project: "board", fileName: "x.html", html })).rejects.toMatchObject({ code: "bad_request", message: "No composition in the request body." });
    }
    await expect(rpc.call("motion.upload", { project: "board", fileName: "x.html", html: "a".repeat(20 * 1_048_576 + 1) })).rejects.toMatchObject({ code: "bad_request" });
    expect(await projectFiles(folder)).toEqual([]);
  });
});

describe("motion.renderStart and motion.renderStatus", () => {
  it("refuse a bad file name, a missing file and a library that cannot be prepared, and an unknown render", async () => {
    const { rpc, folder } = await startRendering();
    for (const file of ["../1-intro.html", "intro.js", "", ".hidden.html"]) {
      await expect(rpc.call("motion.renderStart", { project: "board", file, shapeId: "shape:m1" })).rejects.toMatchObject({
        code: "bad_request",
        message: "Which composition? Pass its .html file name.",
      });
    }
    await expect(rpc.call("motion.renderStart", { project: "board", file: "9-missing.html", shapeId: "shape:m1" })).rejects.toMatchObject({
      code: "not_found",
      message: "No file 9-missing.html in this project.",
    });
    await mkdir(join(folder, "gsap.js"));
    await expect(rpc.call("motion.renderStart", { project: "board", file: "1-intro.html", shapeId: "shape:m1" })).rejects.toMatchObject({
      code: "internal",
      message: expect.stringMatching(/^Could not prepare the motion library: /),
    });
    await expect(rpc.call("motion.renderStatus", { project: "board", id: "r-nope-000000" })).rejects.toMatchObject({ code: "not_found", message: "No such render." });
    expect((await room(rpc)).filter((record) => record.type === "video")).toEqual([]);
  });

  it("puts a placeholder beside the motion before answering, goes queued, rendering, done, and fills it with the placed MP4", async () => {
    const { rpc, folder } = await startRendering();
    const started = await rpc.call("motion.renderStart", { project: "board", file: "1-intro.html", title: "Intro!", shapeId: "shape:m1" });
    expect(started).toEqual({ id: expect.stringMatching(/^r-[0-9a-z]+-[0-9a-z]{6}$/), status: "queued", placeholder: expect.stringMatching(/^shape:/) });
    const placeholder = (await room(rpc)).find((record) => record.id === started.placeholder);
    expect(placeholder).toMatchObject({ type: "video", x: 100 + 480 + 40, y: 100, props: { w: 320, h: 180, assetId: null }, meta: { unframed: { run: { runId: started.id, runIndex: 1 } } } });
    expect(placeholder.meta.unframed.result).toBeUndefined();

    const seen = await follow(rpc, started.id);
    const states = [...new Set(seen.map((status) => status.status))];
    expect(states.at(-1)).toBe("done");
    expect(states.every((state) => ["queued", "rendering", "done"].includes(state))).toBe(true);
    expect(states).toContain("rendering");
    const progress = seen.map((status) => status.progress);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(seen.filter((status) => status.status !== "done").every((status) => status.progress <= 99)).toBe(true);
    const done = seen.at(-1);
    expect(done).toMatchObject({ id: started.id, file: "1-intro.html", status: "done", progress: 100, message: "variables: null", error: null });
    expect(seen.map((status) => status.message)).toEqual(expect.arrayContaining(["Encoding"]));
    expect(done.output).toMatch(/^\d+-intro\.mp4$/);

    const bytes = await readFile(join(folder, done.output));
    expect(bytes.equals(await readFile(join(import.meta.dirname, "../../../assets/fixtures/render-stub.mp4")))).toBe(true);
    const sidecar = JSON.parse(await readFile(join(folder, done.output.replace(/\.mp4$/, ".json")), "utf8"));
    expect(sidecar).toEqual({ source: "render", of: "1-intro.html", title: "Intro!", mime: "video/mp4", fps: 30, quality: "standard", bytes: bytes.length, at: expect.any(String) });
    expect(sidecar).not.toHaveProperty("cost");

    const records = await room(rpc);
    const filled = records.find((record) => record.id === started.placeholder);
    expect(filled.meta.unframed?.run).toBeUndefined();
    const asset = records.find((record) => record.id === filled.props.assetId);
    expect(asset).toMatchObject({ type: "video", props: { name: done.output, src: `project-file:${done.output}`, mimeType: "video/mp4" } });
  });

  it("names an untitled render after motion and uses 16:9 for a composition with no size", async () => {
    const { rpc, folder } = await startRendering();
    await writeFile(join(folder, "2-bare.html"), "<div id=root></div>");
    const started = await rpc.call("motion.renderStart", { project: "board", file: "2-bare.html", shapeId: "shape:m1" });
    expect((await room(rpc)).find((record) => record.id === started.placeholder)?.props).toMatchObject({ w: 320, h: 180 });
    expect((await follow(rpc, started.id)).at(-1).output).toMatch(/^\d+-motion\.mp4$/);
  });

  it("hands tuned dials to the producer as unframedDials and records them in the sidecar", async () => {
    const { rpc, folder } = await startRendering();
    const tuned = await rpc.call("motion.renderStart", { project: "board", file: "1-intro.html", title: "Intro", shapeId: "shape:m1", dials: { accent: "#ff0000", scale: 1.5 } });
    const done = (await follow(rpc, tuned.id)).at(-1);
    expect(done.message).toBe('variables: {"unframedDials":{"accent":"#ff0000","scale":1.5}}');
    expect(JSON.parse(await readFile(join(folder, done.output.replace(/\.mp4$/, ".json")), "utf8")).dials).toEqual({ accent: "#ff0000", scale: 1.5 });

    for (const dials of [{}, [1, 2], "x"]) {
      const plain = await rpc.call("motion.renderStart", { project: "board", file: "1-intro.html", shapeId: "shape:m1", dials });
      const settled = (await follow(rpc, plain.id)).at(-1);
      expect(settled.message).toBe("variables: null");
      expect(JSON.parse(await readFile(join(folder, settled.output.replace(/\.mp4$/, ".json")), "utf8"))).not.toHaveProperty("dials");
    }
  });

  it("leaves no file behind when a render fails, reports why, and removes its placeholder", async () => {
    const { rpc, folder } = await startRendering("fail");
    const started = await rpc.call("motion.renderStart", { project: "board", file: "1-intro.html", shapeId: "shape:m1" });
    const failed = (await follow(rpc, started.id)).at(-1);
    expect(failed).toMatchObject({ status: "failed", error: "Stub render failed.", output: null });
    expect(await projectFiles(folder)).toEqual([]);
    expect((await room(rpc)).some((record) => record.id === started.placeholder)).toBe(false);
  });

  it("fails with the no-Chromium sentence when no browser is found", async () => {
    const { rpc, folder } = await startRendering("no-chrome");
    const started = await rpc.call("motion.renderStart", { project: "board", file: "1-intro.html", shapeId: "shape:m1" });
    expect((await follow(rpc, started.id)).at(-1)).toMatchObject({
      status: "failed",
      error: "Rendering needs a Chromium browser on this computer: Google Chrome, Chromium, Edge or Brave. Install one, or point UNFRAMED_CHROME_PATH at its binary, and render again.",
    });
    expect(await projectFiles(folder)).toEqual([]);
  });
});

describe("lifecycle changes while a motion renders", () => {
  it("refuse a rename, a delete and an output folder change while the render is live, and go through once it is done", async () => {
    const { rpc, engine } = await startRendering();
    const started = await rpc.call("motion.renderStart", { project: "board", file: "1-intro.html", shapeId: "shape:m1" });
    const refusal = { code: "conflict", message: "Wait for the 1 run still generating in this project to finish, then try again.", details: { liveRuns: 1 } };
    await expect(rpc.call("projects.rename", { name: "board", to: "renamed" })).rejects.toMatchObject(refusal);
    await expect(rpc.call("projects.delete", { name: "board", confirmRenders: true })).rejects.toMatchObject(refusal);
    await expect(rpc.call("settings.update", { outputDir: join(await makeTempDir(), "renders") })).rejects.toMatchObject(refusal);
    expect(existsSync(join(engine.dataDir, "output", "board"))).toBe(true);
    await follow(rpc, started.id);
    expect(await rpc.call("projects.rename", { name: "board", to: "renamed" })).toEqual({ name: "renamed", movedRenders: 0 });
    // Closing the project stopped tracking its renders.
    await expect(rpc.call("motion.renderStatus", { project: "board", id: started.id })).rejects.toMatchObject({ message: "No such render." });
  });
});
