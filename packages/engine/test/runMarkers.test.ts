import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { describe, expect, it } from "vitest";
import { imageAsset, imageShape } from "./canvasRecords.ts";
import { finished, KEY, pngBytes, runRequest, startGenerating, until, type Generating } from "./generation.ts";
import { startEngine } from "./harness.ts";
import { gate } from "./openRouterStub.ts";
import { connectTab } from "./syncClient.ts";

const read = async (generating: Generating) => (await generating.rpc.call("testCanvas.read", { project: "board" })).records as any[];

const shapeIn = async (generating: Generating, id: string) => (await read(generating)).find((record) => record.id === id);

/** A placeholder as a run leaves it, for a run this process may or may not know. */
const stalePlaceholder = (id: string, ref: string, runId: string, assetId: string | null = null): TLRecord =>
  ({
    ...(imageShape(id, ref, assetId, { x: 900, y: 0 }, { w: 320, h: 320 }) as any),
    meta: {
      ref,
      unframed: {
        run: { runId, runIndex: 1, startedAt: 1 },
        result: { sidecar: null, medium: "image", model: "openai/gpt-image-2", batchId: "b-1", runIndex: 1, runCount: 1, cost: null, sources: [] },
      },
    },
  }) as TLRecord;

describe("durability", () => {
  it("finishes and lands with no web client connected, even when the socket that started it closes", async () => {
    const generating = await startGenerating();
    const held = gate<void>();
    generating.answer(async () => {
      await held.promise;
      return { kind: "image", bytes: pngBytes(20, 10) };
    });
    const starter = await generating.engine.rpc();
    const started = await starter.call("run.image", runRequest());
    await starter.close();
    await until(() => (generating.requests.length === 1 ? true : undefined), "the upstream call");
    held.release();
    await finished(generating.events, started.runId);
    const filled = await shapeIn(generating, started.placeholders[0]!);
    expect(filled.props.assetId).toMatch(/^asset:/);
    expect(filled.meta.unframed.run).toBeUndefined();
    await generating.engine.dispose();
  });
});

describe("a placeholder deleted while its run is in flight", () => {
  it("is not recreated; the file and sidecar still land, the log says so and the run counts it", async () => {
    const generating = await startGenerating();
    const tab = await connectTab(generating.engine.port, "board");
    await tab.loaded;
    const held = gate<void>();
    generating.answer(async () => {
      await held.promise;
      return { kind: "image", bytes: pngBytes(20, 10) };
    });
    const started = await generating.rpc.call("run.image", runRequest({ outputs: [{ prompt: "gone", references: [] }, { prompt: "kept", references: [] }] }));
    await tab.waitFor(() => tab.get(started.placeholders[0]!));
    await tab.remove([started.placeholders[0]!]);
    held.release();
    const done = await finished(generating.events, started.runId);
    expect(done).toMatchObject({ succeeded: 2, failed: 0, orphaned: 1 });
    expect(await shapeIn(generating, started.placeholders[0]!)).toBeUndefined();
    expect((await shapeIn(generating, started.placeholders[1]!)).props.assetId).toMatch(/^asset:/);
    const files = await readdir(join(generating.engine.dataDir, "output", "board"));
    const gone = files.find((name) => name.endsWith("-gone-1.png"))!;
    expect(files).toContain(gone.replace(/\.png$/, ".json"));
    expect(generating.engine.stdout()).toContain(
      `  ${started.runId}: output 1 landed after its placeholder was deleted → ${join(generating.engine.dataDir, "output", "board", gone)}`,
    );
    await tab.close();
    await generating.engine.dispose();
  });
});

