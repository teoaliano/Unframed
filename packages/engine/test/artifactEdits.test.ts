import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_TAG } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pageShape } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

const READY = `${BRIDGE_TAG}\n<h1 data-hf-id="hf-aaaa">Hi</h1>`;
const UNSTAMPED = "<h1>Hi</h1>";

describe("artifact.sourceTree and artifact.prepareEdit (spec 18)", () => {
  let engine: TestEngine;
  let folder: string;
  let rpc: Awaited<ReturnType<TestEngine["rpc"]>>;

  beforeAll(async () => {
    engine = await startEngine();
    rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    folder = join(engine.dataDir, "output", "board");
    await writeFile(join(folder, "1-ready.html"), READY);
    await writeFile(join(folder, "1-plain.html"), UNSTAMPED);
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    await tab.pushRaw([
      pageShape("ready", "100", { file: "1-ready.html", title: "Ready" }),
      pageShape("plain", "101", { file: "1-plain.html", title: "Plain" }),
      pageShape("empty", "102", { file: "", title: "Empty" }),
      { ...pageShape("motion", "103", { file: "1-plain.html" }), type: "motion" } as never,
    ]);
    await tab.close();
  });
  afterAll(() => engine.dispose());

  it("answers the elements of a ready file and ready true when every element has its id and the bridge is in", async () => {
    const answer = await rpc.call("artifact.sourceTree", { project: "board", file: "1-ready.html" });
    expect(answer.ready).toBe(true);
    expect(answer.elements).toEqual([expect.objectContaining({ id: "hf-aaaa", tag: "h1", parent: null, index: 0, name: "Hi", hidden: false })]);
  });

  it("answers ready false for a file without the bridge or without ids", async () => {
    const answer = await rpc.call("artifact.sourceTree", { project: "board", file: "1-plain.html" });
    expect(answer).toEqual({ ready: false, elements: [] });
  });

  it("refuses a file the project does not hold", async () => {
    await expect(rpc.call("artifact.sourceTree", { project: "board", file: "missing.html" })).rejects.toMatchObject({
      code: "not_found",
      message: "No file missing.html in this project.",
    });
  });

  it("writes a stamped version with the bridge and its edit sidecar for an unready page, and leaves the base file alone", async () => {
    const answer = await rpc.call("artifact.prepareEdit", { project: "board", shapeId: "shape:plain" });
    expect(answer.file).toMatch(/^\d+-plain\.html$/);
    const written = await readFile(join(folder, answer.file), "utf8");
    expect(written).toBe(stampElementIds(`${BRIDGE_TAG}\n${UNSTAMPED}`));
    expect(await readFile(join(folder, "1-plain.html"), "utf8")).toBe(UNSTAMPED);
    const sidecar = JSON.parse(await readFile(join(folder, answer.file.replace(/\.html$/, ".json")), "utf8"));
    expect(sidecar).toEqual({
      source: "edit",
      kind: "page",
      of: "1-plain.html",
      shapeId: "shape:plain",
      edits: ["Element ids added"],
      title: "Plain",
      bytes: Buffer.byteLength(written),
      at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
  });

  it("answers the current file for a page that is already ready, writing nothing", async () => {
    const before = (await readdir(folder)).length;
    expect(await rpc.call("artifact.prepareEdit", { project: "board", shapeId: "shape:ready" })).toEqual({ file: "1-ready.html" });
    expect((await readdir(folder)).length).toBe(before);
  });

  it("refuses a shape that is not a page or motion, a missing shape, and an artifact with no file", async () => {
    await expect(rpc.call("artifact.prepareEdit", { project: "board", shapeId: "shape:nope" })).rejects.toMatchObject({
      code: "not_found",
      message: "There is no page or motion shape:nope on this canvas.",
    });
    await expect(rpc.call("artifact.prepareEdit", { project: "board", shapeId: "shape:empty" })).rejects.toMatchObject({
      code: "not_found",
      message: "This page has no file yet.",
    });
  });
});
