import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gate } from "../../engine/test/openRouterStub.ts";
import { completed } from "../../engine/test/videoStub.ts";
import { openCanvas, roomRecords, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { clickShape, composer, openComposer, pressSend, sendButton, sendRun, toolbar } from "./generation.ts";
import { watchRpcSockets } from "./fixtures.ts";
import { expectToken } from "./kit.ts";
import { putRecords, testIndex } from "./media.ts";
import { chooseVideo, expect, SEEDANCE, startVideoGeneration, test, type VideoEngine } from "./videoGeneration.ts";

const PARAMS = { prompt: "a fox running", model: SEEDANCE, duration: 5, resolution: null, size: null };
const FORGET_TIP =
  "Stops tracking this job here. It does not cancel the render upstream. If it finishes anyway, the clip is still saved in the project folder but will not appear on the canvas.";

/** A render placeholder as `video.start` leaves it, for a job the store has not heard of. */
const placeholder = (id: string, jobId: string, startedAt: number, at = { x: 520, y: 40 }) => ({
  id,
  typeName: "shape",
  type: "video",
  x: at.x,
  y: at.y,
  rotation: 0,
  index: testIndex(),
  parentId: "page:page",
  isLocked: false,
  opacity: 1,
  props: { w: 320, h: 180, time: 0, playing: false, autoplay: false, url: "", assetId: null, altText: "" },
  meta: {
    ref: "400",
    unframed: {
      run: { runId: jobId, runIndex: 1, startedAt, durable: { params: PARAMS } },
      result: { sidecar: null, medium: "video", model: SEEDANCE, batchId: "b-1", runIndex: 1, runCount: 1, cost: null, sources: [] },
    },
  },
});

const pollsOf = (video: VideoEngine, jobId: string) => video.jobs.polls.filter((poll) => poll.path === `/api/v1/videos/${jobId}`).length;

test("a render placeholder reads Rendering… (N min), and the count advances with the clock", async ({ page, videoEngine: video }) => {
  await page.clock.install();
  await openCanvas(page, video.engine);
  const startedAt = (await page.evaluate(() => Date.now())) - 3.5 * 60_000;
  await putRecords(video.engine, [placeholder("shape:render", "gen-clock", startedAt)]);
  const shape = shapeOnScreen(page, "shape:render");
  await expect(shape.getByRole("status")).toHaveText("Rendering… (3 min)");
  await expect(shape.getByRole("button", { name: "Forget this job" })).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(shape.getByRole("status")).toHaveText("Rendering… (4 min)");
  await page.clock.fastForward(5 * 60_000);
  await expect(shape.getByRole("status")).toHaveText("Rendering… (9 min)");
});

test("Forget this job explains itself, removes the placeholder and tells the engine", async ({ page, videoEngine: video }) => {
  await openCanvas(page, video.engine);
  await putRecords(video.engine, [placeholder("shape:render", "gen-forget", Date.now())]);
  const button = shapeOnScreen(page, "shape:render").getByRole("button", { name: "Forget this job" });
  await button.hover();
  await expect(page.getByText(FORGET_TIP)).toBeVisible();
  await button.click();
  await expect(shapeOnScreen(page, "shape:render")).toHaveCount(0);
  await expect.poll(async () => (await roomRecords(video.engine, "default")).some((record) => record.id === "shape:render")).toBe(false);
});

test("a failed render says why on its placeholder", async ({ page, videoEngine: video }) => {
  video.jobs.status((id) => ({ kind: "data", data: { id, status: "failed", error: { message: "OutputVideoSensitiveContentDetected" } } }));
  await openCanvas(page, video.engine);
  await putRecords(video.engine, [placeholder("shape:render", "gen-bad", Date.now())]);
  const shape = shapeOnScreen(page, "shape:render");
  await expect(shape.getByRole("alert")).toHaveText("OutputVideoSensitiveContentDetected");
  await expect(shape.getByRole("button", { name: "Forget this job" })).toHaveCount(0);
  const record = (await roomRecords(video.engine, "default")).find((each) => each.id === "shape:render")!;
  expect(record.meta.unframed.runError).toBe("OutputVideoSensitiveContentDetected");
  expect(record.meta.unframed.run).toBeUndefined();
});

test("a failed render keeps its recipe: Regenerate, sent from the composer, starts the same render again beside it", async ({ page, videoEngine: video }) => {
  video.jobs.status((id) => ({ kind: "data", data: { id, status: "failed", error: { message: "Output flagged" } } }));
  await openCanvas(page, video.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseVideo(page);
  await sendRun(page);
  const failed = await waitForRoom(video.engine, "default", (records) => records.find((each) => each.meta?.unframed?.runError === "Output flagged"));
  await expect(shapeOnScreen(page, failed.id).getByRole("alert")).toHaveText("Output flagged");
  // After a reload no tray has fetched the video catalogue: the recipe sends the same render all the same.
  await page.reload();
  await expect(shapeOnScreen(page, failed.id).getByRole("alert")).toHaveText("Output flagged");
  await clickShape(page, failed.id);
  // A failed render has no clip to send, so its bar has no Generate, and Regenerate is the primary action.
  await expect(toolbar(page).getByRole("button")).toHaveText(["Regenerate", "Agent"]);
  await expectToken(toolbar(page).getByRole("button", { name: "Regenerate" }), "background-color", "--primary");
  await toolbar(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(composer(page).getByTestId("source-count")).toHaveText(/^recipe · /);
  await sendRun(page);
  await expect.poll(() => video.jobs.creates.length).toBe(2);
  expect(video.jobs.creates[1]!.body).toEqual(video.jobs.creates[0]!.body);
  const again = await waitForRoom(video.engine, "default", (records) => records.find((each) => each.id !== failed.id && each.type === "video" && each.meta?.unframed?.result));
  expect(again.x).toBeGreaterThan(failed.x!);
});

test("a reloaded tab resumes polling an existing placeholder, and the clip appears when the job completes", async ({ page, videoEngine: video }) => {
  await openCanvas(page, video.engine);
  await putRecords(video.engine, [placeholder("shape:render", "gen-resume", Date.now())]);
  await expect.poll(() => pollsOf(video, "gen-resume")).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect(shapeOnScreen(page, "shape:render").getByRole("status")).toHaveText("Rendering… (0 min)");
  const before = pollsOf(video, "gen-resume");
  await expect.poll(() => pollsOf(video, "gen-resume")).toBeGreaterThan(before);
  video.jobs.status((id) => completed(video.engine.stub!.origin, id));
  const filled = await waitForRoom(video.engine, "default", (records) => {
    const record = records.find((each) => each.id === "shape:render");
    return record?.props.assetId ? record : undefined;
  });
  expect(filled.meta.unframed.run).toBeUndefined();
  await expect(shapeOnScreen(page, "shape:render").locator("video")).toHaveAttribute("src", /^\/api\/file\/default\/.+-a-fox-running\.mp4$/);
});

test("a result the sweep collected appears in an open tab that never polled it", async ({ page }) => {
  const video = await startVideoGeneration({ env: { UNFRAMED_TEST_SWEEP_MS: "300" } });
  try {
    await openCanvas(page, video.engine);
    const output = join(video.engine.dataDir, "output");
    await mkdir(output, { recursive: true });
    const record = {
      id: "gen-swept",
      project: "default",
      params: PARAMS,
      startedAt: Date.now(),
      status: "pending",
      refs: { images: 0, videos: 0, frames: 0 },
      landing: { x: 520, y: 60, w: 320, h: 180 },
    };
    video.jobs.status((id) => completed(video.engine.stub!.origin, id));
    await writeFile(join(output, "jobs.json"), JSON.stringify([record]));
    const landed = await waitForRoom(video.engine, "default", (records) => records.find((each) => each.type === "video" && each.props.assetId));
    await expect(shapeOnScreen(page, landed.id).locator("video")).toHaveAttribute("src", /\.mp4$/);
    expect(landed).toMatchObject({ x: 520, y: 60 });
  } finally {
    await page.close();
    await video.engine.dispose();
  }
});

test("the tab polls at once, then every 4 s, stops after 15 minutes, then checks once every 2 minutes", async ({ page, videoEngine: video }) => {
  // The page's clock runs, and jumps when told to: a paused clock would also stop the socket's own timers.
  const sockets = watchRpcSockets(page);
  await page.clock.install();
  await openCanvas(page, video.engine);
  await putRecords(video.engine, [placeholder("shape:render", "gen-cadence", Date.now())]);
  const polls = () => pollsOf(video, "gen-cadence");
  // The tab schedules its next check once an answer is in, so each step waits for the answer before the clock moves.
  const answers = () => sockets.sockets.flatMap((socket) => socket.frames).filter((frame) => frame?._tag === "Exit" && JSON.stringify(frame).includes('"in_progress"')).length;
  const reached = async (count: number) => {
    await expect.poll(polls, { intervals: [50] }).toBe(count);
    await expect.poll(answers, { intervals: [50] }).toBe(count);
  };
  const unchanged = async (count: number) => {
    await page.waitForTimeout(400);
    expect(polls()).toBe(count);
  };
  // At once.
  await reached(1);
  // Then every 4 s.
  for (const count of [2, 3, 4]) {
    await page.clock.fastForward(2_500);
    await unchanged(count - 1);
    await page.clock.fastForward(1_500);
    await reached(count);
  }
  // Past 15 minutes the timer that was due fires once, and the 4 s cadence ends.
  await page.clock.fastForward(15 * 60_000);
  await reached(5);
  await page.clock.fastForward(4_000);
  await unchanged(5);
  await page.clock.fastForward(100_000);
  await unchanged(5);
  // One check every 2 minutes.
  await page.clock.fastForward(20_000);
  await reached(6);
  await page.clock.fastForward(100_000);
  await unchanged(6);
  await page.clock.fastForward(20_000);
  await reached(7);
});

test("Generate reads Starting… and stays disabled until video.start answers; a start error shows in the tray", async ({ page, videoEngine: video }) => {
  const held = gate<void>();
  video.jobs.create(async () => {
    await held.promise;
    return { kind: "job", id: "gen-ui" };
  });
  await openCanvas(page, video.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await chooseVideo(page);
  await pressSend(page);
  const starting = composer(page).getByRole("button", { name: "Starting…" });
  await expect(starting).toBeDisabled();
  await expect.poll(() => video.jobs.creates.length).toBe(1);
  await page.keyboard.press("ControlOrMeta+Enter");
  await starting.click({ force: true }).catch(() => undefined);
  held.release();
  await expect(composer(page)).toHaveCount(0);
  expect(video.jobs.creates).toHaveLength(1);
  const shape = await waitForRoom(video.engine, "default", (records) => records.find((each) => each.meta?.unframed?.run?.runId === "gen-ui"));
  await expect(shapeOnScreen(page, shape.id).getByRole("status")).toHaveText("Rendering… (0 min)");
  expect(video.jobs.creates[0]!.body).toMatchObject({ model: SEEDANCE, prompt: "lone red fox", duration: 5, generate_audio: false });

  video.jobs.create(() => ({ kind: "status", status: 402, body: { error: { message: "Insufficient credits" } } }));
  // The subject is still selected. Clicking it again would start editing it, and tldraw focuses
  // a prompt's text 100 ms after editing starts, which can take the caret from the composer.
  await openComposer(page);
  await expect(composer(page).getByRole("radio", { name: "video" })).toHaveAttribute("aria-checked", "true");
  await pressSend(page);
  await expect(composer(page).getByRole("alert")).toHaveText(
    "OpenRouter refused this as unpaid: either the account is out of credit, or this key has hit its own spending cap. Add credit at openrouter.ai/credits, or check the key's cap at openrouter.ai/settings/keys. (Insufficient credits)",
  );
  await expect(sendButton(page)).toBeEnabled();
});
