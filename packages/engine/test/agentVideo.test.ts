import { describe, expect, it } from "vitest";
import { VIDEO_RUNS_REFUSAL } from "@unframed/domain";
import { PROJECT } from "./agent.ts";
import { startGenerating, type Generating } from "./generation.ts";
import { outsideLink } from "./outsideCalls.ts";
import { completed, videoCatalogue, videoJobs } from "./videoStub.ts";
import { eventually } from "./video.ts";

const VIDEO = "bytedance/seedance-2.0";
const UNPRICED = "free/clip";
const CLIP = Buffer.concat([Buffer.from("\x00\x00\x00\x18ftypmp42"), Buffer.alloc(4096, 7)]);
const prompt = (id: string, text: string) => ({ type: "create", id, kind: "prompt", x: 0, y: 0, props: { text } });
const NO_PRICE =
  "This generation has no exact price, so this connection's spend limit cannot be checked. Remove the limit in Unframed's Settings, or make it in the app.";

/** Starts an engine with a priced video model (12 cents a second, 5 s by default) and one with no price. */
const start = async (jobs = videoJobs()) => {
  jobs.clip(() => CLIP);
  const catalogue = videoCatalogue({
    data: [
      { id: VIDEO, name: "Seedance", supported_durations: [5, 10], supported_resolutions: ["480p", "720p"], supported_aspect_ratios: ["16:9", "9:16"], pricing_skus: { cents_per_second_output: 12 } },
      { id: UNPRICED, name: "Unpriced", supported_durations: [5] },
    ],
  });
  const generating = await startGenerating({ extra: [catalogue, jobs.handler] });
  return { generating, jobs };
};

const connections = async (generating: Generating) => (await generating.rpc.call("agentConnections.list")).connections as ReadonlyArray<{ spent: number }>;

describe("an agent's video generate", () => {
  it("a dry run prices one clip from the model's per-second price and sends nothing", async () => {
    const { generating, jobs } = await start();
    try {
      const link = await outsideLink(generating as never);
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const answer = await link.call(session, "generate", {
        project: PROJECT,
        medium: "video",
        sources: [made.value.ids["new:fox"]],
        instruction: "in snow",
        model: VIDEO,
        dryRun: true,
      });
      expect(answer.value).toEqual({ dryRun: true, prompt: "a red fox\n\nin snow", references: [], estimate: "est. ~$0.60", spendLimit: null });
      expect(jobs.creates).toEqual([]);
    } finally {
      await generating.engine.dispose();
    }
  });

  it("an accepted video answers its placeholder at once, and when it lands the ledger holds the clip's cost", async () => {
    const jobs = videoJobs();
    const { generating } = await start(jobs);
    try {
      jobs.status((id) => completed(generating.engine.stub!.origin, id));
      const link = await outsideLink(generating as never, "Capped", { usd: 5, period: "day" });
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const answer = await link.call(session, "generate", {
        project: PROJECT,
        medium: "video",
        sources: [made.value.ids["new:fox"]],
        instruction: "in snow",
        model: VIDEO,
      });
      expect(answer.isError).toBe(false);
      expect(answer.value).toMatchObject({ status: "running", estimate: "est. ~$0.60", placeholders: [expect.any(String)] });
      expect(jobs.creates).toHaveLength(1);
      expect(jobs.creates[0]!.body).toMatchObject({ model: VIDEO, prompt: "a red fox\n\nin snow", duration: 5 });

      // The render lands when it is polled (the sweep is off in tests), and the cost settles the ledger.
      const landed = await generating.rpc.call("video.poll", {
        jobId: answer.value.runId,
        project: PROJECT,
        params: { prompt: "a red fox\n\nin snow", model: VIDEO, duration: 5, resolution: null, size: null },
      });
      expect(landed).toMatchObject({ status: "completed" });
      await eventually(async () => ((await connections(generating))[0]!.spent === 0.42 ? true : undefined), "the clip's cost to settle");
    } finally {
      await generating.engine.dispose();
    }
  });

  it("refuses a model with no exact price under a limit, since its cost cannot be checked", async () => {
    const { generating, jobs } = await start();
    try {
      const link = await outsideLink(generating as never, "Capped", { usd: 1, period: "day" });
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const answer = await link.call(session, "generate", { project: PROJECT, medium: "video", sources: [made.value.ids["new:fox"]], model: UNPRICED });
      expect(answer).toMatchObject({ isError: true, value: { error: NO_PRICE } });
      expect(jobs.creates).toEqual([]);
    } finally {
      await generating.engine.dispose();
    }
  });

  it("refuses more than one clip and an unknown model, before anything is sent", async () => {
    const { generating, jobs } = await start();
    try {
      const link = await outsideLink(generating as never);
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const source = made.value.ids["new:fox"];
      expect(await link.call(session, "generate", { project: PROJECT, medium: "video", sources: [source], model: VIDEO, runs: 2 })).toMatchObject({
        isError: true,
        value: { error: VIDEO_RUNS_REFUSAL },
      });
      expect(await link.call(session, "generate", { project: PROJECT, medium: "video", sources: [source], model: "nope/none" })).toMatchObject({
        isError: true,
        value: { error: 'Unframed has no video model called "nope/none".' },
      });
      expect(jobs.creates).toEqual([]);
    } finally {
      await generating.engine.dispose();
    }
  });
});
