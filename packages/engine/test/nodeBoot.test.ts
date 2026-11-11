import type { TLRecord } from "@tldraw/tlschema";
import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";
import { nodeShape } from "./nodeRecords.ts";

const version = (id: string, extra: Record<string, unknown> = {}) => ({ id, runId: `run-${id}`, chainId: null, batchId: "b", runIndex: 1, status: "running", fingerprint: "f", createdAt: "2026-11-05T00:00:00.000Z", ...extra });

describe("node work across a restart", () => {
  it("removes a running version with no live run, leaves a durable one to the job store, and stops a queued chain step", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    const put: TLRecord[] = [
      nodeShape("lost", "101", { versions: [version("v1"), { ...version("v0"), status: "done", file: "old.png" }], currentVersionId: "v0", run: { runId: "run-v1", chainId: null, startedAt: 1 } }),
      nodeShape("render", "102", { medium: "video", versions: [version("v2", { durable: true, runId: "job-1" })], run: { runId: "job-1", chainId: null, startedAt: 1 } }),
      nodeShape("queued", "103", { run: { runId: "", chainId: "chain-1", startedAt: 1 } }),
    ];
    await rpc.call("testCanvas.apply", { project: "board", change: { put, remove: [] }, origin: { kind: "system", id: "seed" } });
    await engine.stop();
    const again = await startEngine({ dataDir: engine.dataDir, env: { UNFRAMED_TEST_CANVAS: "1" } });
    const records = ((await (await again.rpc()).call("testCanvas.read", { project: "board" })).records as any[]).filter((record) => record.type === "node");
    const byId = Object.fromEntries(records.map((record) => [record.id, record.props]));
    expect(byId["shape:lost"].versions.map((each: any) => each.id)).toEqual(["v0"]);
    expect(byId["shape:lost"].run).toBeUndefined();
    expect(byId["shape:lost"].currentVersionId).toBe("v0");
    expect(byId["shape:render"].versions.map((each: any) => each.status)).toEqual(["running"]);
    expect(byId["shape:render"].run).toEqual({ runId: "job-1", chainId: null, startedAt: 1 });
    expect(byId["shape:queued"].run).toBeUndefined();
    expect(byId["shape:queued"].error).toBe("Stopped: the engine restarted before this step ran.");
  });
});
