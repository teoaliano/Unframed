import { mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_TAG, editBridgeSource, TOKENS_TAG } from "@unframed/domain";
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
    expect(answer).toEqual({ ready: false, elements: [], offTokens: [] });
  });

  it("refuses a file the project does not hold", async () => {
    await expect(rpc.call("artifact.sourceTree", { project: "board", file: "missing.html" })).rejects.toMatchObject({
      code: "not_found",
      message: "No file missing.html in this project.",
    });
  });

  it("refuses a file that is not HTML, even when it is in the project", async () => {
    await writeFile(join(folder, "1-notes.txt"), READY);
    await expect(rpc.call("artifact.sourceTree", { project: "board", file: "1-notes.txt" })).rejects.toMatchObject({
      code: "not_found",
      message: "No file 1-notes.txt in this project.",
    });
  });

  it("answers ready false for a motion whose file has the bridge and the ids but no runtime tag, and prepares it with the runtime", async () => {
    await writeFile(join(folder, "1-mnoruntime.html"), READY);
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    await tab.pushRaw([{ ...pageShape("mnoruntime", "104", { file: "1-mnoruntime.html", title: "No runtime" }), type: "motion" } as never]);
    await tab.close();
    expect((await rpc.call("artifact.sourceTree", { project: "board", file: "1-mnoruntime.html" })).ready).toBe(false);
    const prepared = await rpc.call("artifact.prepareEdit", { project: "board", shapeId: "shape:mnoruntime" });
    expect(prepared.file).not.toBe("1-mnoruntime.html");
    expect(await readFile(join(folder, prepared.file), "utf8")).toContain("data-hyperframes-preview-runtime");
    expect((await rpc.call("artifact.sourceTree", { project: "board", file: prepared.file })).ready).toBe(true);
  });

  it("writes a stamped version with the bridge and its edit sidecar for an unready page, and leaves the base file alone", async () => {
    const answer = await rpc.call("artifact.prepareEdit", { project: "board", shapeId: "shape:plain" });
    expect(answer.file).toMatch(/^\d+-plain\.html$/);
    const written = await readFile(join(folder, answer.file), "utf8");
    expect(written).toBe(stampElementIds(`${TOKENS_TAG}\n${BRIDGE_TAG}\n${UNSTAMPED}`));
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
      expect(written).toBe(stampElementIds(`${TOKENS_TAG}\n${BRIDGE_TAG}\n<h1 data-hf-id="hf-aaaa">Hello &amp; more</h1>`));
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

    it("refuses an image file the project does not hold, and a name that would write CSS, and writes nothing", async () => {
      await put(editable("e7"));
      const before = (await readdir(folder)).length;
      await expect(
        rpc.call("artifact.edit", { project: "board", shapeId: "shape:e7", baseFile: "1-ready.html", edits: [{ type: "image", elementId: "hf-aaaa", target: "background", file: "gone.png" }] }),
      ).rejects.toMatchObject({ code: "bad_request", message: "No file gone.png in this project." });
      await expect(
        rpc.call("artifact.edit", {
          project: "board",
          shapeId: "shape:e7",
          baseFile: "1-ready.html",
          edits: [{ type: "image", elementId: "hf-aaaa", target: "background", file: 'a");position:fixed;inset:0;x:("b.png' }],
        }),
      ).rejects.toMatchObject({ code: "bad_request" });
      expect((await readdir(folder)).length).toBe(before);
    });

    it("writes a background image from a project file that exists", async () => {
      await writeFile(join(folder, "1-pic.png"), "x");
      await put(editable("e8"));
      const answer = await rpc.call("artifact.edit", { project: "board", shapeId: "shape:e8", baseFile: "1-ready.html", edits: [{ type: "image", elementId: "hf-aaaa", target: "background", file: "1-pic.png" }] });
      expect(answer.summary).toEqual(["Image · Hi"]);
      expect(await readFile(join(folder, answer.file), "utf8")).toContain('background-image: url(&quot;1-pic.png&quot;)');
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

  describe("artifact.images", () => {
    it("lists the served image types newest first with their original names, and leaves out everything else", async () => {
      await rpc.call("projects.create", { name: "pics" });
      const dir = join(engine.dataDir, "output", "pics");
      await writeFile(join(dir, "10-old.png"), "x");
      await writeFile(join(dir, "10-old.json"), JSON.stringify({ source: "upload", fileName: "Red Fox.PNG" }));
      await writeFile(join(dir, "20-new.jpg"), "x");
      await writeFile(join(dir, "15-plain.webp"), "x");
      await writeFile(join(dir, "30-skip.avif"), "x");
      await writeFile(join(dir, "31-notes.txt"), "x");
      await mkdir(join(dir, ".cache"), { recursive: true });
      await writeFile(join(dir, ".cache", "pv.png"), "x");
      await utimes(join(dir, "10-old.png"), new Date(1_000_000), new Date(1_000_000));
      await utimes(join(dir, "15-plain.webp"), new Date(2_000_000), new Date(2_000_000));
      await utimes(join(dir, "20-new.jpg"), new Date(3_000_000), new Date(3_000_000));
      const answer = await rpc.call("artifact.images", { project: "pics" });
      expect(answer.images).toEqual([
        { file: "20-new.jpg", fileName: "20-new.jpg", at: 3_000_000 },
        { file: "15-plain.webp", fileName: "15-plain.webp", at: 2_000_000 },
        { file: "10-old.png", fileName: "Red Fox.PNG", at: 1_000_000 },
      ]);
    });

    it("refuses a project that does not exist", async () => {
      await expect(rpc.call("artifact.images", { project: "nowhere" })).rejects.toMatchObject({
        code: "not_found",
        message: 'There is no project named "nowhere".',
      });
    });
  });
});

describe("the preview origin and unframed-edit.js (spec 18)", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
    await (await engine.rpc()).call("projects.create", { name: "frames" });
  });
  afterAll(() => engine.dispose());

  it("writes the edit bridge beside the dials bridge and serves it with the usual headers, refreshing it when it differs", async () => {
    const folder = join(engine.dataDir, "output", "frames");
    await (await engine.rpc()).call("artifact.images", { project: "frames" });
    const upload = await engine.request("/api/projects/frames/files?name=page.html", {
      method: "POST",
      body: "<h1>x</h1>",
      headers: { "content-type": "text/html" },
    });
    expect(upload.status).toBe(200);
    expect((await readFile(join(folder, "unframed-edit.js"), "utf8")).split("\n")[0]).toBe(editBridgeSource().split("\n")[0]);

    await writeFile(join(folder, "unframed-edit.js"), "stale");
    const served = await engine.request(`/p/frames/unframed-edit.js`, { port: engine.previewPort, headers: { host: `127.0.0.1:${engine.previewPort}` } });
    expect(served.status).toBe(200);
    // The engine's copy of the source is its own text; the test process only compares the header line.
    expect(served.text.split("\n")[0]).toBe(editBridgeSource().split("\n")[0]);
    expect(served.text).toContain("installEditBridge");
    expect(served.headers["content-type"]).toMatch(/javascript/);
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["cache-control"]).toBe("no-cache");
  });
});
