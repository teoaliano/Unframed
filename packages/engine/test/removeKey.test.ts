import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventually, KEY, pendingRecord, readJobs, roomRecord, startRendering, startRequest } from "./video.ts";

const KEY_REMOVED =
  "Stopped tracking this render: the OpenRouter key was removed, so its progress can no longer be checked. It may still finish upstream, but nothing here will save the result.";

describe("settings.removeKey", () => {
  it("deletes the key line, clears the key live, and fails every pending render in every project", async () => {
    const done = pendingRecord("job-done", { status: "done", resolvedAt: Date.now() - 1000, savedPath: "/x.mp4" });
    const failed = pendingRecord("job-failed", { status: "failed", error: "earlier", resolvedAt: Date.now() - 1000 });
    const rendering = await startRendering({
      dotenv: `# mine\nOPENROUTER_API_KEY=${KEY}\nOPENROUTER_TEXT_MODEL=anthropic/claude-sonnet-5\n`,
      seed: [pendingRecord("job-board"), pendingRecord("job-other", { project: "other" }), done, failed],
    });
    const { engine, rpc } = rendering;
    const started = await rpc.call("video.start", startRequest());
    const updates = rpc.subscribe("settings.subscribe");
    expect((await updates.next()).hasKey).toBe(true);

    const before = Date.now();
    const answer = await rpc.call("settings.removeKey");
    expect(answer.endedRenders).toBe(3);
    expect(answer.renderCleanupError).toBeUndefined();
    expect(answer.settings).toMatchObject({ hasKey: false, keyHint: "", textModel: "anthropic/claude-sonnet-5" });
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("# mine\nOPENROUTER_TEXT_MODEL=anthropic/claude-sonnet-5\n");
    expect((await rpc.call("settings.get")).hasKey).toBe(false);
    await expect.poll(() => updates.values.at(-1)?.hasKey).toBe(false);

    const jobs = await readJobs(rendering);
    for (const id of ["job-board", "job-other", started.jobId]) {
      const job = jobs.find((each) => each.id === id);
      expect(job).toMatchObject({ status: "failed", error: KEY_REMOVED });
      expect(job.resolvedAt).toBeGreaterThanOrEqual(before);
    }
    expect(jobs.find((each) => each.id === "job-done")).toEqual(done);
    expect(jobs.find((each) => each.id === "job-failed")).toEqual(failed);

    // The render's placeholder says why and loses its marker, as every failure path does.
    const placeholder = await eventually(async () => {
      const shape = await roomRecord(rendering, started.shapeId);
      return shape?.meta?.unframed?.runError === undefined ? undefined : shape;
    }, "the placeholder to fail");
    expect(placeholder.meta.unframed.runError).toBe(KEY_REMOVED);
    expect(placeholder.meta.unframed.run).toBeUndefined();

    // A tab still polling learns the render ended, without a key.
    expect(await rpc.call("video.poll", { jobId: started.jobId, project: "board", params: { prompt: "a fox running", model: "bytedance/seedance-2.0", duration: 5, resolution: null, size: null } })).toEqual({
      status: "failed",
      error: KEY_REMOVED,
    });
  });

  it("still removes the key when jobs.json is not valid, and says the renders could not be stopped", async () => {
    const rendering = await startRendering({ seedText: "{ not json" });
    const answer = await rendering.rpc.call("settings.removeKey");
    expect(answer.endedRenders).toBe(0);
    expect(answer.settings.hasKey).toBe(false);
    expect(answer.renderCleanupError).toMatch(
      new RegExp(`^The key was removed, but renders already in progress could not be stopped: The job store at ${join(rendering.output, "jobs.json").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not valid JSON: .+`),
    );
    expect(await readFile(join(rendering.engine.dataDir, ".env"), "utf8")).toBe("");
    expect(await readFile(join(rendering.output, "jobs.json"), "utf8")).toBe("{ not json");
  });

  it("answers the write error and keeps the key live when .env cannot be written", async () => {
    const rendering = await startRendering({ seed: [pendingRecord("job-board")] });
    const envPath = join(rendering.engine.dataDir, ".env");
    await chmod(envPath, 0o000);
    try {
      await expect(rendering.rpc.call("settings.removeKey")).rejects.toMatchObject({
        code: "internal",
        message: expect.stringMatching(/^Could not write \.env: EACCES: permission denied/),
      });
      expect((await rendering.rpc.call("settings.get")).hasKey).toBe(true);
    } finally {
      await chmod(envPath, 0o600);
    }
    expect(await readFile(envPath, "utf8")).toBe(`OPENROUTER_API_KEY=${KEY}\n`);
    expect((await readJobs(rendering))[0].status).toBe("pending");
  });
});
