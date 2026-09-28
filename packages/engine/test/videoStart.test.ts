import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rawRequest } from "./harness.ts";
import { eventually, KEY, MODEL, pngBytes, readJobs, recipe, roomRecord, shareCopies, startRendering, startRequest, type Rendering } from "./video.ts";

const NO_KEY = "No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).";
const LOCAL_CLIP =
  'Video generation only accepts a reference video as a public https:// link, and this one is a local file. Tick "Share via temporary link while generating" in the Generate tray, or use the clip in a text run instead, which does take local clips.';
const TUNNEL = "Could not share the clip: the temporary link did not come up. The tunnel service is best-effort, so trying again usually works";

const STILL = pngBytes(8, 6);
const CLIP = Buffer.concat([Buffer.from("\x00\x00\x00\x18ftypmp42"), Buffer.alloc(4096, 7)]);

const imageRef = (url: string) => ({ type: "image_url", image_url: { url } });
const videoRef = (url: string) => ({ type: "video_url", video_url: { url } });

const withClip = () => startRendering({ files: { "clip.mp4": CLIP, "still.png": STILL } });

/** Fetches a URL from outside the engine, the way a provider would. */
const fetchShare = async (url: string, method: "GET" | "HEAD" = "GET") => {
  const target = new URL(url);
  return rawRequest(Number(target.port), target.pathname + target.search, { method, headers: { host: "public.example" } });
};

const sharedUrl = (rendering: Rendering, index = 0) => rendering.jobs.creates[index]!.body.input_references.find((ref: any) => ref.type === "video_url").video_url.url as string;

describe("video.start refusals", () => {
  it("refuses without a key, and calls nothing upstream", async () => {
    const rendering = await startRendering({ key: false });
    await expect(rendering.rpc.call("video.start", startRequest())).rejects.toMatchObject({ code: "unavailable", message: NO_KEY, details: { reason: "no_key" } });
    expect(rendering.jobs.creates).toEqual([]);
  });

  it.each(["", "   \n "])("refuses an empty prompt %j", async (prompt) => {
    const rendering = await startRendering();
    await expect(rendering.rpc.call("video.start", startRequest({ prompt }))).rejects.toMatchObject({
      code: "bad_request",
      message: "Prompt is empty. Select at least one prompt, or type an instruction.",
      details: { reason: "invalid" },
    });
    expect(rendering.jobs.creates).toEqual([]);
  });

  it("refuses a project file that is not in the folder, before the prompt is looked at", async () => {
    const rendering = await startRendering();
    await expect(rendering.rpc.call("video.start", startRequest({ prompt: "", frame_images: [{ ...imageRef("project-file:gone.png"), frame_type: "first_frame" }] }))).rejects.toMatchObject({
      code: "not_found",
      message: "Reference file not found in this project: gone.png",
      details: { reason: "invalid" },
    });
    expect(rendering.jobs.creates).toEqual([]);
  });

  it("counts a null or non-list array as empty", async () => {
    const rendering = await startRendering();
    await rendering.rpc.call("video.start", startRequest({ input_references: null, frame_images: "nope" }));
    expect(rendering.jobs.creates[0]!.body).toEqual({ model: MODEL, prompt: "a fox running", duration: 5 });
  });

  it.each([undefined, false])("refuses a local clip when the share consent is %s, sharing nothing", async (shareLocalVideos) => {
    const rendering = await withClip();
    const request = startRequest({ input_references: [videoRef("project-file:clip.mp4")], ...(shareLocalVideos === undefined ? {} : { shareLocalVideos }) });
    await expect(rendering.rpc.call("video.start", request)).rejects.toMatchObject({ code: "bad_request", message: LOCAL_CLIP, details: { reason: "local_clip" } });
    expect(rendering.jobs.creates).toEqual([]);
    expect(await shareCopies(rendering)).toEqual([]);
  });
});

