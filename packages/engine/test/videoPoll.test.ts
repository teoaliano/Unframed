import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { connectTab } from "./syncClient.ts";
import { eventually, jobsText, MODEL, pendingRecord, readJobs, recipe, roomRecord, roomShapes, shareCopies, startRendering, startRequest, type Rendering } from "./video.ts";
import { completed } from "./videoStub.ts";

const CLIP = Buffer.concat([Buffer.from("\x00\x00\x00\x18ftypmp42"), Buffer.alloc(2048, 3)]);
const PARAMS = { prompt: "a fox running", model: MODEL, duration: 5, resolution: null, size: null };
const STAMPED = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-a-fox-running\.mp4$/;

const videoRef = (url: string) => ({ type: "video_url", video_url: { url } });

const poll = (rendering: Rendering, jobId: string, project = "board", params: typeof PARAMS = PARAMS) => rendering.rpc.call("video.poll", { jobId, project, params });

/** Starts a render with a local clip shared, and answers its job id and placeholder. */
const startShared = async (rendering: Rendering, id = "gen-1", overrides: Parameters<typeof startRequest>[0] = {}) => {
  rendering.jobs.create(() => ({ kind: "job", id }));
  const answer = await rendering.rpc.call("video.start", startRequest({ input_references: [videoRef("project-file:source.mp4")], shareLocalVideos: true, ...overrides }));
  const url = (rendering.jobs.creates.at(-1)!.body.input_references?.[0]?.video_url.url ?? "") as string;
  return { ...answer, url };
};

const clips = async (rendering: Rendering) => (await readdir(rendering.folder)).filter((name) => STAMPED.test(name));

describe("answering from the store", () => {
  it("answers a done or failed record from the store, even with no key, and asks nothing upstream", async () => {
    const rendering = await startRendering({
      key: false,
      seed: [
        pendingRecord("done-1", { status: "done", savedPath: "/somewhere/board/2026-a.mp4", cost: 1.2, resolvedAt: Date.now() }),
        pendingRecord("failed-1", { status: "failed", error: "Output flagged", resolvedAt: Date.now() }),
        pendingRecord("failed-2", { status: "failed", resolvedAt: Date.now() }),
      ],
    });
    expect(await poll(rendering, "done-1")).toEqual({ status: "completed", cost: 1.2, savedPath: "/somewhere/board/2026-a.mp4", url: "/api/file/board/2026-a.mp4" });
    expect(await poll(rendering, "failed-1")).toEqual({ status: "failed", error: "Output flagged" });
    expect(await poll(rendering, "failed-2")).toEqual({ status: "failed", error: "Generation failed." });
    expect(rendering.jobs.polls).toEqual([]);
  });

  it("refuses with the short no-key message for a pending record when there is no key", async () => {
    const rendering = await startRendering({ key: false, seed: [pendingRecord("gen-1")] });
    await expect(poll(rendering, "gen-1")).rejects.toMatchObject({ code: "unavailable", message: "No OpenRouter key yet.", details: { reason: "no_key" } });
  });
});

