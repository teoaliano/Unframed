import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promptShape } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

const changeLog = (engine: TestEngine, project: string) => {
  const db = new DatabaseSync(join(engine.dataDir, "output", project, "unframed.sqlite"), { readOnly: true });
  try {
    return db
      .prepare("SELECT clock, origin_kind, origin_id, at, put, removed FROM canvas_changes ORDER BY clock")
      .all()
      .map((row) => ({
        clock: Number(row.clock),
        origin: { kind: String(row.origin_kind), id: String(row.origin_id) },
        at: String(row.at),
        put: JSON.parse(String(row.put)) as string[],
        removed: JSON.parse(String(row.removed)) as string[],
      }));
  } finally {
    db.close();
  }
};

describe("the canvas change log", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    await (await engine.rpc()).call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());

  it("records every committed change with its origin: seeding, a tab's session, an engine-side call", async () => {
    const rpc = await engine.rpc();
    const tab = await connectTab(engine.port, "board", { sessionId: "tab-one" });
    await tab.loaded;
    await tab.put([promptShape("from-tab", "500", "typed")]);
    await tab.remove(["shape:from-tab"]);
    await rpc.call("testCanvas.apply", {
      project: "board",
      change: { put: [promptShape("from-run", "501", "placeholder")], remove: [] },
      origin: { kind: "server", id: "run:r1" },
    });
    await tab.close();

    const log = changeLog(engine, "board");
    expect(log[0]).toMatchObject({ origin: { kind: "system", id: "starter" }, put: ["shape:starter-scene", "shape:starter-subject"], removed: [] });
    expect(log.slice(1).map((entry) => ({ origin: entry.origin, put: entry.put, removed: entry.removed }))).toEqual([
      { origin: { kind: "session", id: "tab-one" }, put: ["shape:from-tab"], removed: [] },
      { origin: { kind: "session", id: "tab-one" }, put: [], removed: ["shape:from-tab"] },
      { origin: { kind: "server", id: "run:r1" }, put: ["shape:from-run"], removed: [] },
    ]);
    const clocks = log.map((entry) => entry.clock);
    expect([...clocks].sort((a, b) => a - b)).toEqual(clocks);
    expect(new Set(clocks).size).toBe(clocks.length);
    for (const entry of log) expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
  });

  it("changedSince reports a tab's edit after the clock, and not an engine-side one", async () => {
    const rpc = await engine.rpc();
    const { clock } = await rpc.call("testCanvas.read", { project: "board" });
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    const scene = tab.get("shape:starter-scene")!;
    await tab.put([{ ...scene, x: scene.x + 30 } as typeof scene]);
    await rpc.call("testCanvas.apply", {
      project: "board",
      change: { put: [{ ...tab.get("shape:starter-subject")!, y: 999 }], remove: [] },
      origin: { kind: "server", id: "chat:c1" },
    });
    const { ids } = await rpc.call("testCanvas.changedSince", {
      project: "board",
      recordIds: ["shape:starter-scene", "shape:starter-subject", "shape:never"],
      clock,
    });
    expect(ids).toEqual(["shape:starter-scene"]);

    const { clock: later } = await rpc.call("testCanvas.read", { project: "board" });
    expect(
      (await rpc.call("testCanvas.changedSince", { project: "board", recordIds: ["shape:starter-scene"], clock: later })).ids,
    ).toEqual([]);
    await tab.close();
  });

  it("answers the test methods only when the engine runs with UNFRAMED_TEST_CANVAS", async () => {
    const plain = await startEngine();
    const rpc = await plain.rpc();
    await rpc.call("projects.create", { name: "board" });
    await expect(rpc.call("testCanvas.read", { project: "board" })).rejects.toMatchObject({ code: "unavailable" });
    await plain.dispose();
  });
});