describe("video.start's payload", () => {
  it("sends exactly the set params, with image markers inlined and links as given", async () => {
    const rendering = await withClip();
    await rendering.rpc.call(
      "video.start",
      startRequest({
        input_references: [imageRef("project-file:still.png"), videoRef("https://cdn.example/hosted.mp4")],
        duration: 10,
        resolution: "720p",
        aspect_ratio: "16:9",
        generate_audio: false,
      }),
    );
    const [create] = rendering.jobs.creates;
    expect(create!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(create!.body).toEqual({
      model: MODEL,
      prompt: "a fox running",
      duration: 10,
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: false,
      input_references: [imageRef(`data:image/png;base64,${STILL.toString("base64")}`), videoRef("https://cdn.example/hosted.mp4")],
    });
    expect(rendering.engine.stdout()).toContain(`  video job →  ${MODEL}  (sent 1 image, 1 video refs, 0 frames)\n`);
  });

  it("sends frames with their frame types and no references, the default model when none is named, and size alone", async () => {
    const rendering = await withClip();
    const { model: _model, duration: _duration, ...rest } = startRequest();
    await rendering.rpc.call("video.start", {
      ...rest,
      size: "1280x720",
      frame_images: [
        { ...imageRef("project-file:still.png"), frame_type: "first_frame" },
        { ...imageRef("https://cdn.example/last.png"), frame_type: "last_frame" },
      ],
    });
    expect(rendering.jobs.creates[0]!.body).toEqual({
      model: "bytedance/seedance-2.0",
      prompt: "a fox running",
      size: "1280x720",
      frame_images: [
        { ...imageRef(`data:image/png;base64,${STILL.toString("base64")}`), frame_type: "first_frame" },
        { ...imageRef("https://cdn.example/last.png"), frame_type: "last_frame" },
      ],
    });
    expect(rendering.engine.stdout()).toContain("(sent 0 image, 0 video refs, 2 frames)");
  });
});

describe("the pending record and the render placeholder", () => {
  it("has written the pending record with params, refs, landing and recipe by the time it answers", async () => {
    const rendering = await withClip();
    rendering.jobs.create(() => ({ kind: "job", id: "gen-abc", status: "queued" }));
    const recorded = recipe({ references: [{ kind: "image", file: "still.png" }] });
    const before = Date.now();
    const answer = await rendering.rpc.call(
      "video.start",
      startRequest({ input_references: [imageRef("project-file:still.png")], resolution: "480p", recipe: recorded }),
    );
    expect(answer).toEqual({ jobId: "gen-abc", status: "queued", shapeId: expect.stringMatching(/^shape:/) });
    const [job] = await readJobs(rendering);
    expect(job).toEqual({
      id: "gen-abc",
      project: "board",
      params: { prompt: "a fox running", model: MODEL, duration: 5, resolution: "480p", size: null },
      startedAt: expect.any(Number),
      status: "pending",
      refs: { images: 1, videos: 0, frames: 0 },
      landing: { x: 400, y: 20, w: 320, h: 180, shapeId: answer.shapeId },
      recipe: recorded,
    });
    expect(job.startedAt).toBeGreaterThanOrEqual(before);
  });

  it("writes the render placeholder at the landing spot with the durable marker and unfilled result meta; recipe.read answers the record's recipe", async () => {
    const rendering = await withClip();
    rendering.jobs.create(() => ({ kind: "job", id: "gen-place" }));
    const recorded = recipe({ instruction: "slow", sources: ["shape:a", "shape:b"] });
    const answer = await rendering.rpc.call("video.start", startRequest({ resolution: "720p", landing: { x: 900, y: -40, w: 320, h: 180 }, recipe: recorded }));
    expect(answer.status).toBe("pending");
    const shape = await roomRecord(rendering, answer.shapeId);
    expect(shape).toMatchObject({ type: "video", x: 900, y: -40, props: { w: 320, h: 180, assetId: null } });
    expect(shape.meta.ref).toMatch(/^\d+$/);
    expect(shape.meta.unframed).toEqual({
      run: {
        runId: "gen-place",
        runIndex: 1,
        startedAt: expect.any(Number),
        durable: { params: { prompt: "a fox running", model: MODEL, duration: 5, resolution: "720p", size: null } },
      },
      result: { sidecar: null, medium: "video", model: MODEL, batchId: expect.stringMatching(/^b-\d+$/), runIndex: 1, runCount: 1, cost: null, sources: ["shape:a", "shape:b"] },
    });
    expect(await rendering.rpc.call("recipe.read", { project: "board", shapeId: answer.shapeId })).toEqual(recorded);
  });
});

describe("video.start's upstream failures", () => {
  const UNPAID =
    "OpenRouter refused this as unpaid: either the account is out of credit, or this key has hit its own spending cap. Add credit at openrouter.ai/credits, or check the key's cap at openrouter.ai/settings/keys. (Insufficient credits)";
  it.each([
    ["a network failure", { kind: "hangup" } as const, "unreachable", /^Could not reach OpenRouter: .+/],
    [
      "a body lost mid-read",
      { kind: "drop" } as const,
      "upstream",
      /^Lost the connection while reading OpenRouter's answer: .+\. The render may still have completed and been charged\. Check your OpenRouter activity page\.$/,
    ],
    ["a body that is not JSON", { kind: "not-json", text: `<html>${"x".repeat(400)}</html>` } as const, "upstream", /^Unexpected response from OpenRouter: <html>x{294}$/],
    ["a 402", { kind: "status", status: 402, body: { error: { message: "Insufficient credits" } } } as const, "unpaid", UNPAID],
    ["another status", { kind: "status", status: 400, body: { error: { message: "InputVideoSensitiveContentDetected" } } } as const, "upstream", "OpenRouter (400): InputVideoSensitiveContentDetected"],
    ["a string error", { kind: "status", status: 503, body: { error: "busy" } } as const, "upstream", "OpenRouter (503): busy"],
    ["no job id", { kind: "no-id" } as const, "upstream", "OpenRouter did not return a video job id."],
  ])("maps %s to its message, writing no record or placeholder", async (_case, answer, reason, message) => {
    const rendering = await withClip();
    rendering.jobs.create(() => answer);
    const failure = rendering.rpc.call("video.start", startRequest());
    await expect(failure).rejects.toMatchObject({ code: "upstream", details: { reason } });
    const error = await failure.catch((caught: { message: string }) => caught);
    if (typeof message === "string") expect(error.message).toBe(message);
    else expect(error.message).toMatch(message);
    expect(existsSync(`${rendering.output}/jobs.json`)).toBe(false);
    expect((await rendering.rpc.call("testCanvas.read", { project: "board" })).records.filter((record: any) => record.type === "video")).toEqual([]);
  });
});

describe("share links", () => {
  it("gives the provider a share URL that serves the clip byte for byte with its type, to GET and HEAD", async () => {
    const rendering = await withClip();
    let fetched: { get: Awaited<ReturnType<typeof fetchShare>>; head: Awaited<ReturnType<typeof fetchShare>> } | undefined;
    rendering.jobs.create(async (request) => {
      const url = request.body.input_references[0].video_url.url as string;
      fetched = { get: await fetchShare(url), head: await fetchShare(url, "HEAD") };
      return { kind: "job", id: "gen-shared" };
    });
    await rendering.rpc.call("video.start", startRequest({ input_references: [videoRef("project-file:clip.mp4")], shareLocalVideos: true }));
    const url = sharedUrl(rendering);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/share\/[A-Za-z0-9_-]{43}$/);
    expect(new URL(url).port).not.toBe(String(rendering.engine.port));
    expect(fetched!.get.status).toBe(200);
    expect(fetched!.get.headers["content-type"]).toBe("video/mp4");
    expect(fetched!.get.body.equals(CLIP)).toBe(true);
    expect(fetched!.head.status).toBe(200);
    expect(fetched!.head.headers["content-length"]).toBe(String(CLIP.length));
    expect(fetched!.head.body.length).toBe(0);
    // The share lives until the job ends; its temp copy is in the engine's temp folder.
    expect((await fetchShare(url)).body.equals(CLIP)).toBe(true);
    expect(await shareCopies(rendering)).toHaveLength(1);
    expect((await readJobs(rendering))[0].refs).toEqual({ images: 0, videos: 1, frames: 0 });
  });

  it("answers 404 not found to every other method, path and token, and has no API route", async () => {
    const rendering = await withClip();
    await rendering.rpc.call("video.start", startRequest({ input_references: [videoRef("project-file:clip.mp4")], shareLocalVideos: true }));
    const url = new URL(sharedUrl(rendering));
    const port = Number(url.port);
    const token = url.pathname.slice("/share/".length);
    const probes: Array<[string, string]> = [
      ["POST", url.pathname],
      ["PUT", url.pathname],
      ["DELETE", url.pathname],
      ["OPTIONS", url.pathname],
      ["GET", "/"],
      ["GET", "/ws"],
      ["GET", "/api/file/board/clip.mp4"],
      ["POST", "/api/projects/board/files"],
      ["GET", `/share/${token}/`],
      ["GET", `/share/${token}?download=1`],
      ["GET", `/share/${token.slice(1)}`],
      ["GET", `/share/${token}x`],
      ["GET", `/share/${"A".repeat(43)}`],
      ["GET", `/share/%2e%2e/${token}`],
      ["GET", `//share/${token}`],
      ["HEAD", `/share/${"B".repeat(43)}`],
    ];
    for (const [method, path] of probes) {
      const response = await rawRequest(port, path, { method, headers: { host: "anything.example", origin: "https://evil.example" } });
      expect([method, path, response.status]).toEqual([method, path, 404]);
      if (method !== "HEAD") expect(response.text).toBe("not found");
      expect(response.headers["content-type"]).toBe("text/plain");
    }
    expect((await rawRequest(port, url.pathname, { headers: { host: "anything.example", origin: "https://evil.example" } })).status).toBe(200);
  });

  it("makes 3 tunnel attempts when the link never comes up, fails with the tunnel message and leaves no temp copy", async () => {
    const rendering = await startRendering({ files: { "clip.mp4": CLIP }, env: { UNFRAMED_TEST_TUNNEL: "never" } });
    await expect(rendering.rpc.call("video.start", startRequest({ input_references: [videoRef("project-file:clip.mp4")], shareLocalVideos: true }))).rejects.toMatchObject({
      code: "upstream",
      message: TUNNEL,
      details: { reason: "share_failed" },
    });
    for (const attempt of [1, 2, 3]) expect(rendering.engine.stdout()).toContain(`  tunnel attempt ${attempt} never came up; retrying\n`);
    expect(rendering.engine.stdout()).not.toContain("tunnel attempt 4");
    expect(rendering.jobs.creates).toEqual([]);
    expect(await shareCopies(rendering)).toEqual([]);
  });

  it("revokes the shares a failed create minted and deletes their temp copies", async () => {
    const rendering = await withClip();
    let url = "";
    rendering.jobs.create(async (request) => {
      url = request.body.input_references[0].video_url.url;
      return { kind: "status", status: 500, body: { error: { message: "down" } } };
    });
    await expect(rendering.rpc.call("video.start", startRequest({ input_references: [videoRef("project-file:clip.mp4")], shareLocalVideos: true }))).rejects.toMatchObject({
      message: "OpenRouter (500): down",
    });
    expect(url).not.toBe("");
    expect(await shareCopies(rendering)).toEqual([]);
    expect((await fetchShare(url)).status).toBe(404);
  });

  it("stops answering a share past its TTL and deletes its temp copy", async () => {
    const rendering = await startRendering({ files: { "clip.mp4": CLIP }, env: { UNFRAMED_TEST_SHARE_TTL_MS: "600" } });
    await rendering.rpc.call("video.start", startRequest({ input_references: [videoRef("project-file:clip.mp4")], shareLocalVideos: true }));
    const url = sharedUrl(rendering);
    expect(await shareCopies(rendering)).toHaveLength(1);
    await eventually(async () => (await fetchShare(url)).status === 404, "the share to expire");
    await eventually(async () => (await shareCopies(rendering)).length === 0, "the temp copy to go");
  });
});