describe("asking upstream", () => {
  it.each([
    ["queued", 0],
    ["in_progress", 55],
    ["warming_up", undefined],
  ])("passes %s through raw and leaves the record pending", async (status, progress) => {
    const rendering = await startRendering({ seed: [pendingRecord("gen-1")] });
    const before = await jobsText(rendering);
    rendering.jobs.status((id) => ({ kind: "data", data: { id, status, ...(progress === undefined ? {} : { progress }) } }));
    expect(await poll(rendering, "gen-1")).toEqual({ status, progress: progress ?? null });
    expect(rendering.jobs.polls[0]!.headers.authorization).toMatch(/^Bearer sk-or-v1-/);
    expect(await jobsText(rendering)).toBe(before);
  });

  it.each([
    ["a network failure", { kind: "hangup" } as const, "unreachable", /^Could not reach OpenRouter: .+/],
    ["a body that is not JSON", { kind: "not-json", text: "<html>" } as const, "upstream", /^Unexpected response from OpenRouter: <html>$/],
    ["an error status", { kind: "status", status: 500, body: { error: { message: "down" } } } as const, "upstream", /^OpenRouter \(500\): down$/],
  ])("refuses when upstream gives no answer: %s", async (_case, answer, reason, message) => {
    const rendering = await startRendering({ seed: [pendingRecord("gen-1")] });
    rendering.jobs.status(() => answer);
    const failure = await poll(rendering, "gen-1").catch((error: { code: string; message: string; details: unknown }) => error);
    expect(failure).toMatchObject({ code: "upstream", details: { reason } });
    expect((failure as { message: string }).message).toMatch(message);
    expect((await readJobs(rendering))[0].status).toBe("pending");
  });

  it.each(["failed", "expired", "cancelled", "canceled"])("fails the record with the provider's message on %s, and says why on the placeholder", async (status) => {
    const rendering = await startRendering({ files: { "source.mp4": CLIP } });
    const started = await startShared(rendering);
    rendering.jobs.status((id) => ({ kind: "data", data: { id, status, error: { message: `It was ${status}` } } }));
    expect(await poll(rendering, started.jobId)).toEqual({ status: "failed", error: `It was ${status}` });
    const [job] = await readJobs(rendering);
    expect(job).toMatchObject({ status: "failed", error: `It was ${status}`, resolvedAt: expect.any(Number) });
    const shape = await roomRecord(rendering, started.shapeId);
    expect(shape.meta.unframed.runError).toBe(`It was ${status}`);
    expect(shape.meta.unframed.run).toBeUndefined();
    expect(shape.meta.unframed.result.sidecar).toBeNull();
    // Its recipe is still the job record's, for Regenerate and Recipe.
    expect(await rendering.rpc.call("recipe.read", { project: "board", shapeId: started.shapeId })).toEqual(recipe());
    // The job ended, so its share did too.
    expect(await shareCopies(rendering)).toEqual([]);
  });
});

