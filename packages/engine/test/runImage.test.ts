import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imageShape, videoAsset, videoShape } from "./canvasRecords.ts";
import { eventsOf, finished, KEY, pngBytes, runRequest, startGenerating, until, type Generating } from "./generation.ts";
import { gate } from "./openRouterStub.ts";
import { startEngine } from "./harness.ts";

const folderOf = (generating: Generating) => join(generating.engine.dataDir, "output", "board");

const upload = async (generating: Generating, name: string, bytes: Buffer, mime: string) =>
  (await generating.engine.request(`/api/projects/board/files?name=${encodeURIComponent(name)}`, { method: "POST", body: bytes, headers: { "content-type": mime } })).json()
    .file as string;

const roomShapes = async (generating: Generating) =>
  ((await generating.rpc.call("testCanvas.read", { project: "board" })).records as any[]).filter((record) => record.typeName === "shape");

const filesIn = async (generating: Generating) => (await readdir(folderOf(generating))).filter((name) => !name.startsWith(".") && name !== "unframed.sqlite" && !name.startsWith("unframed.sqlite"));

describe("run.image validation", () => {
  let generating: Generating;
  beforeAll(async () => {
    generating = await startGenerating();
  });
  afterAll(() => generating.engine.dispose());

  it.each([
    ["no outputs", runRequest({ outputs: [] }), "bad_request", "A run makes between 1 and 10 images."],
    [
      "eleven outputs",
      runRequest({ outputs: Array.from({ length: 11 }, () => ({ prompt: "fox", references: [] })) }),
      "bad_request",
      "A run makes between 1 and 10 images.",
    ],
    ["every prompt empty", runRequest({ outputs: [{ prompt: "  \n ", references: [] }] }), "bad_request", "Prompt is empty. Select a prompt, or type an instruction."],
    [
      "a reference file not in the project",
      runRequest({ outputs: [{ prompt: "fox", references: [{ kind: "image", file: "../elsewhere/missing.png" }] }] }),
      "not_found",
      "Reference file not found in this project: missing.png",
    ],
    [
      "a video link that is not https",
      runRequest({ outputs: [{ prompt: "fox", references: [{ kind: "video", url: "http://example.com/clip.mp4" }] }] }),
      "bad_request",
      "A video link must start with https://.",
    ],
  ])("refuses %s and writes nothing", async (_case, request, code, message) => {
    const before = await roomShapes(generating);
    await expect(generating.rpc.call("run.image", request)).rejects.toMatchObject({ code, message });
    expect(await roomShapes(generating)).toEqual(before);
    expect(await filesIn(generating)).toEqual([]);
    expect(generating.requests).toEqual([]);
  });

  it("refuses a run with no key before anything else", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    await expect(rpc.call("run.image", runRequest({ outputs: [] }))).rejects.toMatchObject({
      code: "unavailable",
      message: "No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).",
    });
    expect((await rpc.call("testCanvas.read", { project: "board" })).records.filter((record: any) => record.typeName === "shape")).toHaveLength(2);
  });
});

