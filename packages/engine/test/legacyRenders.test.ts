import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routes } from "./openRouterStub.ts";
import { byRef, canvasRecords, legacyDataDir, startLegacyEngine, type AnyRecord } from "./legacy.ts";
import { completedHere, eventually, KEY } from "./video.ts";
import { videoJobs } from "./videoStub.ts";

const PENDING = "vid_2f8c1e7a9b";

/** An engine over the samples with a key and scripted video endpoints: every job stays in flight until `finish` names it. */
const startRenders = async (options: { readonly dataDir?: string; readonly finished?: ReadonlyArray<string> } = {}) => {
  const jobs = videoJobs();
  const finished = new Set(options.finished ?? []);
  jobs.status((id, request) => (finished.has(id) ? completedHere(id, request) : { kind: "data", data: { id, status: "in_progress", progress: 40 } }));
  const legacy = await startLegacyEngine({
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    dotenv: `OPENROUTER_API_KEY=${KEY}\n`,
    env: { UNFRAMED_TEST_SWEEP_MS: "200" },
    stub: routes(jobs.handler),
  });
  return { ...legacy, jobs, finish: (id: string) => finished.add(id) };
};

const marked = (records: ReadonlyArray<AnyRecord>, jobId: string) => records.find((record) => record.meta?.unframed?.run?.runId === jobId);

describe("a render in flight in the old app", () => {
  it("is a render placeholder after the import, and lands in it when the sweep finishes the job", async () => {
    const { engine, jobs, finish } = await startRenders();
    const records = await canvasRecords(engine, "everything");
    const placeholder = marked(records, PENDING)!;
    expect(placeholder).toMatchObject({
      type: "video",
      x: 440,
      y: 1900,
      props: { assetId: null },
      meta: { unframed: { run: { runId: PENDING, runIndex: 1, durable: { params: { prompt: "Slow push-in toward the cliff at dusk" } } }, result: { sidecar: null, medium: "video" } } },
    });
    // The room's own resolution leaves a pending job's placeholder alone.
    await eventually(async () => jobs.polls.some((poll) => poll.path.endsWith(PENDING)), "the sweep to ask about the job");
    expect(marked(await canvasRecords(engine, "everything"), PENDING)).toBeDefined();

    finish(PENDING);
    const filled = await eventually(async () => {
      const shape = (await canvasRecords(engine, "everything")).find((record) => record.id === placeholder.id);
      return shape?.props.assetId ? shape : undefined;
    }, "the sweep to land the clip");
    expect(filled).toMatchObject({ x: 440, y: 1900 });
    expect(filled.meta.unframed.run).toBeUndefined();
    expect(filled.meta.unframed.result.sidecar).toMatch(/-slow-push-in-toward-the-cliff-at-dusk\.json$/);
    const asset = (await canvasRecords(engine, "everything")).find((record) => record.id === filled.props.assetId)!;
    expect(asset.props.src).toMatch(/^project-file:.*-slow-push-in-toward-the-cliff-at-dusk\.mp4$/);
  });

  it("lands once when the sweep finishes it before the project is ever opened", async () => {
    const { engine, outputDir } = await startRenders({ finished: [PENDING] });
    await eventually(async () => {
      const store = JSON.parse(await readFile(join(outputDir, "jobs.json"), "utf8")) as Array<{ id: string; status: string }>;
      return store.find((job) => job.id === PENDING)?.status === "done";
    }, "the boot sweep to collect");
    const records = await eventually(async () => {
      const all = await canvasRecords(engine, "everything");
      return all.some((record) => record.typeName === "asset" && /slow-push-in/.test(String(record.props.src))) ? all : undefined;
    }, "the clip on the canvas");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const clips = (await canvasRecords(engine, "everything")).filter((record) => record.typeName === "asset" && /slow-push-in/.test(String(record.props.src)));
    expect(clips).toHaveLength(1);
    expect(marked(records, PENDING)).toBeUndefined();
  });
});

describe("an unreadable jobs.json", () => {
  it("does not fail the import: every job reads as unknown", async () => {
    const dataDir = await legacyDataDir();
    await writeFile(join(dataDir, "output", "jobs.json"), "[{ this is not json");
    const { engine } = await startLegacyEngine({ dataDir });
    const records = await canvasRecords(engine, "everything");
    expect(byRef(records, "100")).toBeDefined();
    expect(marked(records, PENDING)).toBeUndefined();
    const report = await (await engine.rpc()).call("legacyImport.report", { project: "everything" });
    const notKept = report!.items.filter((item) => item.section === "notKept").map((item) => item.text);
    expect(notKept).toContain("@163 was waiting for a render the job store no longer knows about. Nothing was resumed.");
    expect(notKept).toContain("@131 was waiting for a render the job store no longer knows about. Nothing was resumed.");
  });
});
