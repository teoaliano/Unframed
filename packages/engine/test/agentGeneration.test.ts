import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKETCH_REFUSAL } from "@unframed/domain";
import { startGenerating, finished, until, type Generating } from "./generation.ts";
import { chatsIn, outsideLink } from "./outsideCalls.ts";
import { gate, imagePricing } from "./openRouterStub.ts";
import { PROJECT } from "./agent.ts";

const MODEL = "openai/image-test";
const PRICING = imagePricing({ [MODEL]: { data: { endpoints: [{ pricing: [{ unit: "image", billable: "output_image", cost_usd: 0.04 }] }] } } });
const prompt = (id: string, text: string) => ({ type: "create", id, kind: "prompt", x: 0, y: 0, props: { text } });

/** An engine with a key, a priced image model, and a project named board. */
const start = (env: Record<string, string> = {}) => startGenerating({ extra: [PRICING], env });

const shapes = async (generating: Generating) =>
  ((await generating.rpc.call("testCanvas.read", { project: PROJECT })).records as any[]).filter((record) => record.typeName === "shape");

const sidecarsOf = async (generating: Generating) => {
  const folder = join(generating.engine.dataDir, "output", PROJECT);
  const names = (await readdir(folder)).filter((name) => name.endsWith(".json") && !name.startsWith("unframed"));
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(folder, name), "utf8"))));
};

