import { chmod, mkdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./harness.ts";
import { connectTab } from "./syncClient.ts";
import { completedHere, eventually, jobsText, KEY, pendingRecord, readJobs, startRendering } from "./video.ts";

const MOVED_WHILE_REMOVED = "The OpenRouter key was removed while this render was being moved to a new folder.";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const history = () => [
  pendingRecord("job-done", { status: "done", resolvedAt: Date.now() - 1000, savedPath: "/somewhere/x.mp4" }),
  pendingRecord("job-failed", { status: "failed", error: "earlier", resolvedAt: Date.now() - 1000 }),
];

const readStore = async (folder: string) => JSON.parse(await readFile(join(folder, "jobs.json"), "utf8")) as any[];

describe("changing the output folder", () => {
  it("moves pending renders into the new folder's store, leaves history behind, and says how many moved", async () => {
    const rendering = await startRendering({ seed: [pendingRecord("job-a"), pendingRecord("job-b", { project: "other" }), ...history()] });
    const next = join(await makeTempDir(), "renders");
    const answer = await rendering.rpc.call("settings.update", { outputDir: next });
    expect(answer.outputDir).toBe(next);

    expect((await readStore(next)).map((job) => [job.id, job.status, job.project])).toEqual([
      ["job-a", "pending", "board"],
      ["job-b", "pending", "other"],
    ]);
    expect((await readJobs(rendering)).map((job) => [job.id, job.status])).toEqual([
      ["job-done", "done"],
      ["job-failed", "failed"],
    ]);
    await rendering.engine.waitForOutput("  moved 2 pending video job(s) to the new output folder\n");
    expect(await readFile(join(rendering.engine.dataDir, ".env"), "utf8")).toBe(`OPENROUTER_API_KEY=${KEY}\nOUTPUT_DIR=${next}\n`);
  });

  it("lands a moved render once it finishes, in the new folder, and the sweep stops asking about it", async () => {
    const rendering = await startRendering({
      seed: [pendingRecord("job-a")],
      env: { UNFRAMED_TEST_SWEEP_MS: "150" },
      status: (id) => ({ kind: "data", data: { id, status: "in_progress", progress: 5 } }),
    });
    const next = join(await makeTempDir(), "renders");
    await rendering.rpc.call("settings.update", { outputDir: next });
    rendering.jobs.status((id, request) => completedHere(id, request));
    const done = await eventually(async () => (await readStore(next)).find((job) => job.id === "job-a" && job.status === "done"), "the moved render to land");
    expect(done.savedPath.startsWith(join(next, "board"))).toBe(true);
    expect(await readFile(done.savedPath, "utf8")).toBe("clip of job-a");
    const downloads = rendering.jobs.downloads.length;
    const polls = rendering.jobs.polls.length;
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(rendering.jobs.downloads.length).toBe(downloads);
    expect(downloads).toBe(1);
    expect(rendering.jobs.polls.length).toBe(polls);
  });

  it("treats another spelling of the same folder as no move: nothing is copied, stripped or lost", async () => {
    const seed = [pendingRecord("job-a"), ...history()];
    const rendering = await startRendering({ seed });
    const before = await jobsText(rendering);
    const alias = join(await makeTempDir(), "alias");
    await symlink(rendering.output, alias);
    const answer = await rendering.rpc.call("settings.update", { outputDir: alias });
    expect(answer.outputDir).toBe(alias);
    expect(await jobsText(rendering)).toBe(before);
    expect(rendering.engine.stdout()).not.toContain("pending video job(s)");
    expect((await rendering.rpc.call("projects.list")).projects).toEqual(["board"]);
  });

  it("refuses the change when the old job store is not valid, and leaves .env as it was", async () => {
    const rendering = await startRendering({ seedText: "[{ broken" });
    const next = join(await makeTempDir(), "renders");
    await expect(rendering.rpc.call("settings.update", { outputDir: next })).rejects.toMatchObject({
      code: "internal",
      message: expect.stringMatching(
        new RegExp(`^Could not move the renders already in progress to that folder, so the folder was not changed: The job store at ${escape(join(rendering.output, "jobs.json"))} is not valid JSON: .+`),
      ),
    });
    expect(await readFile(join(rendering.engine.dataDir, ".env"), "utf8")).toBe(`OPENROUTER_API_KEY=${KEY}\n`);
    expect((await rendering.rpc.call("settings.get")).outputDir).toBe(rendering.output);
  });

  it("rolls the copies out of the new store when .env cannot be written, and leaves the old store as it was", async () => {
    const rendering = await startRendering({ seed: [pendingRecord("job-a"), ...history()] });
    const before = await jobsText(rendering);
    const next = join(await makeTempDir(), "renders");
    const envPath = join(rendering.engine.dataDir, ".env");
    await chmod(envPath, 0o000);
    try {
      await expect(rendering.rpc.call("settings.update", { outputDir: next })).rejects.toMatchObject({
        code: "internal",
        message: expect.stringMatching(/^Could not write \.env: EACCES/),
      });
    } finally {
      await chmod(envPath, 0o600);
    }
    expect((await readStore(next).catch(() => [])).map((job) => job.id)).toEqual([]);
    expect(await jobsText(rendering)).toBe(before);
    expect((await rendering.rpc.call("settings.get")).outputDir).toBe(rendering.output);
  });

  it("closes every open project first: an open canvas and an open chat subscription end, and the list reads the new folder", async () => {
    const rendering = await startRendering();
    const tab = await connectTab(rendering.engine.port, "board");
    await tab.loaded;
    const shell = rendering.rpc.subscribe("orchestration.subscribeShell", { projectId: "board" });
    await shell.next(0);

    const next = join(await makeTempDir(), "renders");
    await mkdir(join(next, "elsewhere"), { recursive: true });
    await rendering.rpc.call("settings.update", { outputDir: next });
    expect((await tab.closed()).code).toBe(1012);
    await shell.ended();
    expect((await rendering.rpc.call("projects.list")).projects).toEqual(["elsewhere"]);
  });

  it("fails the moved copies in the new store when there is no key, and strips them from the old one", async () => {
    const rendering = await startRendering({ key: false, seed: [pendingRecord("job-a"), ...history()] });
    const next = join(await makeTempDir(), "renders");
    await rendering.rpc.call("settings.update", { outputDir: next });
    const moved = await readStore(next);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ id: "job-a", status: "failed", error: MOVED_WHILE_REMOVED });
    expect(typeof moved[0].resolvedAt).toBe("number");
    expect((await readJobs(rendering)).map((job) => job.id)).toEqual(["job-done", "job-failed"]);
  });
});
