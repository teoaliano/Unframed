import { describe, expect, it } from "vitest";
import { legacyRecords } from "../../src/index.ts";
import { mapSample, sampleFacts, shapesOf } from "./facts.ts";
import { edge, image, prompt, type Json } from "./journal.ts";
import { at, mapNodes, PNG_64x40, section } from "./mapping.ts";

const ids = { page: "page:page", shape: (key: string) => `shape:${key}`, asset: (key: string) => `asset:${key}` };
const output = (id: string, type: string, x: number, y: number, data: Json = {}): Json => ({ id, type, ...at(x, y), data });
const RUN_1 = "2026-09-10T09-30-07-000Z-a-red-fox-standing-on-a-windswept-cliff--1.png";
const RUN_2 = "2026-09-10T09-30-14-000Z-a-red-fox-standing-on-a-windswept-cliff--2.png";

describe("image results", () => {
  it("make the image already on the canvas a result in place, and do not add it twice", () => {
    const { ref, list } = shapesOf(mapSample("everything"));
    expect(ref("141")).toMatchObject({ key: "node:141", x: 440, y: 260, media: { file: RUN_1 }, result: { medium: "image", runIndex: 1, runCount: 3 } });
    expect(list.filter((shape) => shape.media?.kind === "file" && shape.media.file === RUN_1)).toHaveLength(1);
  });

  it("add the rest as result shapes at the output's position, 240 wide, in runIndex order with a gap of 24", () => {
    const { key } = shapesOf(mapSample("everything"));
    expect(key("result:140:1")).toMatchObject({ kind: "image", ref: "211", x: 440, y: 0, w: 240, h: 150, media: { file: RUN_2 } });
    const mapped = mapNodes(
      [output("140", "imageOutput", 500, 0, { results: [2, 0, 1].map((run) => ({ savedPath: `/elsewhere/r${run}.png`, runIndex: run, cost: 0.01 })) })],
      [],
      { files: ["r0.png", "r1.png", "r2.png"], imageSizes: { "r0.png": { w: 100, h: 100 }, "r1.png": { w: 200, h: 100 }, "r2.png": { w: 100, h: 200 } } },
    );
    const results = shapesOf(mapped).list.filter((shape) => shape.result !== undefined);
    expect(results.map((shape) => [shape.media && "file" in shape.media ? shape.media.file : "", shape.x, shape.y, shape.w, shape.h])).toEqual([
      ["r0.png", 500, 224, 240, 240],
      ["r1.png", 764, 224, 240, 120],
      ["r2.png", 1028, 224, 240, 480],
    ]);
  });

  it("find their file by saved path, then by the /api/file/ URL, then by a data URL written out", () => {
    const mapped = mapNodes(
      [
        output("140", "imageOutput", 0, 0, {
          results: [
            { savedPath: "/gone/a.png", url: "/api/file/p/b%20c.png", runIndex: 0 },
            { url: PNG_64x40, runIndex: 1 },
          ],
        }),
      ],
      [],
      { files: ["b c.png"] },
    );
    const files = shapesOf(mapped).list.flatMap((shape) => (shape.media?.kind === "file" ? [shape.media.file] : []));
    expect(files).toEqual(["b c.png", "legacy-5c59251f1b05f008-upload.png"]);
  });

  it("count and report the ones whose file is gone", () => {
    const mapped = mapSample("everything");
    expect(section(mapped, "missing")).toContain("1 results of @140 are no longer in the project folder.");
  });

  it("start their row 24 below a recipe group that stands where the output was", () => {
    const { key } = shapesOf(mapSample("legacy-snapshot"));
    expect(key("group:102")).toMatchObject({ x: 440, y: 0, h: 200 });
    expect(key("result:102:0")).toMatchObject({ x: 440, y: 224, w: 240, h: 150, media: { file: "legacy-cf4b71560e735285-upload.png" } });
  });
});

describe("video results", () => {
  it("come from data.result as a video result shape", () => {
    const { key } = shapesOf(mapSample("everything"));
    expect(key("result:160:0")).toMatchObject({
      kind: "video",
      ref: "214",
      x: 440,
      y: 1400,
      w: 240,
      h: 135,
      media: { kind: "file", file: "2026-09-10T09-40-00-000Z-the-fox-turns-its-head-toward-the-camera.mp4", mime: "video/mp4" },
      result: { medium: "video", cost: 0.12 },
    });
  });

  it("make a video already on the canvas the result in place", () => {
    const clip = "2026-09-10T09-40-00-000Z-the-fox-turns-its-head-toward-the-camera.mp4";
    const mapped = mapNodes(
      [{ id: "165", type: "video", ...at(0, 0), width: 240, data: { file: clip, fileName: clip } }, output("160", "videoOutput", 400, 0, { result: { url: `/api/file/p/${clip}`, cost: 0.12 } })],
      [],
      sampleFacts("everything"),
    );
    const { list, ref } = shapesOf(mapped);
    expect(ref("165").result).toMatchObject({ medium: "video" });
    expect(list.filter((shape) => shape.kind === "video")).toHaveLength(1);
  });
});