describe("run.image, one output", () => {
  let generating: Generating;
  beforeAll(async () => {
    generating = await startGenerating();
  });
  afterAll(() => generating.engine.dispose());

  it("answers once its placeholder is in the room, then fills it with the file and result meta", async () => {
    const photo = await upload(generating, "photo.png", pngBytes(40, 20), "image/png");
    const clip = await upload(generating, "clip.mp4", Buffer.from("fake mp4 bytes"), "video/mp4");
    const held = gate<void>();
    generating.answer(async () => {
      await held.promise;
      return { kind: "image", bytes: pngBytes(300, 200), mediaType: "image/png", cost: 0.042 };
    });

    const started = await generating.rpc.call(
      "run.image",
      runRequest({
        model: "google/gemini-3-pro-image",
        params: { quality: "auto", background: "auto", aspect_ratio: "3:2", resolution: "1K" },
        selectionPrompt: "a lone red fox",
        instruction: "at dawn",
        outputs: [
          {
            prompt: "a lone red fox\n\nat dawn",
            references: [
              { kind: "image", file: photo },
              { kind: "video", file: clip },
              { kind: "video", url: "https://example.com/linked.mp4" },
            ],
          },
        ],
        sources: ["shape:starter-subject"],
        anchor: { x: 40, y: 60, w: 320, h: 300 },
      }),
    );
    expect(started.batchId).toMatch(/^b-\d+$/);
    expect(started.placeholders).toHaveLength(1);

    // The placeholder is in the room before the reply, carrying its marker and unfilled result meta.
    const [placeholder] = (await roomShapes(generating)).filter((shape) => shape.id === started.placeholders[0]);
    expect(placeholder).toMatchObject({
      type: "image",
      props: { w: 320, h: (320 * 2) / 3, assetId: null },
      meta: {
        ref: "102",
        unframed: {
          run: { runId: started.runId, runIndex: 1, startedAt: expect.any(Number) },
          result: {
            sidecar: null,
            medium: "image",
            model: "google/gemini-3-pro-image",
            batchId: started.batchId,
            runIndex: 1,
            runCount: 1,
            cost: null,
            sources: ["shape:starter-subject"],
          },
        },
      },
    });
    expect(placeholder.x).toBeGreaterThanOrEqual(40 + 320 + 40);

    await until(() => (generating.requests.length === 1 ? true : undefined), "the upstream call");
    held.release();
    const done = await finished(generating.events, started.runId);
    expect(done).toEqual({ type: "finished", runId: started.runId, succeeded: 1, failed: 0, errors: [], orphaned: 0 });

    // The upstream payload: only set params, auto dropped, references inlined.
    const [call] = generating.requests;
    expect(call!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call!.body).toEqual({
      model: "google/gemini-3-pro-image",
      prompt: "a lone red fox\n\nat dawn",
      aspect_ratio: "3:2",
      resolution: "1K",
      input_references: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${pngBytes(40, 20).toString("base64")}` } },
        { type: "video_url", video_url: { url: `data:video/mp4;base64,${Buffer.from("fake mp4 bytes").toString("base64")}` } },
        { type: "video_url", video_url: { url: "https://example.com/linked.mp4" } },
      ],
    });

    // The file and its sidecar.
    const stamp = new Date(placeholder.meta.unframed.run.startedAt).toISOString().replace(/[:.]/g, "-");
    const file = `${stamp}-a-lone-red-fox-at-dawn.png`;
    expect(await readFile(join(folderOf(generating), file))).toEqual(pngBytes(300, 200));
    const sidecar = JSON.parse(await readFile(join(folderOf(generating), `${stamp}-a-lone-red-fox-at-dawn.json`), "utf8"));
    expect(sidecar).toEqual({
      prompt: "a lone red fox\n\nat dawn",
      model: "google/gemini-3-pro-image",
      resolution: "1K",
      quality: "auto",
      aspect_ratio: "3:2",
      background: "auto",
      referenceCount: 3,
      references: { images: 1, videos: 2 },
      batchId: started.batchId,
      runIndex: 1,
      runCount: 1,
      cost: 0.042,
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      file,
      recipe: {
        medium: "image",
        model: "google/gemini-3-pro-image",
        params: { quality: "auto", background: "auto", aspect_ratio: "3:2", resolution: "1K" },
        selectionPrompt: "a lone red fox",
        instruction: "at dawn",
        references: [
          { kind: "image", file: photo },
          { kind: "video", file: clip },
          { kind: "video", url: "https://example.com/linked.mp4" },
        ],
        sources: ["shape:starter-subject"],
      },
    });

    // The placeholder, filled in place: the file's aspect at its width, no marker.
    const records = (await generating.rpc.call("testCanvas.read", { project: "board" })).records as any[];
    const filled = records.find((record) => record.id === started.placeholders[0]);
    expect(filled.meta.unframed.run).toBeUndefined();
    expect(filled.meta.unframed.result).toMatchObject({ sidecar: `${stamp}-a-lone-red-fox-at-dawn.json`, cost: 0.042, model: "google/gemini-3-pro-image" });
    expect(filled.props.h).toBeCloseTo((320 * 200) / 300);
    expect(filled.x).toBe(placeholder.x);
    const asset = records.find((record) => record.id === filled.props.assetId);
    expect(asset).toMatchObject({ type: "image", props: { src: `project-file:${file}`, w: 300, h: 200, mimeType: "image/png", name: file } });

    expect(eventsOf(generating.events, started.runId)).toEqual([
      { type: "started", runId: started.runId, batchId: started.batchId, count: 1 },
      { type: "output", runId: started.runId, runIndex: 1, ok: true, shapeId: started.placeholders[0], file, cost: 0.042 },
      done,
    ]);
    expect(generating.engine.stdout()).toContain(`  generated → ${join(folderOf(generating), file)}  ($0.0420)`);
  });

  it("sends no input_references without references, and uses the default model and a given batch id", async () => {
    generating.answer(() => ({ kind: "image", bytes: pngBytes(10, 10), cost: null }));
    const before = generating.requests.length;
    const started = await generating.rpc.call("run.image", runRequest({ batchId: "b-12345" }));
    expect(started.batchId).toBe("b-12345");
    await finished(generating.events, started.runId);
    expect(generating.requests[before]!.body).toEqual({ model: "openai/gpt-image-2", prompt: "a lone red fox" });
    const records = (await generating.rpc.call("testCanvas.read", { project: "board" })).records as any[];
    const filled = records.find((record) => record.id === started.placeholders[0]);
    expect(filled.meta.unframed.result).toMatchObject({ batchId: "b-12345", cost: null });
    expect(filled.props.h).toBe(320);
  });

  it("records the result it came from in the recipe's of", async () => {
    generating.answer(() => ({ kind: "image", bytes: pngBytes(10, 10) }));
    const first = await generating.rpc.call("run.image", runRequest());
    await finished(generating.events, first.runId);
    const records = (await generating.rpc.call("testCanvas.read", { project: "board" })).records as any[];
    const sidecar = records.find((record) => record.id === first.placeholders[0]).meta.unframed.result.sidecar;
    const second = await generating.rpc.call("run.image", runRequest({ of: { shapeId: first.placeholders[0]!, action: "vary" } }));
    await finished(generating.events, second.runId);
    const recipe = await generating.rpc.call("recipe.read", { project: "board", shapeId: second.placeholders[0]! });
    expect(recipe.of).toEqual({ sidecar, action: "vary" });
  });
});

describe("result file names", () => {
  let generating: Generating;
  beforeAll(async () => {
    generating = await startGenerating();
  });
  afterAll(() => generating.engine.dispose());

  const stampOf = async (placeholder: string) => {
    const record = (await roomShapes(generating)).find((shape) => shape.id === placeholder);
    return new Date(record.meta.unframed.run.startedAt).toISOString().replace(/[:.]/g, "-");
  };

  it.each([
    ["the extension from the media type", "image/webp", undefined, "a fox", "a-fox.webp"],
    ["a subtype before a plus", "image/svg+xml", undefined, "vector fox", "vector-fox.svg"],
    ["png for an odd media type", "image/x.weird", undefined, "odd", "odd.png"],
    ["the requested format when no media type comes back", null, "jpeg", "jpeg fox", "jpeg-fox.jpeg"],
    ["image for an empty slug", "image/png", undefined, "🦊 !!!", "image.png"],
    ["the slug cut to 40 characters", "image/png", undefined, "a very long prompt about a fox that goes on and on and on", "a-very-long-prompt-about-a-fox-that-goes.png"],
  ])("takes %s", async (_case, mediaType, format, prompt, tail) => {
    generating.answer(() => ({ kind: "image", bytes: pngBytes(8, 8), mediaType }));
    const started = await generating.rpc.call(
      "run.image",
      runRequest({ params: format === undefined ? {} : { output_format: format }, outputs: [{ prompt, references: [] }] }),
    );
    const stamp = await stampOf(started.placeholders[0]!);
    await finished(generating.events, started.runId);
    expect(await filesIn(generating)).toContain(`${stamp}-${tail}`);
  });

  it("never overwrites: a taken name retries as -2 up to -5, and a sixth fails the output", async () => {
    const held = gate<void>();
    generating.answer(async () => {
      await held.promise;
      return { kind: "image", bytes: pngBytes(8, 8), mediaType: "image/png" };
    });
    const first = await generating.rpc.call("run.image", runRequest({ outputs: [{ prompt: "collide", references: [] }] }));
    const stamp = await stampOf(first.placeholders[0]!);
    const base = `${stamp}-collide`;
    await writeFile(join(folderOf(generating), `${base}.png`), "taken");
    await writeFile(join(folderOf(generating), `${base}-2.json`), "{}");
    await writeFile(join(folderOf(generating), `${base}-3.png`), "taken");
    held.release();
    await finished(generating.events, first.runId);
    expect(await readFile(join(folderOf(generating), `${base}.png`), "utf8")).toBe("taken");
    expect(await readFile(join(folderOf(generating), `${base}-4.png`))).toEqual(pngBytes(8, 8));
    expect(JSON.parse(await readFile(join(folderOf(generating), `${base}-4.json`), "utf8")).file).toBe(`${base}-4.png`);

    const again = gate<void>();
    generating.answer(async () => {
      await again.promise;
      return { kind: "image", bytes: pngBytes(8, 8), mediaType: "image/png" };
    });
    const second = await generating.rpc.call("run.image", runRequest({ outputs: [{ prompt: "full", references: [] }] }));
    const full = `${await stampOf(second.placeholders[0]!)}-full`;
    for (const name of [full, `${full}-2`, `${full}-3`, `${full}-4`, `${full}-5`]) await writeFile(join(folderOf(generating), `${name}.png`), "taken");
    again.release();
    const done = await finished(generating.events, second.runId);
    expect(done).toMatchObject({ succeeded: 0, failed: 1 });
    expect(done.errors[0]).toMatch(/^Generated the image but failed to write it: /);
    expect((await roomShapes(generating)).some((shape) => shape.id === second.placeholders[0])).toBe(false);
  });

  it("suffixes the run index only in a batch", async () => {
    generating.answer(() => ({ kind: "image", bytes: pngBytes(8, 8), mediaType: "image/png" }));
    const started = await generating.rpc.call("run.image", runRequest({ outputs: [1, 2, 3].map(() => ({ prompt: "trio", references: [] })) }));
    const stamp = await stampOf(started.placeholders[0]!);
    await finished(generating.events, started.runId);
    const files = (await filesIn(generating)).filter((name) => name.startsWith(`${stamp}-trio`)).sort();
    expect(files).toEqual([`${stamp}-trio-1.json`, `${stamp}-trio-1.png`, `${stamp}-trio-2.json`, `${stamp}-trio-2.png`, `${stamp}-trio-3.json`, `${stamp}-trio-3.png`]);
  });
});

describe("run.image upstream failures", () => {
  let generating: Generating;
  beforeAll(async () => {
    generating = await startGenerating();
  });
  afterAll(() => generating.engine.dispose());

  it.each([
    ["an error status", { kind: "status", status: 500, body: { error: { message: "model overloaded" } } }, "OpenRouter (500): model overloaded"],
    ["an error given as a string", { kind: "status", status: 400, body: { error: "bad size" } }, "OpenRouter (400): bad size"],
    ["an error body that is not JSON", { kind: "status", status: 503, body: "<html>gateway down</html>" }, "OpenRouter (503): <html>gateway down</html>"],
    [
      "unpaid",
      { kind: "status", status: 402, body: { error: { message: "Insufficient credits" } } },
      "OpenRouter refused this as unpaid: either the account is out of credit, or this key has hit its own spending cap. Add credit at openrouter.ai/credits, or check the key's cap at openrouter.ai/settings/keys. (Insufficient credits)",
    ],
    ["a body that is not JSON", { kind: "not-json", text: `<html>${"x".repeat(400)}</html>` }, `Unexpected response from OpenRouter: <html>${"x".repeat(294)}`],
    ["no image in the answer", { kind: "no-image" }, "OpenRouter returned no image data."],
  ] as const)("reports %s as the output's error and deletes its placeholder", async (_case, answer, message) => {
    generating.answer(() => answer as never);
    const started = await generating.rpc.call("run.image", runRequest());
    const done = await finished(generating.events, started.runId);
    expect(done).toEqual({ type: "finished", runId: started.runId, succeeded: 0, failed: 1, errors: [message], orphaned: 0 });
    expect(eventsOf(generating.events, started.runId)[1]).toEqual({ type: "output", runId: started.runId, runIndex: 1, ok: false, error: message });
    expect((await roomShapes(generating)).some((shape) => shape.id === started.placeholders[0])).toBe(false);
  });

  it("reports a body lost mid-read with the charged warning", async () => {
    generating.answer(() => ({ kind: "drop" }));
    const started = await generating.rpc.call("run.image", runRequest());
    const done = await finished(generating.events, started.runId);
    expect(done.errors).toHaveLength(1);
    expect(done.errors[0]).toMatch(
      /^Lost the connection while reading OpenRouter's answer: .+\. The run may still have completed and been charged\. Check your OpenRouter activity page\.$/,
    );
  });

  it("reports an unreachable OpenRouter", async () => {
    const engine = await startEngine({ dotenv: `OPENROUTER_API_KEY=${KEY}\n`, env: { UNFRAMED_TEST_CANVAS: "1", UNFRAMED_TEST_OPENROUTER_ORIGIN: "http://127.0.0.1:9" } });
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    const events = rpc.subscribe("run.subscribe", { project: "board" });
    const started = await rpc.call("run.image", runRequest());
    const done = await finished(events, started.runId);
    expect(done.errors[0]).toMatch(/^Could not reach OpenRouter: .+/);
  });

  it("reports an image that cannot be written", async () => {
    const held = gate<void>();
    generating.answer(async () => {
      await held.promise;
      return { kind: "image", bytes: pngBytes(8, 8) };
    });
    const started = await generating.rpc.call("run.image", runRequest({ outputs: [{ prompt: "blocked", references: [] }] }));
    await until(() => (generating.requests.length > 0 ? true : undefined), "the upstream call");
    const folder = folderOf(generating);
    await chmod(folder, 0o500);
    try {
      held.release();
      const done = await finished(generating.events, started.runId);
      expect(done.errors[0]).toMatch(/^Generated the image but failed to write it: /);
    } finally {
      await chmod(folder, 0o700);
    }
  });
});

describe("a partial run", () => {
  it("reports mixed outcomes with their counts and distinct errors, and keeps the successes", async () => {
    const generating = await startGenerating();
    generating.answer(({ body }) =>
      body.prompt === "good"
        ? { kind: "image", bytes: pngBytes(8, 8) }
        : body.prompt === "bad-a"
          ? { kind: "status", status: 500, body: { error: { message: "down" } } }
          : { kind: "status", status: 500, body: { error: { message: "down" } } },
    );
    const started = await generating.rpc.call(
      "run.image",
      runRequest({ outputs: ["good", "bad-a", "bad-b", "good"].map((prompt) => ({ prompt, references: [] })) }),
    );
    expect(started.placeholders).toHaveLength(4);
    const done = await finished(generating.events, started.runId);
    expect(done).toEqual({ type: "finished", runId: started.runId, succeeded: 2, failed: 2, errors: ["OpenRouter (500): down"], orphaned: 0 });
    const shapes = await roomShapes(generating);
    const kept = started.placeholders.filter((id) => shapes.some((shape) => shape.id === id));
    expect(kept).toEqual([started.placeholders[0], started.placeholders[3]]);
    for (const id of kept) {
      const shape = shapes.find((each) => each.id === id);
      expect(shape.meta.unframed.result).toMatchObject({ runCount: 4, batchId: started.batchId });
      expect(shape.props.assetId).toMatch(/^asset:/);
    }
    // The row reads in run order.
    const placed = started.placeholders.map((id) => shapes.find((shape) => shape.id === id)).filter(Boolean);
    expect(placed[0].x).toBeLessThan(placed[1].x);
    await generating.engine.dispose();
  });
});

describe("placement against the room", () => {
  it("steps the row down past shapes that are in the way", async () => {
    const generating = await startGenerating();
    const blocker = imageShape("blocker", "900", null, { x: 540, y: 0 });
    const file = await upload(generating, "clip.mp4", Buffer.from("v"), "video/mp4");
    await generating.rpc.call("testCanvas.apply", {
      project: "board",
      change: { put: [blocker, videoAsset("v", `project-file:${file}`), videoShape("v", "901", "asset:v", { x: 0, y: 900 })], remove: [] },
      origin: { kind: "server", id: "test" },
    });
    const started = await generating.rpc.call("run.image", runRequest({ anchor: { x: 0, y: 0, w: 500, h: 100 } }));
    const placeholder = (await roomShapes(generating)).find((shape) => shape.id === started.placeholders[0]);
    expect(placeholder.x).toBe(540);
    expect(placeholder.y).toBe(144);
    await finished(generating.events, started.runId);
    await generating.engine.dispose();
  });
});
