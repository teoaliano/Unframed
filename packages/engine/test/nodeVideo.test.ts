import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { describe, expect, it } from "vitest";
import { pngBytes } from "./generation.ts";
import { nodeShape, wireShape } from "./nodeRecords.ts";
import { imageGeneration } from "./openRouterStub.ts";
import { MODEL, startRendering } from "./video.ts";
import { completed } from "./videoStub.ts";

const wait = async (check: () => Promise<boolean>, what: string, timeout = 15_000) => {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

describe("a video step in a chain", () => {
  it("is a durable render: the next step waits for its clip, the version fills from the sweep, and the job names its node", async () => {
    const images = imageGeneration(() => ({ kind: "image", bytes: pngBytes(8, 8) }));
    const rendering = await startRendering({ env: { UNFRAMED_TEST_SWEEP_MS: "150" }, extra: [images.handler] });
    let done = false;
    rendering.jobs.status((id) => (done ? completed(rendering.stubOrigin, id) : { kind: "data", data: { id, status: "in_progress", progress: 40 } }));
    const put: TLRecord[] = [
      nodeShape("clip", "201", { medium: "video", model: MODEL, instruction: "a fox running", params: { duration: 5 } }, { y: 0 }),
      nodeShape("still", "202", { medium: "image", instruction: "a poster from it" }, { y: 500 }),
      wireShape("w", "clip", "still", "reference"),
    ];
    await rendering.rpc.call("testCanvas.apply", { project: "board", change: { put, remove: [] }, origin: { kind: "system", id: "seed" } });
    const started = await rendering.rpc.call("chain.run", { project: "board", shapeIds: ["shape:clip", "shape:still"] });
    expect(started.nodes).toEqual(["shape:clip", "shape:still"]);
    const node = async (id: string) => ((await rendering.rpc.call("testCanvas.read", { project: "board" })).records as any[]).find((record) => record.id === id);
    await wait(async () => (await node("shape:clip"))?.props.versions.length === 1, "the running clip version");
    const running = await node("shape:clip");
    expect(running.props.versions[0]).toMatchObject({ status: "running", durable: true });
    const jobs = JSON.parse(await readFile(join(rendering.output, "jobs.json"), "utf8")) as any[];
    expect(jobs[0]).toMatchObject({ status: "pending", target: { shapeId: "shape:clip", versionId: running.props.versions[0].id, chainId: started.chainId, step: 1 } });
    expect(jobs[0].landing).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(images.requests).toEqual([]);
    expect((await node("shape:still")).props.run).toMatchObject({ runId: "", chainId: started.chainId });

    done = true;
    await wait(async () => (await node("shape:still"))?.props.currentVersionId !== null, "the image step after the clip");
    const clip = await node("shape:clip");
    expect(clip.props.versions[0]).toMatchObject({ status: "done", file: expect.stringMatching(/\.mp4$/) });
    expect(clip.props.currentVersionId).toBe(clip.props.versions[0].id);
    expect(images.requests).toHaveLength(1);
    const sidecar = JSON.parse(await readFile(join(rendering.folder, clip.props.versions[0].file.replace(/\.mp4$/, ".json")), "utf8"));
    expect(sidecar).toMatchObject({ kind: "video", node: { shapeId: "shape:clip", versionId: clip.props.versions[0].id }, chain: { chainId: started.chainId, step: 1 } });
    expect(((await rendering.rpc.call("testCanvas.read", { project: "board" })).records as any[]).filter((record) => record.type === "video")).toEqual([]);
    await rendering.engine.dispose();
  });
});