describe("result recipes", () => {
  it("come from an image sidecar: its model and params, marked approximate with the prompt it sent, and the sources as wired", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("141").result).toEqual({
      sidecar: "2026-09-10T09-30-07-000Z-a-red-fox-standing-on-a-windswept-cliff--1.json",
      medium: "image",
      model: "openai/gpt-image-2",
      batchId: "b-1789032600000",
      runIndex: 1,
      runCount: 3,
      cost: 0.0061,
      sources: ["node:100", "node:106"],
      recipe: {
        medium: "image",
        model: "openai/gpt-image-2",
        params: { resolution: "1K", quality: "low", aspect_ratio: "3:2", output_format: "png" },
        selectionPrompt: "",
        instruction: "",
        references: [],
        sources: ["node:100", "node:106"],
        approximate: true,
        sentPrompt: "A red fox standing on a windswept cliff at golden hour, 35mm",
      },
    });
  });

  it("come from a video sidecar", () => {
    const { key } = shapesOf(mapSample("everything"));
    expect(key("result:160:0").result).toMatchObject({
      sidecar: "2026-09-10T09-40-00-000Z-the-fox-turns-its-head-toward-the-camera.json",
      model: "bytedance/seedance-2.0",
      sources: ["node:161", "node:162"],
      recipe: { medium: "video", params: { duration: 5, resolution: "480p" }, approximate: true, sentPrompt: "The fox turns its head toward the camera" },
    });
  });

  it("come from the newest text sidecar whose result is the answer exactly", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("170").result).toEqual({
      sidecar: "2026-09-10T09-58-00-000Z-text-describe-image-1-in-one-sentence.json",
      medium: "text",
      model: "google/gemini-3.5-flash-lite",
      batchId: "b-1789034280000",
      runIndex: 1,
      runCount: 1,
      cost: 0.0004,
      sources: ["node:172"],
      recipe: {
        medium: "text",
        model: "google/gemini-3.5-flash-lite",
        params: {},
        selectionPrompt: "",
        instruction: "",
        references: [],
        sources: ["node:172"],
        approximate: true,
        sentPrompt: "Describe image 1 in one sentence.",
      },
    });
  });

  it("come from the output's data when there is no sidecar", () => {
    const mapped = mapNodes(
      [prompt("100", "fox"), output("140", "imageOutput", 400, 0, { model: "a/b", quality: "low", results: [{ savedPath: "/x/r.png", runIndex: 0, cost: 0.02 }] }), output("170", "textOutput", 400, 400, { text: "", result: "An answer.", model: "c/d", cost: 0.001 })],
      [edge("100", "140"), edge("100", "170")],
      { files: ["r.png"] },
    );
    const { key } = shapesOf(mapped);
    expect(key("result:140:0").result).toMatchObject({ sidecar: null, model: "a/b", cost: 0.02, runIndex: 1, runCount: 1, recipe: { params: { quality: "low" }, approximate: true } });
    expect(key("result:140:0").result!.recipe).not.toHaveProperty("sentPrompt");
    expect(key("answer:170").result).toMatchObject({ sidecar: null, model: "c/d", cost: 0.001, recipe: { medium: "text", model: "c/d" } });
  });

  it("carry their sources as shape ids, in the result meta and in the recipe, when written as records", () => {
    const records = legacyRecords(mapSample("everything").canvas.shapes, ids).shapes;
    const result = records.find((record) => record.meta.ref === "141")!.meta.unframed as { result: { sources: string[]; recipe: { sources: string[] } } };
    expect(result.result.sources).toEqual(["shape:node:100", "shape:node:106"]);
    expect(result.result.recipe.sources).toEqual(["shape:node:100", "shape:node:106"]);
  });
});