describe("collecting a completed job", () => {
  it("writes the clip, the sidecar and the done record, fills the placeholder in place, and revokes the share", async () => {
    const rendering = await startRendering({ files: { "source.mp4": CLIP } });
    const recorded = recipe({ params: { inputMode: "reference", duration: 5, aspect_ratio: "16:9", generate_audio: true, shareLocalVideos: true }, references: [{ kind: "video", file: "source.mp4" }] });
    const started = await startShared(rendering, "gen-1", { aspect_ratio: "16:9", generate_audio: true, recipe: recorded, landing: { x: 700, y: 80, w: 320, h: 180 } });
    const output = Buffer.from("the finished clip");
    rendering.jobs.clip(() => output);
    rendering.jobs.status((id) => completed(rendering.stubOrigin, id, { usage: { cost: 0.84, video_seconds: 5, input_video_seconds: 3 } }));
    const answer = await poll(rendering, started.jobId);
    const [file] = await clips(rendering);
    expect(file).toMatch(STAMPED);
    expect(answer).toEqual({ status: "completed", cost: 0.84, savedPath: join(rendering.folder, file!), url: `/api/file/board/${encodeURIComponent(file!)}` });
    expect((await readFile(join(rendering.folder, file!))).equals(output)).toBe(true);
    expect(rendering.jobs.downloads[0]!.headers.authorization).toMatch(/^Bearer sk-or-v1-/);

    const sidecar = JSON.parse(await readFile(join(rendering.folder, file!.replace(/\.mp4$/, ".json")), "utf8"));
    expect(sidecar).toEqual({
      kind: "video",
      prompt: "a fox running",
      model: MODEL,
      duration: 5,
      resolution: null,
      size: null,
      aspect_ratio: "16:9",
      generate_audio: true,
      inputMode: "reference",
      references: { images: 0, videos: 1, frames: 0 },
      usage: { cost: 0.84, video_seconds: 5, input_video_seconds: 3 },
      cost: 0.84,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      file,
      jobId: "gen-1",
      recipe: recorded,
    });

    const [job] = await readJobs(rendering);
    expect(job).toMatchObject({ id: "gen-1", project: "board", status: "done", savedPath: join(rendering.folder, file!), cost: 0.84, resolvedAt: expect.any(Number), params: PARAMS });
    expect((await rendering.engine.request(new URL(started.url).pathname, { port: Number(new URL(started.url).port) })).status).toBe(404);
    expect(await shareCopies(rendering)).toEqual([]);

    const shape = await roomRecord(rendering, started.shapeId);
    expect(shape).toMatchObject({ x: 700, y: 80, props: { w: 320, assetId: expect.stringMatching(/^asset:/) } });
    expect(shape.meta.unframed.run).toBeUndefined();
    expect(shape.meta.unframed.result).toMatchObject({ sidecar: file!.replace(/\.mp4$/, ".json"), medium: "video", model: MODEL, cost: 0.84 });
    const asset = await roomRecord(rendering, shape.props.assetId);
    expect(asset).toMatchObject({ type: "video", props: { src: `project-file:${file}`, name: file, mimeType: "video/mp4" } });
    expect(await rendering.rpc.call("recipe.read", { project: "board", shapeId: started.shapeId })).toEqual(recorded);
  });

  it("downloads nothing on a second poll of a collected job", async () => {
    const rendering = await startRendering();
    await startShared(rendering, "gen-1", { input_references: [] });
    rendering.jobs.status((id) => completed(rendering.stubOrigin, id));
    const first = await poll(rendering, "gen-1");
    const second = await poll(rendering, "gen-1");
    expect(second).toEqual(first);
    expect(rendering.jobs.downloads).toHaveLength(1);
    expect(await clips(rendering)).toHaveLength(1);
  });

  it("collects a job the store never learned about from the params the poll carries", async () => {
    const rendering = await startRendering();
    rendering.jobs.status((id) => completed(rendering.stubOrigin, id, { usage: { cost: 0.3 } }));
    const answer = await poll(rendering, "gen-orphan", "board", { ...PARAMS, resolution: "720p" });
    expect(answer).toMatchObject({ status: "completed", cost: 0.3 });
    const [job] = await readJobs(rendering);
    expect(job).toMatchObject({ id: "gen-orphan", project: "board", status: "done", params: { ...PARAMS, resolution: "720p" } });
    const [file] = await clips(rendering);
    const sidecar = JSON.parse(await readFile(join(rendering.folder, file!.replace(/\.mp4$/, ".json")), "utf8"));
    expect(sidecar).toMatchObject({ jobId: "gen-orphan", resolution: "720p", references: null, recipe: { medium: "video", model: MODEL, selectionPrompt: "a fox running" } });
  });

  it("recreates no shape when the placeholder was deleted, and still leaves the clip and sidecar in the folder", async () => {
    const rendering = await startRendering();
    const tab = await connectTab(rendering.engine.port, "board");
    await tab.loaded;
    const started = await startShared(rendering, "gen-1", { input_references: [] });
    await tab.waitFor(() => tab.get(started.shapeId));
    await tab.remove([started.shapeId]);
    rendering.jobs.status((id) => completed(rendering.stubOrigin, id));
    await poll(rendering, "gen-1");
    const [file] = await clips(rendering);
    expect(await readdir(rendering.folder)).toContain(file!.replace(/\.mp4$/, ".json"));
    expect((await roomShapes(rendering)).filter((shape) => shape.type === "video")).toEqual([]);
    expect(rendering.engine.stdout()).toContain(`  gen-1: output 1 landed after its placeholder was deleted → ${join(rendering.folder, file!)}`);
    await tab.close();
  });

  it("gives a seeded record that never had a placeholder a new result at its landing spot", async () => {
    const rendering = await startRendering({ seed: [pendingRecord("gen-old", { landing: { x: 1234, y: 56, w: 320, h: 180 }, recipe: recipe() })] });
    rendering.jobs.status((id) => completed(rendering.stubOrigin, id));
    // The boot sweep may be collecting it already, in which case the poll answers pending.
    await poll(rendering, "gen-old");
    const shape = await eventually(async () => (await roomShapes(rendering)).find((each) => each.type === "video"), "the new result");
    expect(shape).toMatchObject({ x: 1234, y: 56, props: { w: 320, h: 180, assetId: expect.stringMatching(/^asset:/) } });
    expect(shape.meta.unframed.run).toBeUndefined();
    expect(shape.meta.unframed.result).toMatchObject({ medium: "video", model: MODEL, sidecar: expect.stringMatching(/\.json$/) });
  });

  it("puts a seeded record with no landing at all right of the rightmost shape, top-aligned with the topmost", async () => {
    const rendering = await startRendering({ seed: [pendingRecord("gen-old")] });
    // The starter canvas's two prompts are the shapes on it.
    rendering.jobs.status((id) => completed(rendering.stubOrigin, id));
    await poll(rendering, "gen-old");
    const created = await eventually(async () => (await roomShapes(rendering)).find((each) => each.type === "video"), "the new result");
    const shapes = await roomShapes(rendering);
    const others = shapes.filter((each) => each.type !== "video");
    expect(created.x).toBeGreaterThan(Math.max(...others.map((each) => each.x)));
    expect(created.y).toBe(Math.min(...others.map((each) => each.y)));
  });
});

