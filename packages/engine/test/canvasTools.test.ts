import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine } from "./agent.ts";
import { geoMark, motionShape, roomShape, seed, toolResults } from "./agentCanvas.ts";
import { groupShape, imageAsset, imageShape, pageShape, promptShape, refOf, textOf } from "./canvasRecords.ts";
import { connectTab } from "./syncClient.ts";

const RECIPE = {
  medium: "image",
  model: "openai/gpt-image-2",
  params: { quality: "high" },
  selectionPrompt: "a lone red fox",
  instruction: "",
  references: [],
  sources: ["shape:p1"],
};

const resultMeta = (sidecar: string) => ({
  unframed: { result: { sidecar, medium: "image", model: "openai/gpt-image-2", batchId: "b1", runIndex: 1, runCount: 1, cost: 0.04, sources: ["shape:p1"] } },
});

describe("canvas_read", () => {
  it("answers every shape's documented fields and the message's selection, and never a byte of media", async () => {
    const agent = await startAgentEngine();
    await writeFile(join(agent.folder, "1700000000000-result.json"), JSON.stringify({ file: "1700000000000-result.png", recipe: RECIPE }));
    await seed(agent, [
      promptShape("p1", "100", "a lone red fox", { index: "a1" }),
      imageAsset("a3", "project-file:1700000000000-hero.png", { name: "hero.png", w: 800, h: 400 }),
      imageShape("i3", "101", "asset:a3", { x: 0, y: 200, index: "a2" }, { w: 400, h: 200 }),
      geoMark("d1", { x: 50, y: 250, index: "a3" }, { richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "sky" }] }] } }),
      groupShape("g1", "hero", { x: 1000, y: 0, index: "a4" }),
      promptShape("p2", "102", "second member", { x: 30, y: 160, parentId: "shape:g1", index: "a1" }),
      promptShape("p3", "103", "first member", { x: 30, y: 60, parentId: "shape:g1", index: "a2" }),
      pageShape("pg1", "104", { title: "Landing", file: "landing.html", dials: { accent: "#ff0000" } }, { x: 0, y: 600, index: "a5" }),
      { ...(imageShape("r1", "105", "asset:a3", { x: 600, y: 0, index: "a6" }) as any), meta: { ref: "105", ...resultMeta("1700000000000-result.json") } },
      { ...(imageShape("r2", "106", null, { x: 900, y: 600, index: "a7" }) as any), meta: { ref: "106", unframed: { run: { runId: "run-9", runIndex: 1, startedAt: 1 } } } },
    ]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "what is on the board?", { selection: ["shape:pg1", "shape:gone"] });
    const chat = await agent.settled(chatId, 1);
    const [read] = toolResults(chat, "canvas_read");
    expect(read?.status).toBe("completed");
    const shapes = new Map((read!.result.shapes as any[]).map((shape) => [shape.id, shape]));
    expect(read!.result.selection).toEqual(["pg1"]);
    expect(shapes.get("p1")).toMatchObject({ kind: "prompt", ref: "100", text: "a lone red fox", x: 0, y: 0 });
    expect(shapes.get("i3")).toMatchObject({ kind: "image", file: "1700000000000-hero.png", fileName: "hero.png", aspect: 2, w: 400, h: 200 });
    expect(shapes.get("i3")).not.toHaveProperty("crop");
    expect(shapes.get("d1")).toMatchObject({ kind: "mark", type: "geo", text: "sky", on: "i3" });
    expect(shapes.get("g1")).toMatchObject({ kind: "group", ref: "hero", members: ["p3", "p2"] });
    expect(shapes.get("p2")).toMatchObject({ parent: "g1", x: 30, y: 160 });
    expect(shapes.get("pg1")).toMatchObject({ kind: "page", file: "landing.html", title: "Landing", dials: { accent: "#ff0000" } });
    expect(shapes.get("r1")).toMatchObject({ kind: "image", recipe: RECIPE });
    expect(shapes.get("r2")).toMatchObject({ running: true });
    expect(shapes.get("p1")).not.toHaveProperty("running");
    expect(JSON.stringify(read!.result)).not.toMatch(/data:|base64/i);
  });
});

