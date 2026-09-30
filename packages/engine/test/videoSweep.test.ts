import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gate } from "./openRouterStub.ts";
import { completedHere, eventually, jobsText, pendingRecord, readJobs, recipe, roomShapes, startRendering, startRequest } from "./video.ts";

const HOUR = 60 * 60 * 1000;

const fast = { UNFRAMED_TEST_SWEEP_MS: "150" };

describe("the sweep", () => {
  it("collects a seeded pending job at boot with no client connected", async () => {
    const rendering = await startRendering({
      seed: [pendingRecord("gen-boot", { landing: { x: 600, y: 40, w: 320, h: 180 }, recipe: recipe() })],
      status: (id, request) => completedHere(id, request),
    });
    const [job] = await eventually(async () => {
      const jobs = await readJobs(rendering);
      return jobs[0]?.status === "done" ? jobs : undefined;
    }, "the boot sweep to collect");
    expect(job.savedPath).toMatch(/-a-seeded-render\.mp4$/);
    expect((await readFile(job.savedPath, "utf8"))).toBe("clip of gen-boot");
    await rendering.engine.waitForOutput(`  video job gen-boot collected by the sweep → ${job.savedPath}`);
    expect((await roomShapes(rendering)).find((shape) => shape.type === "video")).toMatchObject({ x: 600, y: 40 });
  });

  it("fails a seeded job on a terminal status with the provider's message", async () => {
    const rendering = await startRendering({
      seed: [pendingRecord("gen-bad")],
      status: (id) => ({ kind: "data", data: { id, status: "failed", error: { message: "OutputVideoSensitiveContentDetected" } } }),
    });
    const [job] = await eventually(async () => {
      const jobs = await readJobs(rendering);
      return jobs[0]?.status === "failed" ? jobs : undefined;
    }, "the boot sweep to fail it");
    expect(job).toMatchObject({ status: "failed", error: "OutputVideoSensitiveContentDetected", resolvedAt: expect.any(Number) });
  });

  it("stamps unreachableSince on the first miss and leaves the store byte-identical on the next ones", async () => {
    const rendering = await startRendering({ env: fast, seed: [pendingRecord("gen-miss")], status: () => ({ kind: "status", status: 503, body: { error: "busy" } }) });
    const stamped = await eventually(async () => {
      const jobs = await readJobs(rendering);
      return typeof jobs[0]?.unreachableSince === "number" ? jobs[0] : undefined;
    }, "the first miss to be stamped");
    expect(stamped.status).toBe("pending");
    const text = await jobsText(rendering);
    const asked = rendering.jobs.polls.length;
    await eventually(async () => rendering.jobs.polls.length >= asked + 3, "three more sweeps");
    expect(await jobsText(rendering)).toBe(text);
  });

  it("clears unreachableSince when upstream answers queued", async () => {
    const rendering = await startRendering({
      seed: [pendingRecord("gen-back", { unreachableSince: Date.now() - HOUR })],
      status: (id) => ({ kind: "data", data: { id, status: "queued" } }),
    });
    const [job] = await eventually(async () => {
      const jobs = await readJobs(rendering);
      return jobs[0] && !("unreachableSince" in jobs[0]) ? jobs : undefined;
    }, "the stamp to clear");
    expect(job.status).toBe("pending");
    expect(await jobsText(rendering)).not.toContain("unreachableSince");
  });

  it("fails a job 25 hours unreachable with the give-up message, stamps one never stamped, and leaves a done one alone", async () => {
    const done = pendingRecord("gen-done", { status: "done", savedPath: "/x/board/a.mp4", cost: 1, resolvedAt: Date.now() });
    const rendering = await startRendering({
      seed: [pendingRecord("gen-lost", { unreachableSince: Date.now() - 25 * HOUR }), pendingRecord("gen-new"), done],
      status: () => ({ kind: "hangup" }),
    });
    const jobs = await eventually(async () => {
      const read = await readJobs(rendering);
      return read.find((job) => job.id === "gen-lost")?.status === "failed" && typeof read.find((job) => job.id === "gen-new")?.unreachableSince === "number" ? read : undefined;
    }, "the sweep to give up on one and stamp the other");
    const lost = jobs.find((job) => job.id === "gen-lost")!;
    expect(lost.error).toMatch(/^Stopped checking after 24 hours with no answer about this render\. The last attempt said: could not read the status answer: .+/);
    const why = lost.error.slice("Stopped checking after 24 hours with no answer about this render. The last attempt said: ".length);
    await rendering.engine.waitForOutput(`  video job gen-lost gave up: unreachable for 24h (${why})`);
    expect(jobs.find((job) => job.id === "gen-new")!.status).toBe("pending");
    expect(jobs.find((job) => job.id === "gen-done")).toEqual(done);
    expect(rendering.jobs.polls.map((poll) => poll.path)).not.toContain("/api/v1/videos/gen-done");
  });

  it("does nothing without a key", async () => {
    const rendering = await startRendering({ key: false, env: fast, seed: [pendingRecord("gen-idle")] });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(rendering.jobs.polls).toEqual([]);
  });
});

