import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pageShape } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

const SAMPLE = readFileSync(join(import.meta.dirname, "../../../assets/fixtures/motion-samples/01-literal-two-clips.html"), "utf8");

describe("artifact.edit with motion edits", () => {
  let engine: TestEngine;
  let folder: string;
  let rpc: Awaited<ReturnType<TestEngine["rpc"]>>;
  let prepared: string;
  let titleId: string;
  let tweenRef: { index: number; id: string };

  const put = async (record: unknown) => {
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    const verdict = await tab.pushRaw([record as never]);
    await tab.close();
    return verdict;
  };
  const motion = (id: string, ref: string, extra: Record<string, unknown> = {}) => ({ ...pageShape(id, ref, { file: prepared, title: "Intro", ...extra }), type: "motion" }) as never;

  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    folder = join(engine.dataDir, "output", "board");
    await writeFile(join(folder, "1-intro.html"), SAMPLE);
    await put(motion("m0", "300", { file: "1-intro.html" }));
    prepared = (await rpc.call("artifact.prepareEdit", { project: "board", shapeId: "shape:m0" })).file;
    const reading = await rpc.call("motion.timeline", { project: "board", file: prepared });
    titleId = reading.tweens[0]!.targets[0]!;
    tweenRef = { index: reading.tweens[0]!.ref.index, id: reading.tweens[0]!.ref.id };
  });
  afterAll(() => engine.dispose());

  it("writes a moved tween as a new version with its sidecar, keeping the element ids and the base file", async () => {
    await put(motion("m1", "301"));
    const before = (await readdir(folder)).length;
    const answer = await rpc.call("artifact.edit", {
      project: "board",
      shapeId: "shape:m1",
      baseFile: prepared,
      edits: [{ type: "tween-time", tween: tweenRef, start: 1 }],
    });
    expect(answer).toEqual({ file: expect.stringMatching(/^\d+-intro\.html$/), summary: ["Moved title position to 1 s"] });
    expect((await readdir(folder)).length).toBe(before + 2);
    const written = await readFile(join(folder, answer.file), "utf8");
    expect(written).toContain(`data-hf-id="${titleId}"`);
    expect(written).toMatch(/fromTo\('#title'[^]*?,\s*1\s*\)/);
    expect(await readFile(join(folder, prepared), "utf8")).not.toEqual(written);
    const sidecar = JSON.parse(await readFile(join(folder, answer.file.replace(/\.html$/, ".json")), "utf8"));
    expect(sidecar).toMatchObject({ source: "edit", kind: "motion", of: prepared, shapeId: "shape:m1", edits: ["Moved title position to 1 s"] });
  });

  it("refuses a stale base file with the conflict, and writes nothing", async () => {
    await put(motion("m2", "302"));
    const before = (await readdir(folder)).length;
    await expect(
      rpc.call("artifact.edit", { project: "board", shapeId: "shape:m2", baseFile: "0-old.html", edits: [{ type: "tween-time", tween: tweenRef, start: 1 }] }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await readdir(folder)).length).toBe(before);
  });

  it("refuses a tween whose target is locked on the shape, naming the element, and writes nothing", async () => {
    await put(motion("m3", "303", { lockedElements: [titleId] }));
    const before = (await readdir(folder)).length;
    await expect(
      rpc.call("artifact.edit", { project: "board", shapeId: "shape:m3", baseFile: prepared, edits: [{ type: "tween-time", tween: tweenRef, start: 1 }] }),
    ).rejects.toMatchObject({ code: "bad_request", message: "title is locked. Unlock it in Layers to edit it." });
    expect((await readdir(folder)).length).toBe(before);
  });

  it("refuses a token when the project has no kit", async () => {
    await put(motion("m4", "304"));
    await expect(
      rpc.call("artifact.edit", {
        project: "board",
        shapeId: "shape:m4",
        baseFile: prepared,
        edits: [{ type: "tween-ease", tween: tweenRef, ease: { token: "ease/fast" } }],
      }),
    ).rejects.toMatchObject({ code: "bad_request", message: "ease/fast is not an easing token of this project's kit." });
  });

  it("takes a tween-ease to a kit easing token, and refuses a token of another type", async () => {
    const kit = {
      format: 1,
      name: "Brand",
      modes: ["light"],
      tokens: [
        { path: "ease/fast", type: "easing", value: "power2.out" },
        { path: "color/brand", type: "color", value: "#1a73e8" },
      ],
    };
    await put({ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit } } });
    await put(motion("m6", "306"));
    const answer = await rpc.call("artifact.edit", {
      project: "board",
      shapeId: "shape:m6",
      baseFile: prepared,
      edits: [{ type: "tween-ease", tween: tweenRef, ease: { token: "ease/fast" } }],
    });
    expect(answer.summary).toEqual([expect.stringContaining("ease/fast")]);
    expect(await readFile(join(folder, answer.file), "utf8")).toContain('unframed.token("ease/fast")');
    await expect(
      rpc.call("artifact.edit", {
        project: "board",
        shapeId: "shape:m6",
        baseFile: prepared,
        edits: [{ type: "tween-ease", tween: tweenRef, ease: { token: "color/brand" } }],
      }),
    ).rejects.toMatchObject({ code: "bad_request", message: "color/brand is not an easing token of this project's kit." });
  });

  it("refuses a motion edit on a page, which has no timeline", async () => {
    await put(pageShape("p5", "305", { file: prepared, title: "Page" }));
    await expect(
      rpc.call("artifact.edit", { project: "board", shapeId: "shape:p5", baseFile: prepared, edits: [{ type: "composition-duration", seconds: 3 }] }),
    ).rejects.toMatchObject({ code: "bad_request", message: "This page has no timeline." });
  });
});