describe("a placeholder restored by undo", () => {
  const deletedThenRestored = async (answer: "image" | "fail") => {
    const generating = await startGenerating();
    const tab = await connectTab(generating.engine.port, "board");
    await tab.loaded;
    const held = gate<void>();
    generating.answer(async () => {
      await held.promise;
      return answer === "image" ? { kind: "image", bytes: pngBytes(40, 10) } : { kind: "status", status: 500, body: { error: { message: "down" } } };
    });
    const started = await generating.rpc.call("run.image", runRequest());
    const id = started.placeholders[0]!;
    const placeholder = await tab.waitFor(() => tab.get(id));
    await tab.remove([id]);
    held.release();
    await finished(generating.events, started.runId);
    // The tab's undo puts the placeholder back as it was, marker and all.
    await tab.put([placeholder]);
    return { generating, tab, id };
  };

  it("is filled when its output succeeded", async () => {
    const { generating, tab, id } = await deletedThenRestored("image");
    const shape = await tab.waitFor(() => {
      const current = tab.get(id);
      return current?.props.assetId ? current : undefined;
    });
    expect(shape.meta.unframed.run).toBeUndefined();
    expect(shape.meta.unframed.result.sidecar).toMatch(/\.json$/);
    expect(shape.props.h).toBeCloseTo(320 / 4);
    await tab.close();
    await generating.engine.dispose();
  });

  it("is deleted when its output failed", async () => {
    const { generating, tab, id } = await deletedThenRestored("fail");
    await tab.waitFor(() => !tab.get(id));
    expect(await shapeIn(generating, id)).toBeUndefined();
    await tab.close();
    await generating.engine.dispose();
  });

  it("is deleted when its run is unknown, and loses only its marker when it holds a file", async () => {
    const generating = await startGenerating();
    const tab = await connectTab(generating.engine.port, "board");
    await tab.loaded;
    await tab.put([stalePlaceholder("empty", "700", "run-unknown")]);
    await tab.waitFor(() => !tab.get("shape:empty"));
    await generating.rpc.call("testCanvas.apply", {
      project: "board",
      change: { put: [imageAsset("held", "project-file:held.png"), stalePlaceholder("held", "701", "run-unknown", "asset:held")], remove: [] },
      origin: { kind: "server", id: "test" },
    });
    const kept = await tab.waitFor(() => {
      const current = tab.get("shape:held");
      return current && current.meta.unframed.run === undefined ? current : undefined;
    });
    expect(kept.props.assetId).toBe("asset:held");
    expect(kept.meta.unframed.result.model).toBe("openai/gpt-image-2");
    await tab.close();
    await generating.engine.dispose();
  });

  it("is left alone while its run is live", async () => {
    const generating = await startGenerating();
    const tab = await connectTab(generating.engine.port, "board");
    await tab.loaded;
    const held = gate<void>();
    generating.answer(async () => {
      await held.promise;
      return { kind: "image", bytes: pngBytes(10, 10) };
    });
    const started = await generating.rpc.call("run.image", runRequest());
    const id = started.placeholders[0]!;
    const placeholder = await tab.waitFor(() => tab.get(id));
    await tab.remove([id]);
    await tab.put([placeholder]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await shapeIn(generating, id)).meta.unframed.run.runId).toBe(started.runId);
    held.release();
    await finished(generating.events, started.runId);
    await tab.waitFor(() => tab.get(id)?.props.assetId);
    await tab.close();
    await generating.engine.dispose();
  });
});

describe("stale markers", () => {
  it("are resolved when the room first opens after a restart: empty placeholders go, filled ones lose the marker", async () => {
    const first = await startEngine({ dotenv: `OPENROUTER_API_KEY=${KEY}\n`, env: { UNFRAMED_TEST_CANVAS: "1" } });
    const dataDir = first.dataDir;
    const rpc = await first.rpc();
    await rpc.call("projects.create", { name: "board" });
    await rpc.call("testCanvas.apply", {
      project: "board",
      change: {
        put: [
          stalePlaceholder("stale", "700", "run-old"),
          imageAsset("filled", "project-file:filled.png"),
          stalePlaceholder("filled", "701", "run-old", "asset:filled"),
        ],
        remove: [],
      },
      // Written the way the run itself writes, so nothing resolves it in this process.
      origin: { kind: "server", id: "run:run-old" },
    });
    expect((await rpc.call("testCanvas.read", { project: "board" })).records.some((record: any) => record.id === "shape:stale")).toBe(true);
    await first.stop("SIGKILL");

    const second = await startEngine({ dataDir, dotenv: `OPENROUTER_API_KEY=${KEY}\n`, env: { UNFRAMED_TEST_CANVAS: "1" } });
    const records = (await (await second.rpc()).call("testCanvas.read", { project: "board" })).records as any[];
    expect(records.find((record) => record.id === "shape:stale")).toBeUndefined();
    const filled = records.find((record) => record.id === "shape:filled");
    expect(filled.meta.unframed.run).toBeUndefined();
    expect(filled.props.assetId).toBe("asset:filled");
    await second.dispose();
    await rm(dataDir, { recursive: true, force: true });
  });
});

describe("recipe.read", () => {
  it("answers a result's recipe from its sidecar, and says so when the sidecar is gone", async () => {
    const generating = await startGenerating();
    const started = await generating.rpc.call("run.image", runRequest({ params: { quality: "high" }, instruction: "moody", sources: ["shape:starter-subject"] }));
    await finished(generating.events, started.runId);
    const id = started.placeholders[0]!;
    expect(await generating.rpc.call("recipe.read", { project: "board", shapeId: id })).toEqual({
      medium: "image",
      model: "openai/gpt-image-2",
      params: { quality: "high" },
      selectionPrompt: "a lone red fox",
      instruction: "moody",
      references: [],
      sources: ["shape:starter-subject"],
    });

    const sidecar = (await shapeIn(generating, id)).meta.unframed.result.sidecar;
    await rm(join(generating.engine.dataDir, "output", "board", sidecar));
    await expect(generating.rpc.call("recipe.read", { project: "board", shapeId: id })).rejects.toMatchObject({
      code: "not_found",
      message: "This result's recipe is no longer in the project folder.",
    });
    await expect(generating.rpc.call("recipe.read", { project: "board", shapeId: "shape:starter-subject" })).rejects.toMatchObject({ code: "not_found" });
    await generating.engine.dispose();
  });
});