describe("the job store", () => {
  it("does not stop boot when jobs.json is corrupt; the sweep reads it as empty and the next write starts over", async () => {
    const rendering = await startRendering({ env: fast, seedText: '[{"id": "half' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(rendering.jobs.polls).toEqual([]);
    rendering.jobs.create(() => ({ kind: "job", id: "gen-fresh" }));
    await rendering.rpc.call("video.start", startRequest());
    expect((await readJobs(rendering)).map((job) => job.id)).toEqual(["gen-fresh"]);
  });

  it("keeps both of two jobs completing at the same moment, and leaves no temp file", async () => {
    const rendering = await startRendering({ seed: [pendingRecord("gen-a"), pendingRecord("gen-b", { params: { prompt: "another", model: "m/x", duration: null, resolution: null, size: null } })] });
    rendering.jobs.status((id, request) => completedHere(id, request));
    const params = { prompt: "p", model: "m/x", duration: null, resolution: null, size: null };
    await Promise.all(["gen-a", "gen-b"].map((jobId) => rendering.rpc.call("video.poll", { jobId, project: "board", params }).catch(() => undefined)));
    const jobs = await eventually(async () => {
      const read = await readJobs(rendering);
      return read.every((job) => job.status === "done") ? read : undefined;
    }, "both jobs to be done");
    expect(jobs.map((job) => job.id).sort()).toEqual(["gen-a", "gen-b"]);
    expect((await readdir(rendering.output)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("downloads a clip held longer than the sweep interval once, and a poll meanwhile answers pending", async () => {
    const held = gate<void>();
    const rendering = await startRendering({ env: fast, seed: [pendingRecord("gen-slow")], status: (id, request) => completedHere(id, request) });
    rendering.jobs.clip(async (id) => {
      await held.promise;
      return Buffer.from(`slow clip of ${id}`);
    });
    await eventually(async () => rendering.jobs.downloads.length === 1, "the download to start");
    const params = { prompt: "a seeded render", model: "bytedance/seedance-2.0", duration: 5, resolution: null, size: null };
    expect(await rendering.rpc.call("video.poll", { jobId: "gen-slow", project: "board", params })).toEqual({ status: "pending", progress: null });
    // Several intervals pass: the sweep that is downloading is still running, so no tick overlaps it.
    const asked = rendering.jobs.polls.length;
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(rendering.jobs.polls).toHaveLength(asked);
    expect(rendering.jobs.downloads).toHaveLength(1);
    held.release();
    await eventually(async () => (await readJobs(rendering))[0]?.status === "done", "the collection");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(rendering.jobs.downloads).toHaveLength(1);
    expect((await readdir(rendering.folder)).filter((name) => name.endsWith(".mp4"))).toHaveLength(1);
  });

  it("sends the clip to the project a record was moved to during a held download, and records that project", async () => {
    const held = gate<void>();
    const rendering = await startRendering({ seed: [pendingRecord("gen-moved")], status: (id, request) => completedHere(id, request) });
    rendering.jobs.clip(async () => {
      await held.promise;
      return Buffer.from("moved clip");
    });
    await eventually(async () => rendering.jobs.downloads.length === 1, "the download to start");
    // Spec 10 repoints a renamed project's pending records while the clip is on its way.
    const renamed = join(rendering.output, "renamed");
    await mkdir(renamed, { recursive: true });
    const jobs = await readJobs(rendering);
    const temp = join(rendering.output, "jobs.json.test.tmp");
    await writeFile(temp, JSON.stringify(jobs.map((job) => ({ ...job, project: "renamed" })), null, 2));
    await rename(temp, join(rendering.output, "jobs.json"));
    held.release();
    const [job] = await eventually(async () => {
      const read = await readJobs(rendering);
      return read[0]?.status === "done" ? read : undefined;
    }, "the collection");
    expect(job.project).toBe("renamed");
    expect(job.savedPath.startsWith(`${renamed}/`)).toBe(true);
    expect(await readFile(job.savedPath, "utf8")).toBe("moved clip");
    expect((await readdir(rendering.folder)).filter((name) => name.endsWith(".mp4"))).toEqual([]);
  });
});
