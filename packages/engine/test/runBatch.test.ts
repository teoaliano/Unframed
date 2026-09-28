import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventsOf, finished, pngBytes, runRequest, startGenerating, until, type Generating } from "./generation.ts";
import { gate } from "./openRouterStub.ts";

const folderOf = (generating: Generating) => join(generating.engine.dataDir, "output", "board");

const roomShapes = async (generating: Generating) =>
  ((await generating.rpc.call("testCanvas.read", { project: "board" })).records as any[]).filter((record) => record.typeName === "shape");

const sidecarOf = async (generating: Generating, shape: any) => JSON.parse(await readFile(join(folderOf(generating), shape.meta.unframed.result.sidecar), "utf8"));

describe("run.image with several outputs", () => {
  it("places every placeholder at once in run order, calls upstream concurrently, and fills each as it lands in any order", async () => {
    const generating = await startGenerating();
    const gates = [1, 2, 3, 4].map(() => gate<void>());
    generating.answer(async ({ body }) => {
      const index = Number(/#(\d)/.exec(body.prompt)![1]);
      await gates[index - 1]!.promise;
      return { kind: "image", bytes: pngBytes(10 * index, 10), cost: 0.01 * index };
    });
    const started = await generating.rpc.call(
      "run.image",
      runRequest({ batchId: "b-1700000000000", outputs: [1, 2, 3, 4].map((index) => ({ prompt: `fox #${index}`, references: [] })) }),
    );
    expect(started.batchId).toBe("b-1700000000000");
    expect(started.placeholders).toHaveLength(4);

    const placed = (await roomShapes(generating)).filter((shape) => started.placeholders.includes(shape.id));
    const inOrder = started.placeholders.map((id) => placed.find((shape) => shape.id === id));
    expect(inOrder.map((shape) => [shape.meta.unframed.run.runIndex, shape.meta.unframed.result.runIndex, shape.meta.unframed.result.runCount])).toEqual([
      [1, 1, 4],
      [2, 2, 4],
      [3, 3, 4],
      [4, 4, 4],
    ]);
    const xs = inOrder.map((shape) => shape.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(new Set(inOrder.map((shape) => shape.y)).size).toBe(1);

    // Every call is in flight before any is answered.
    await until(() => (generating.requests.length === 4 ? true : undefined), "four upstream calls");

    for (const index of [3, 1, 4, 2]) {
      gates[index - 1]!.release();
      await expect
        .poll(async () => (await roomShapes(generating)).find((shape) => shape.id === started.placeholders[index - 1])?.props.assetId ?? null)
        .toMatch(/^asset:/);
    }
    const done = await finished(generating.events, started.runId);
    expect(done).toEqual({ type: "finished", runId: started.runId, succeeded: 4, failed: 0, errors: [], orphaned: 0 });
    expect(eventsOf(generating.events, started.runId).filter((event) => event.type === "output").map((event) => event.runIndex)).toEqual([3, 1, 4, 2]);

    const shapes = await roomShapes(generating);
    for (const [index, id] of started.placeholders.entries()) {
      const shape = shapes.find((each) => each.id === id);
      expect(shape.meta.unframed.result).toMatchObject({ batchId: "b-1700000000000", runIndex: index + 1, runCount: 4, cost: 0.01 * (index + 1) });
      expect(await sidecarOf(generating, shape)).toMatchObject({ batchId: "b-1700000000000", runIndex: index + 1, runCount: 4 });
    }
    await generating.engine.dispose();
  });

  it("records a Free output's own recipe, its picks, and the batch's extra cost", async () => {
    const generating = await startGenerating();
    const started = await generating.rpc.call(
      "run.image",
      runRequest({
        batchId: "b-1700000000001",
        batchExtraCost: 0.0021,
        selectionPrompt: "in ink",
        instruction: "at dawn",
        outputs: [
          { prompt: "in ink\n\na fox\n\nat dawn", references: [], selectionPrompt: "in ink\n\na fox", free: { picks: [2], dropped: [5] } },
          { prompt: "in ink\n\na wolf\n\nat dawn", references: [], selectionPrompt: "in ink\n\na wolf", free: { picks: null, dropped: [] } },
        ],
      }),
    );
    for (const id of started.placeholders) {
      const placeholder = (await roomShapes(generating)).find((shape) => shape.id === id);
      expect(placeholder.meta.unframed.result.batchExtraCost).toBe(0.0021);
    }
    await finished(generating.events, started.runId);
    const shapes = await roomShapes(generating);
    const [fox, wolf] = started.placeholders.map((id) => shapes.find((shape) => shape.id === id));
    expect(fox.meta.unframed.result.batchExtraCost).toBe(0.0021);
    const foxSidecar = await sidecarOf(generating, fox);
    expect(foxSidecar.free).toEqual({ picks: [2], dropped: [5] });
    expect(foxSidecar.recipe).toMatchObject({ selectionPrompt: "in ink\n\na fox", instruction: "at dawn" });
    const wolfSidecar = await sidecarOf(generating, wolf);
    expect(wolfSidecar.free).toEqual({ picks: null, dropped: [] });
    expect(wolfSidecar.recipe.selectionPrompt).toBe("in ink\n\na wolf");
    await generating.engine.dispose();
  });

  it("keeps a partial batch's successes and reports each distinct error once", async () => {
    const generating = await startGenerating();
    generating.answer(({ body }) => {
      if (body.prompt.startsWith("good")) return { kind: "image", bytes: pngBytes(8, 8) };
      if (body.prompt === "busy") return { kind: "status", status: 503, body: { error: { message: "busy" } } };
      return { kind: "no-image" };
    });
    const started = await generating.rpc.call("run.image", runRequest({ outputs: ["good 1", "busy", "empty", "busy", "good 2"].map((prompt) => ({ prompt, references: [] })) }));
    const done = await finished(generating.events, started.runId);
    expect(done).toEqual({
      type: "finished",
      runId: started.runId,
      succeeded: 2,
      failed: 3,
      errors: expect.arrayContaining(["OpenRouter (503): busy", "OpenRouter returned no image data."]),
      orphaned: 0,
    });
    expect(done.errors).toHaveLength(2);
    const shapes = await roomShapes(generating);
    expect(started.placeholders.filter((id) => shapes.some((shape) => shape.id === id))).toEqual([started.placeholders[0], started.placeholders[4]]);
    await generating.engine.dispose();
  });

  it("leaves a plain run's sidecar without free and its meta without an extra cost", async () => {
    const generating = await startGenerating();
    const started = await generating.rpc.call("run.image", runRequest());
    await finished(generating.events, started.runId);
    const shape = (await roomShapes(generating)).find((each) => each.id === started.placeholders[0]);
    expect("batchExtraCost" in shape.meta.unframed.result).toBe(false);
    const sidecar = await sidecarOf(generating, shape);
    expect("free" in sidecar).toBe(false);
    expect(sidecar.recipe.selectionPrompt).toBe("a lone red fox");
    await generating.engine.dispose();
  });
});
