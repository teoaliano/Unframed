import { describe, expect, it } from "vitest";
import { PROJECT } from "./agent.ts";
import { startGenerating, type Generating } from "./generation.ts";
import { imageCatalogue, imagePricing } from "./openRouterStub.ts";
import { chatsIn, outsideLink } from "./outsideCalls.ts";

const MODEL = "openai/image-test";
const CATALOGUE = imageCatalogue({ data: [{ id: MODEL, name: "Image test", supported_parameters: { resolution: ["1K", "2K"] } }] });
const PRICING = imagePricing({ [MODEL]: { data: { endpoints: [{ pricing: [{ unit: "image", billable: "output_image", cost_usd: 0.04 }] }] } } });

const start = () => startGenerating({ extra: [PRICING, CATALOGUE] });

const room = async (generating: Generating) => ((await generating.rpc.call("testCanvas.read", { project: PROJECT })).records as any[]).filter((record) => record.typeName === "shape");

const build = async (link: Awaited<ReturnType<typeof outsideLink>>, session: string) =>
  link.call(session, "canvas_write", {
    project: PROJECT,
    ops: [
      { type: "create", id: "new:fox", kind: "prompt", x: 0, y: 0, props: { text: "a red fox" } },
      { type: "create", id: "new:still", kind: "node", x: 400, y: 0, props: { medium: "image", model: MODEL, instruction: "in snow" } },
      { type: "create", id: "new:again", kind: "node", x: 900, y: 0, props: { medium: "image", model: MODEL, instruction: "at night" } },
      { type: "create", id: "new:w1", kind: "wire", x: 0, y: 0, props: { from: "new:fox", to: "new:still", role: "prompt" } },
      { type: "create", id: "new:w2", kind: "wire", x: 0, y: 0, props: { from: "new:still", to: "new:again", role: "reference" } },
    ],
  });

describe("an agent's nodes and wires", () => {
  it("canvas_write makes nodes and wires, and canvas_read reports them with their status and roles", async () => {
    const generating = await start();
    try {
      const link = await outsideLink(generating as never);
      const session = await link.open();
      const made = await build(link, session);
      expect(made.isError).toBe(false);
      const read = await link.call(session, "canvas_read", { project: PROJECT });
      const still = read.value.shapes.find((shape: any) => shape.id === made.value.ids["new:still"]);
      expect(still).toMatchObject({ kind: "node", medium: "image", model: MODEL, instruction: "in snow", status: "not_run", statusLine: "Not run yet.", versions: 0, w: 380, h: 360 });
      const again = read.value.shapes.find((shape: any) => shape.id === made.value.ids["new:again"]);
      expect(again).toMatchObject({ status: "waiting", statusLine: `Waiting for @${still.ref}, which has no result yet.` });
      expect(read.value.shapes).toContainEqual({ id: made.value.ids["new:w1"], kind: "wire", from: made.value.ids["new:fox"], to: made.value.ids["new:still"], role: "prompt" });
    } finally {
      await generating.engine.dispose();
    }
  });

  it("refuses a wire into a shape that is not a node, a loop, and the fields runs write; deleting a node takes its wires", async () => {
    const generating = await start();
    try {
      const link = await outsideLink(generating as never);
      const session = await link.open();
      const made = await build(link, session);
      const ids = made.value.ids;
      const intoPrompt = await link.call(session, "canvas_write", { project: PROJECT, ops: [{ type: "create", id: "new:x", kind: "wire", x: 0, y: 0, props: { from: ids["new:still"], to: ids["new:fox"], role: "prompt" } }] });
      expect(intoPrompt).toMatchObject({ isError: true, value: { error: expect.stringContaining("A wire ends at a node. Drop it on a node.") } });
      const loop = await link.call(session, "canvas_write", { project: PROJECT, ops: [{ type: "create", id: "new:x", kind: "wire", x: 0, y: 0, props: { from: ids["new:again"], to: ids["new:still"], role: "reference" } }] });
      expect(loop).toMatchObject({ isError: true, value: { error: expect.stringContaining("would loop back into") } });
      const written = await link.call(session, "canvas_write", { project: PROJECT, ops: [{ type: "update", id: ids["new:still"], props: { versions: [] } }] });
      expect(written).toMatchObject({ isError: true, value: { error: "update: versions is written by runs" } });
      const role = await link.call(session, "canvas_write", { project: PROJECT, ops: [{ type: "update", id: ids["new:w2"], props: { role: "first" } }] });
      expect(role).toMatchObject({ isError: true, value: { error: "update: Image nodes take no first." } });
      const deleted = await link.call(session, "canvas_write", { project: PROJECT, ops: [{ type: "delete", id: ids["new:still"] }] });
      expect(deleted.isError).toBe(false);
      expect((await room(generating)).filter((shape) => shape.type === "wire")).toEqual([]);
    } finally {
      await generating.engine.dispose();
    }
  });

  it("node_run answers a dry run step by step, then runs the chain, and a revert of the turn leaves the files", async () => {
    const generating = await start();
    try {
      const link = await outsideLink(generating as never);
      const session = await link.open();
      const made = await build(link, session);
      const ids = made.value.ids;
      const dry = await link.call(session, "node_run", { project: PROJECT, ids: [ids["new:still"]], downstream: true, dryRun: true });
      expect(dry.value).toEqual({
        dryRun: true,
        steps: [
          { node: ids["new:still"], prompt: "a red fox\n\nin snow", references: [], estimate: "est. ~$0.040" },
          { node: ids["new:again"], prompt: "at night", references: ["image 1"], estimate: "est. ~$0.040" },
        ],
        estimate: "est. ~$0.080",
        spendLimit: null,
      });
      expect(generating.requests).toEqual([]);
      const ran = await link.call(session, "node_run", { project: PROJECT, ids: [ids["new:still"]], downstream: true });
      expect(ran.value).toMatchObject({ chainId: expect.stringMatching(/^chain-/), nodes: [ids["new:still"], ids["new:again"]], status: "running" });
      for (let tries = 0; !(await room(generating)).find((shape) => shape.id === `shape:${ids["new:again"]}`)?.props.currentVersionId; tries++) {
        if (tries > 400) throw new Error("the chain did not land");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(generating.requests.map((request) => request.body.prompt)).toEqual(["a red fox\n\nin snow", "at night"]);
      const [chat] = await chatsIn(generating as never);
      expect(chat).toBeDefined();
    } finally {
      await generating.engine.dispose();
    }
  });

  it("node_run counts the whole chain against the connection's spend limit and names the step that would pass it", async () => {
    const generating = await start();
    try {
      const link = await outsideLink(generating as never, "Laptop", { usd: 0.05, period: "day" });
      const session = await link.open();
      const made = await build(link, session);
      const answer = await link.call(session, "node_run", { project: PROJECT, ids: [made.value.ids["new:still"], made.value.ids["new:again"]] });
      expect(answer.isError).toBe(true);
      expect(answer.value.error).toMatch(/^Step 2 \(@\d+\): /);
      expect(generating.requests).toEqual([]);
      const dry = await link.call(session, "node_run", { project: PROJECT, ids: [made.value.ids["new:still"]], dryRun: true });
      expect(dry.value.spendLimit).toMatchObject({ usd: 0.05, period: "day", spent: 0 });
    } finally {
      await generating.engine.dispose();
    }
  });
});