describe("an agent's generate", () => {
  it("a dry run answers the final prompt, the references and the estimate, and spends nothing", async () => {
    const generating = await start();
    try {
      const link = await outsideLink(generating as never);
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const before = await shapes(generating);
      const answer = await link.call(session, "generate", { project: PROJECT, medium: "image", sources: [made.value.ids["new:fox"]], instruction: "in snow", model: MODEL, dryRun: true });
      expect(answer.value).toEqual({ dryRun: true, prompt: "a red fox\n\nin snow", references: [], estimate: "est. ~$0.040 each", spendLimit: null });
      expect(await shapes(generating)).toEqual(before);
      expect(generating.requests).toEqual([]);
    } finally {
      await generating.engine.dispose();
    }
  });

  it("starts an image batch, answers its run at once, and lands each output with its cost and its chat", async () => {
    const generating = await start();
    try {
      const link = await outsideLink(generating as never);
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const answer = await link.call(session, "generate", { project: PROJECT, medium: "image", sources: [made.value.ids["new:fox"]], model: MODEL, runs: 2 });
      expect(answer.isError).toBe(false);
      expect(answer.value).toMatchObject({ status: "running", estimate: "est. ~$0.040 each", placeholders: [expect.any(String), expect.any(String)] });
      await finished(generating.events, answer.value.runId);
      const sidecars = await until(async () => {
        const found = await sidecarsOf(generating);
        return found.length === 2 ? found : undefined;
      }, "two sidecars");
      const [chat] = await chatsIn(generating as never);
      for (const sidecar of sidecars!) expect(sidecar).toMatchObject({ chat: { id: chat!.id, turn: 1 }, cost: expect.any(Number) });
      expect(generating.requests).toHaveLength(2);
    } finally {
      await generating.engine.dispose();
    }
  });

  it("refuses a selection with a loose mark, with the sentence that sends the person to the app", async () => {
    const generating = await start();
    try {
      const link = await outsideLink(generating as never);
      const session = await link.open();
      const made = await link.call(session, "canvas_write", {
        project: PROJECT,
        ops: [prompt("new:fox", "a red fox"), { type: "create", id: "new:mark", kind: "mark", x: 500, y: 500, props: { type: "geo", w: 40, h: 40, geo: "rectangle" } }],
      });
      const answer = await link.call(session, "generate", { project: PROJECT, medium: "image", sources: [made.value.ids["new:fox"], made.value.ids["new:mark"]], model: MODEL });
      expect(answer.isError).toBe(true);
      expect(answer.value).toEqual({ error: SKETCH_REFUSAL });
      expect(generating.requests).toEqual([]);
    } finally {
      await generating.engine.dispose();
    }
  });

  it("refuses the run that would pass the connection's limit, counting the run already reserved", async () => {
    const generating = await start();
    try {
      const link = await outsideLink(generating as never, "Capped", { usd: 0.05, period: "day" });
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const first = await link.call(session, "generate", { project: PROJECT, medium: "image", sources: [made.value.ids["new:fox"]], model: MODEL });
      expect(first.isError).toBe(false);
      await finished(generating.events, first.value.runId);
      const second = await link.call(session, "generate", { project: PROJECT, medium: "image", sources: [made.value.ids["new:fox"]], model: MODEL });
      expect(second.isError).toBe(true);
      expect(second.value.error).toBe(
        "This connection has spent $0.04 of its $0.05 limit per day, and this run would pass it. Raise the limit in Unframed's Settings, or wait until the period starts again. A dry run still works.",
      );
      const dry = await link.call(session, "generate", { project: PROJECT, medium: "image", sources: [made.value.ids["new:fox"]], model: MODEL, dryRun: true });
      expect(dry.value.spendLimit).toEqual({ usd: 0.05, period: "day", spent: expect.any(Number) });
    } finally {
      await generating.engine.dispose();
    }
  });

  it("refuses a text run under a limit, since its cost cannot be checked", async () => {
    const generating = await start();
    try {
      const link = await outsideLink(generating as never, "Capped", { usd: 1, period: "month" });
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const answer = await link.call(session, "generate", { project: PROJECT, medium: "text", sources: [made.value.ids["new:fox"]] });
      expect(answer.value.error).toBe(
        "This generation has no exact price, so this connection's spend limit cannot be checked. Remove the limit in Unframed's Settings, or make it in the app.",
      );
    } finally {
      await generating.engine.dispose();
    }
  });

  it("gives back the reservation when the run fails, so the spend reads zero", async () => {
    const generating = await start();
    try {
      generating.answer(() => ({ kind: "status", status: 500, body: { error: { message: "down" } } }));
      const link = await outsideLink(generating as never, "Capped", { usd: 1, period: "day" });
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const answer = await link.call(session, "generate", { project: PROJECT, medium: "image", sources: [made.value.ids["new:fox"]], model: MODEL });
      await finished(generating.events, answer.value.runId);
      await until(async () => ((await generating.rpc.call("agentConnections.list")).connections[0]?.spent === 0 ? true : undefined), "the reservation released");
    } finally {
      await generating.engine.dispose();
    }
  });

  it("keeps the outside turn open while its paid run is in flight, and settles it once the run lands", async () => {
    const held = gate<void>();
    const generating = await start({ UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS: "200" });
    try {
      generating.answer(async () => {
        await held.promise;
        return { kind: "image", bytes: Buffer.from(new Uint8Array(0)) as never };
      });
      const link = await outsideLink(generating as never);
      const session = await link.open();
      const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:fox", "a red fox")] });
      const answer = await link.call(session, "generate", { project: PROJECT, medium: "image", sources: [made.value.ids["new:fox"]], model: MODEL });
      const [chat] = await chatsIn(generating as never);
      await new Promise((resolve) => setTimeout(resolve, 600));
      const during = await until(async () => {
        const watched = await generating.rpc.subscribe("orchestration.subscribeThread", { projectId: PROJECT, threadId: chat!.id });
        const first = (await watched.next(0)) as unknown as { snapshot: { thread: { latestTurn: { state: string } | null } } };
        await watched.close();
        return first.snapshot.thread.latestTurn?.state;
      }, "the turn to read");
      expect(during).toBe("running");
      held.release();
      await finished(generating.events, answer.value.runId);
      const settled = await until(async () => {
        const watched = await generating.rpc.subscribe("orchestration.subscribeThread", { projectId: PROJECT, threadId: chat!.id });
        const first = (await watched.next(0)) as unknown as { snapshot: { thread: { latestTurn: { state: string } | null } } };
        await watched.close();
        return first.snapshot.thread.latestTurn?.state === "completed" ? true : undefined;
      }, "the turn to settle");
      expect(settled).toBe(true);
    } finally {
      await generating.engine.dispose();
    }
  });
});