describe("canvas_write", () => {
  it("lands a batch of several ops in the room as one change that a connected tab sees", async () => {
    const agent = await startAgentEngine();
    const clock = await seed(agent, [motionShape("m1", "150", "Intro"), motionShape("m2", "151", "Outro", {}, { x: 700 })]);
    const tab = await connectTab(agent.engine.port, "board");
    await tab.loaded;
    const chatId = await agent.createChat();
    await agent.send(chatId, "make the titles red");
    const chat = await agent.settled(chatId, 1);
    const [write] = toolResults(chat, "canvas_write");
    expect(write?.result).toEqual({ ok: true, ids: {}, clock: clock + 1 });
    await tab.waitFor(() => tab.get("shape:m1")?.props.title === "Intro (red)" && tab.get("shape:m2")?.props.title === "Outro (red)");
    await tab.close();
  });

  it("maps every provisional id, and changes nothing when one op of the batch is bad", async () => {
    const script = await scriptFolder({
      write: {
        when: "^go",
        turns: [
          {
            text: "Done.",
            tools: [
              {
                name: "canvas_write",
                input: {
                  ops: [
                    { type: "create", id: "new:box", kind: "group", x: 0, y: 0, props: { name: "Shots" } },
                    { type: "create", id: "new:caption", kind: "prompt", x: 30, y: 60, parent: "new:box", props: { text: "a caption" } },
                  ],
                },
              },
              { name: "canvas_write", input: { ops: [{ type: "update", id: "m1", props: { title: "Changed" } }, { type: "update", id: "gone", props: { title: "x" } }] } },
            ],
          },
        ],
      },
    });
    const agent = await startAgentEngine({ script });
    await seed(agent, [motionShape("m1", "150", "Intro")]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go");
    const chat = await agent.settled(chatId, 1);
    const [created, refused] = toolResults(chat, "canvas_write");
    expect(Object.keys(created!.result.ids)).toEqual(["new:box", "new:caption"]);
    const box = await roomShape(agent, created!.result.ids["new:box"]);
    const caption = await roomShape(agent, created!.result.ids["new:caption"]);
    expect(box).toMatchObject({ type: "frame", props: { name: "shots" } });
    expect(caption).toMatchObject({ type: "text", parentId: box.id });
    expect(textOf(caption)).toBe("a caption");
    expect(Number(refOf(caption))).toBeGreaterThanOrEqual(100);
    expect(refused).toMatchObject({ status: "failed", result: { error: "update: there is no shape gone" } });
    expect((await roomShape(agent, "m1")).props.title).toBe("Intro");
  });
});

describe("canvas_write group ops", () => {
  it("reparents by spec 02's rules and renames by spec 06's, rewriting @ references in the same write", async () => {
    const script = await scriptFolder({
      groups: {
        when: "^group",
        turns: [
          {
            text: "Grouped.",
            tools: [
              { name: "canvas_write", input: { ops: [{ type: "reparent", id: "p1", parent: "g1" }] } },
              { name: "canvas_write", input: { ops: [{ type: "reparent", id: "pg1", parent: "g1" }] } },
              { name: "canvas_write", input: { ops: [{ type: "rename", id: "g1", name: "Hero Shots" }] } },
            ],
          },
        ],
      },
    });
    const agent = await startAgentEngine({ script });
    await seed(agent, [
      groupShape("g1", "hero", { x: 500, y: 100 }),
      promptShape("p1", "100", "loose", { x: 600, y: 300 }),
      promptShape("p2", "101", "see @hero and @hero-2"),
      pageShape("pg1", "102", {}, { x: 0, y: 800 }),
    ]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "group these");
    const chat = await agent.settled(chatId, 1);
    const [into, refused, renamed] = toolResults(chat, "canvas_write");
    expect(into?.result.ok).toBe(true);
    expect(await roomShape(agent, "p1")).toMatchObject({ parentId: "shape:g1", x: 100, y: 200 });
    expect(refused?.result).toEqual({ error: "reparent: a page cannot be a member of a group" });
    expect(renamed?.result.clock).toBe(into!.result.clock + 1);
    expect((await roomShape(agent, "g1")).props.name).toBe("hero-shots");
    expect(textOf(await roomShape(agent, "p2"))).toBe("see @hero-shots and @hero-2");
  });
});
