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
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
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

  describe("artifact.edit", () => {
    const sidecarOf = async (file: string) => JSON.parse(await readFile(join(folder, file.replace(/\.html$/, ".json")), "utf8"));
    const put = async (record: unknown) => {
      const tab = await connectTab(engine.port, "board");
      await tab.loaded;
      const verdict = await tab.pushRaw([record as never]);
      await tab.close();
      return verdict;
    };
    const editable = (id: string, extra: Record<string, unknown> = {}) =>
      pageShape(id, "200", { file: "1-ready.html", title: "Ready", ...extra });

    it("writes the edited text as a new version with its edit sidecar, and leaves the base file and the shape alone", async () => {
      await put(editable("e1"));
      const answer = await rpc.call("artifact.edit", {
        project: "board",
        shapeId: "shape:e1",
        baseFile: "1-ready.html",
        edits: [{ type: "text", elementId: "hf-aaaa", text: "Hello & more" }],
      });
      expect(answer).toEqual({ file: expect.stringMatching(/^\d+-ready\.html$/), summary: ["Text · Hello & more"] });
      const written = await readFile(join(folder, answer.file), "utf8");
      expect(written).toBe(stampElementIds(`${BRIDGE_TAG}\n<h1 data-hf-id="hf-aaaa">Hello &amp; more</h1>`));
      expect(await readFile(join(folder, "1-ready.html"), "utf8")).toBe(READY);
      expect(await sidecarOf(answer.file)).toMatchObject({ source: "edit", kind: "page", of: "1-ready.html", shapeId: "shape:e1", edits: ["Text · Hello & more"], title: "Ready" });
      const read = (await rpc.call("testCanvas.read", { project: "board" })) as unknown as { records: Array<{ id: string; props?: { file?: string } }> };
      expect(read.records.find((record) => record.id === "shape:e1")?.props?.file).toBe("1-ready.html");
    });

    it("refuses an edit whose base file is no longer the shape's file, with the reason elsewhere after a person's change", async () => {
      await put(editable("e2"));
      await expect(rpc.call("artifact.edit", { project: "board", shapeId: "shape:e2", baseFile: "0-old.html", edits: [{ type: "hide", elementId: "hf-aaaa", hidden: true }] })).rejects.toMatchObject({
        code: "conflict",
        details: { reason: "elsewhere" },
      });
    });

    it("reports the reason agent when the file was moved by a chat", async () => {
      await put(editable("e3"));
      await rpc.call("testCanvas.apply", {
        project: "board",
        change: { put: [{ ...editable("e3"), props: { ...(editable("e3") as { props: object }).props, file: "2-agent.html" } }], remove: [] },
        origin: { kind: "server", id: "chat:c1" },
      });
      await expect(rpc.call("artifact.edit", { project: "board", shapeId: "shape:e3", baseFile: "1-ready.html", edits: [{ type: "hide", elementId: "hf-aaaa", hidden: true }] })).rejects.toMatchObject({
        code: "conflict",
        details: { reason: "agent" },
      });
    });

    it("refuses an empty list, a refused edit with its sentence, an unknown element, and a page over the limit, and writes nothing", async () => {
      await put(editable("e4"));
      const before = (await readdir(folder)).length;
      await expect(rpc.call("artifact.edit", { project: "board", shapeId: "shape:e4", baseFile: "1-ready.html", edits: [] })).rejects.toMatchObject({
        code: "bad_request",
        message: "There is nothing to save.",
      });
      await expect(
        rpc.call("artifact.edit", { project: "board", shapeId: "shape:e4", baseFile: "1-ready.html", edits: [{ type: "style", elementId: "hf-aaaa", property: "color", value: "red; x:1" }] }),
      ).rejects.toMatchObject({ code: "bad_request", message: 'Colour cannot be "red; x:1".' });
      await expect(rpc.call("artifact.edit", { project: "board", shapeId: "shape:e4", baseFile: "1-ready.html", edits: [{ type: "hide", elementId: "hf-zzzz", hidden: true }] })).rejects.toMatchObject({
        code: "bad_request",
        message: "There is no element hf-zzzz in this page any more.",
      });
      // The edit grows the page: the element's text is replaced by a longer run, past the limit.
      const big = `<h1 data-hf-id="hf-aaaa">Hi</h1><p>${"a".repeat(2_000_000)}</p>`;
      await writeFile(join(folder, "1-big.html"), big);
      await put(pageShape("e5", "201", { file: "1-big.html", title: "Big" }));
      await expect(
        rpc.call("artifact.edit", { project: "board", shapeId: "shape:e5", baseFile: "1-big.html", edits: [{ type: "text", elementId: "hf-aaaa", text: "b".repeat(200_000) }] }),
      ).rejects.toMatchObject({ code: "bad_request", message: expect.stringMatching(/^The page would be too large \(\d+ bytes; the limit is 2097152\)\.$/) });
      expect((await readdir(folder)).length).toBe(before + 1);
    });

    it("refuses a text edit on a locked element and lets rename and hide through", async () => {
      await put(editable("e6", { lockedElements: ["hf-aaaa"] }));
      await expect(
        rpc.call("artifact.edit", { project: "board", shapeId: "shape:e6", baseFile: "1-ready.html", edits: [{ type: "text", elementId: "hf-aaaa", text: "x" }] }),
      ).rejects.toMatchObject({ code: "bad_request", message: "Hi is locked. Unlock it in Layers to edit it." });
      const renamed = await rpc.call("artifact.edit", {
        project: "board",
        shapeId: "shape:e6",
        baseFile: "1-ready.html",
        edits: [
          { type: "attribute", elementId: "hf-aaaa", name: "data-uf-name", value: "Title" },
          { type: "hide", elementId: "hf-aaaa", hidden: true },
        ],
      });
      expect(renamed.summary).toEqual(["Name · Title", "Hidden · Title"]);
    });
  });
});