describe("a media shape whose file a run made", () => {
  it("becomes a result even when no output lists it", () => {
    const mapped = mapNodes([image("141", { data: { file: RUN_2, fileName: RUN_2 } })], [], sampleFacts("everything"));
    expect(shapesOf(mapped).ref("141").result).toMatchObject({ sidecar: RUN_2.replace(".png", ".json"), medium: "image", runIndex: 2, sources: [], recipe: { approximate: true, sources: [] } });
  });

  it("does not when its sidecar is an upload's, a copy's, a render's or an agent's", () => {
    const { ref } = shapesOf(mapSample("everything"));
    for (const id of ["106", "110", "202", "210"]) expect(ref(id).result).toBeUndefined();
    const sidecars = {
      "a.png": { source: "agent", kind: "page", threadId: "t-1", turn: 1, nodeId: "100", title: "A", bytes: 1, at: "x" },
      "b.png": { kind: "agent-turn", threadId: "t-1", turn: 1, provider: "claude", model: "claude-sonnet-5", billing: "subscription", usage: {}, at: "x" },
      "c.png": { source: "legacy-graph", fileName: "c.png", mime: "image/png", bytes: 1, at: "x" },
    };
    const mapped = mapNodes(
      ["a", "b", "c"].map((name, index) => image(`10${index}`, { ...at(0, index * 300), data: { file: `${name}.png`, fileName: `${name}.png` } })),
      [],
      { files: ["a.png", "b.png", "c.png"], sidecars },
    );
    expect(shapesOf(mapped).list.every((shape) => shape.result === undefined)).toBe(true);
  });
});

describe("in-flight runs", () => {
  it("drop an image output's run marker and say so", () => {
    expect(section(mapSample("everything"), "notKept")).toContain(
      "@190 had a run in flight when the old app last saved. It was not resumed. Any image it finished is in the project folder.",
    );
  });

  it("drop a text output's run marker and say so", () => {
    const mapped = mapNodes([output("170", "textOutput", 0, 0, { text: "", result: "", running: { startedAt: 1 } })]);
    expect(section(mapped, "notKept")).toContain("@170 had a run in flight when the old app last saved. It was not resumed. Any image it finished is in the project folder.");
  });

  it("put a render placeholder bound to a pending job where its result will land", () => {
    const mapped = mapSample("everything");
    const { key } = shapesOf(mapped);
    expect(key("render:163")).toMatchObject({
      kind: "video",
      ref: "215",
      x: 440,
      y: 1900,
      w: 240,
      h: 135,
      render: { jobId: "vid_2f8c1e7a9b", startedAt: 1789036200000, params: { prompt: "Slow push-in toward the cliff at dusk", model: "bytedance/seedance-2.0", duration: 5, resolution: "720p", size: null } },
      result: { sidecar: null, medium: "video", sources: ["node:164"], recipe: { approximate: true, sentPrompt: "Slow push-in toward the cliff at dusk" } },
    });
    expect(key("render:163").media).toBeUndefined();
    expect(section(mapped, "changed")).toContain("@163 had a render in flight. It is still tracked and lands here when it finishes.");
    const record = legacyRecords(mapped.canvas.shapes, ids).shapes.find((each) => each.id === "shape:render:163")!;
    expect(record).toMatchObject({
      type: "video",
      props: { assetId: null },
      meta: {
        unframed: {
          run: { runId: "vid_2f8c1e7a9b", runIndex: 1, startedAt: 1789036200000, durable: { params: { prompt: "Slow push-in toward the cliff at dusk", model: "bytedance/seedance-2.0", duration: 5, resolution: "720p", size: null } } },
          result: { sidecar: null },
        },
      },
    });
  });

  it("make a done job's clip the video result", () => {
    const { key } = shapesOf(mapSample("legacy-snapshot"));
    expect(key("result:103:0")).toMatchObject({ kind: "video", x: 440, y: 524, media: { file: "2026-09-10T12-20-00-000Z-a-fox-running-along-the-beach-at-low-tid.mp4" }, result: { cost: 0.1 } });
  });

  it("add nothing for a failed job and report its error", () => {
    const mapped = mapSample("everything");
    expect(shapesOf(mapped).list.some((shape) => shape.key.endsWith(":131") && shape.kind !== "group")).toBe(false);
    expect(section(mapped, "notKept")).toContain("@131's render failed: The provider rejected the request: duration must be 4, 5, 6 or 8 seconds.");
  });

  it("add nothing for a job the store does not know, and report it", () => {
    const mapped = mapSample("broken-snapshot");
    expect(shapesOf(mapped).list.some((shape) => shape.render !== undefined)).toBe(false);
    expect(section(mapped, "notKept")).toContain("@102 was waiting for a render the job store no longer knows about. Nothing was resumed.");
  });
});

describe("wires", () => {
  it("disappear, and the report counts them", () => {
    const mapped = mapSample("everything");
    expect(mapped.report.counts.wiresRemoved).toBe(14);
    expect(mapped.report.items[0]).toEqual({ section: "changed", text: "Wires are gone: the selection is the input now. 14 wires were removed." });
    expect(section(mapNodes([prompt("100")]), "changed")).toEqual([]);
  });
});

describe("determinism", () => {
  it("maps the samples to the same description twice", () => {
    for (const project of ["everything", "legacy-snapshot", "broken-snapshot"]) {
      expect(mapSample(project)).toEqual(mapSample(project));
    }
  });
});