describe("Forget", () => {
  it("removes the placeholder and marks the record; the clip is still collected to disk and no shape is added", async () => {
    const rendering = await startRendering();
    const started = await startShared(rendering, "gen-1", { input_references: [] });
    expect(await rendering.rpc.call("video.forget", { project: "board", jobId: "gen-1" })).toEqual({});
    expect(await roomRecord(rendering, started.shapeId)).toBeUndefined();
    expect((await readJobs(rendering))[0]).toMatchObject({ status: "pending", forgotten: true });
    rendering.jobs.status((id) => completed(rendering.stubOrigin, id));
    await poll(rendering, "gen-1");
    expect(await clips(rendering)).toHaveLength(1);
    expect((await roomShapes(rendering)).filter((shape) => shape.type === "video")).toEqual([]);
  });
});

describe("durable markers", () => {
  const placeholder = (id: string, jobId: string) => ({
    id: `shape:${id}`,
    typeName: "shape",
    type: "video",
    x: 800,
    y: 0,
    rotation: 0,
    index: "a9",
    parentId: "page:page",
    isLocked: false,
    opacity: 1,
    props: { w: 320, h: 180, time: 0, playing: false, autoplay: false, url: "", assetId: null, altText: "" },
    meta: {
      ref: `9${id.length}${id.charCodeAt(0)}`,
      unframed: {
        run: { runId: jobId, runIndex: 1, startedAt: 1, durable: { params: PARAMS } },
        result: { sidecar: null, medium: "video", model: MODEL, batchId: "b-1", runIndex: 1, runCount: 1, cost: null, sources: [] },
      },
    },
  });

  it("are resolved against the store when the room opens after a restart: pending left, done filled, failed told why", async () => {
    const first = await startRendering();
    await first.rpc.call("testCanvas.apply", {
      project: "board",
      change: { put: [placeholder("pending", "job-p"), placeholder("done", "job-d"), placeholder("failed", "job-f"), placeholder("unknown", "job-u")], remove: [] },
      origin: { kind: "server", id: "run:test" },
    });
    await first.engine.stop("SIGKILL");
    const saved = join(first.folder, "2026-01-01T00-00-00-000Z-done.mp4");
    await writeFile(saved, "done clip");
    const second = await startRendering({
      dataDir: first.engine.dataDir,
      seed: [
        pendingRecord("job-p"),
        pendingRecord("job-d", { status: "done", savedPath: saved, cost: 0.5, resolvedAt: Date.now() }),
        pendingRecord("job-f", { status: "failed", error: "Output flagged", resolvedAt: Date.now() }),
      ],
    });
    const done = await eventually(async () => {
      const shape = await roomRecord(second, "shape:done");
      return shape?.props.assetId ? shape : undefined;
    }, "the done placeholder to fill");
    expect(done.meta.unframed.run).toBeUndefined();
    expect(done.meta.unframed.result).toMatchObject({ sidecar: "2026-01-01T00-00-00-000Z-done.json", cost: 0.5 });
    const failed = await eventually(async () => {
      const shape = await roomRecord(second, "shape:failed");
      return shape?.meta.unframed.runError ? shape : undefined;
    }, "the failed placeholder to say why");
    expect(failed.meta.unframed.runError).toBe("Output flagged");
    expect(failed.meta.unframed.run).toBeUndefined();
    expect((await roomRecord(second, "shape:pending")).meta.unframed.run.runId).toBe("job-p");
    expect((await roomRecord(second, "shape:unknown")).meta.unframed.run.runId).toBe("job-u");
    await rm(first.engine.dataDir, { recursive: true, force: true });
  });

  it("are resolved when an undo restores a placeholder whose job has since failed", async () => {
    const rendering = await startRendering();
    const tab = await connectTab(rendering.engine.port, "board");
    await tab.loaded;
    const started = await startShared(rendering, "gen-1", { input_references: [] });
    const shape = await tab.waitFor(() => tab.get(started.shapeId));
    await tab.remove([started.shapeId]);
    rendering.jobs.status((id) => ({ kind: "data", data: { id, status: "failed", error: "Output flagged" } }));
    await poll(rendering, "gen-1");
    await tab.put([shape]);
    const restored = await tab.waitFor(() => {
      const current = tab.get(started.shapeId);
      return current?.meta.unframed.runError ? current : undefined;
    });
    expect(restored.meta.unframed.runError).toBe("Output flagged");
    expect(restored.meta.unframed.run).toBeUndefined();
    await tab.close();
  });
});

