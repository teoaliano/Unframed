import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gate } from "./openRouterStub.ts";
import { connectTab } from "./syncClient.ts";
import { completedHere, eventually, jobsText, pendingRecord, readJobs, shareCopies, startRendering, startRequest } from "./video.ts";

const PROJECT_DELETED =
  "Stopped tracking this render: the project it belonged to was deleted. It may still finish upstream, but nothing here will save the result.";

const CLIP = Buffer.concat([Buffer.from("\x00\x00\x00\x18ftypmp42"), Buffer.alloc(1024, 7)]);
const videoRef = (url: string) => ({ type: "video_url", video_url: { url } });

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("invalid job stores", () => {
  it("refuse a rename and a delete with their own messages, and change nothing", async () => {
    const rendering = await startRendering({ seedText: "[{ broken" });
    const store = escape(join(rendering.output, "jobs.json"));
    await expect(rendering.rpc.call("projects.rename", { name: "board", to: "renamed" })).rejects.toMatchObject({
      code: "internal",
      message: expect.stringMatching(new RegExp(`^Could not update the renders in progress for this project, so it was not renamed: The job store at ${store} is not valid JSON: .+`)),
    });
    await expect(rendering.rpc.call("projects.delete", { name: "board", confirmRenders: true })).rejects.toMatchObject({
      code: "internal",
      message: expect.stringMatching(new RegExp(`^Could not check whether this project has renders in progress, so nothing was deleted: The job store at ${store} is not valid JSON: .+`)),
    });
    await writeFile(join(rendering.output, "jobs.json"), '{"not":"a list"}');
    await expect(rendering.rpc.call("projects.delete", { name: "board" })).rejects.toMatchObject({
      message: `Could not check whether this project has renders in progress, so nothing was deleted: The job store at ${join(rendering.output, "jobs.json")} is not a list of jobs.`,
    });
    expect((await rendering.rpc.call("projects.list")).projects).toEqual(["board"]);
    expect(existsSync(rendering.folder)).toBe(true);
  });
});

describe("projects.rename", () => {
  it("renames the folder, repoints pending renders to the new slug, and ends open connections to the project", async () => {
    const rendering = await startRendering({
      seed: [pendingRecord("job-a"), pendingRecord("job-b"), pendingRecord("job-c", { project: "other" }), pendingRecord("job-d", { status: "done", resolvedAt: Date.now() })],
    });
    const tab = await connectTab(rendering.engine.port, "board");
    await tab.loaded;
    const shell = rendering.rpc.subscribe("orchestration.subscribeShell", { projectId: "board" });
    await shell.next(0);

    const answer = await rendering.rpc.call("projects.rename", { name: "board", to: "Product Shots!" });
    expect(answer).toEqual({ name: "product-shots", movedRenders: 2 });
    expect((await tab.closed()).code).toBe(1012);
    await shell.ended();
    expect((await rendering.rpc.call("projects.list")).projects).toEqual(["product-shots"]);
    expect(existsSync(join(rendering.output, "product-shots", "unframed.sqlite"))).toBe(true);
    expect((await readJobs(rendering)).map((job) => [job.id, job.project])).toEqual([
      ["job-a", "product-shots"],
      ["job-b", "product-shots"],
      ["job-c", "other"],
      ["job-d", "board"],
    ]);
    // The canvas opens again under the new name.
    const again = await connectTab(rendering.engine.port, "product-shots");
    await again.loaded;
    await again.close();
  });

  it("lands a render that finishes after the rename in the renamed folder, once", async () => {
    const rendering = await startRendering({
      seed: [pendingRecord("job-a")],
      env: { UNFRAMED_TEST_SWEEP_MS: "150" },
      status: (id) => ({ kind: "data", data: { id, status: "in_progress", progress: 5 } }),
    });
    await rendering.rpc.call("projects.rename", { name: "board", to: "renamed" });
    rendering.jobs.status((id, request) => completedHere(id, request));
    const done = await eventually(async () => (await readJobs(rendering)).find((job) => job.status === "done"), "the render to land");
    expect(done).toMatchObject({ id: "job-a", project: "renamed" });
    expect(done.savedPath.startsWith(join(rendering.output, "renamed"))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(rendering.jobs.downloads).toHaveLength(1);
    expect(existsSync(rendering.folder)).toBe(false);
  });

  it("refuses an empty target and one that already exists", async () => {
    const rendering = await startRendering();
    await rendering.rpc.call("projects.create", { name: "taken" });
    await expect(rendering.rpc.call("projects.rename", { name: "board", to: " !! " })).rejects.toMatchObject({ code: "bad_request", message: "New name is empty." });
    await expect(rendering.rpc.call("projects.rename", { name: "board", to: "Taken" })).rejects.toMatchObject({ code: "conflict", message: 'A project named "taken" already exists.' });
    expect((await rendering.rpc.call("projects.list")).projects).toEqual(["board", "taken"]);
  });

  it("puts the render records back when the folder cannot be renamed", async () => {
    const rendering = await startRendering({ seed: [pendingRecord("job-a", { project: "gone" }), pendingRecord("job-b")] });
    const before = await jobsText(rendering);
    await expect(rendering.rpc.call("projects.rename", { name: "gone", to: "found" })).rejects.toMatchObject({
      code: "internal",
      message: expect.stringMatching(/^Could not rename: ENOENT: no such file or directory, rename /),
    });
    expect((await readJobs(rendering)).map((job) => [job.id, job.project])).toEqual(JSON.parse(before).map((job: any) => [job.id, job.project]));
    expect((await rendering.rpc.call("projects.list")).projects).toEqual(["board"]);
  });
});

describe("projects.delete", () => {
  it("refuses while renders are in progress unless confirmed, and changes nothing", async () => {
    const rendering = await startRendering({ seed: [pendingRecord("job-a"), pendingRecord("job-b"), pendingRecord("job-c", { project: "other" })] });
    const before = await jobsText(rendering);
    await expect(rendering.rpc.call("projects.delete", { name: "Board" })).rejects.toMatchObject({
      code: "conflict",
      message: "This project has 2 video renders in progress.",
      details: { pendingRenders: 2 },
    });
    await expect(rendering.rpc.call("projects.delete", { name: "board", confirmRenders: false })).rejects.toMatchObject({ details: { pendingRenders: 2 } });
    expect(await jobsText(rendering)).toBe(before);
    expect(existsSync(rendering.folder)).toBe(true);
  });

  it("says render in the singular for one", async () => {
    const rendering = await startRendering({ seed: [pendingRecord("job-a")] });
    await expect(rendering.rpc.call("projects.delete", { name: "board" })).rejects.toMatchObject({ message: "This project has 1 video render in progress." });
  });

  it("deletes a project with nothing in progress without asking", async () => {
    const rendering = await startRendering();
    await rendering.rpc.call("projects.create", { name: "spare" });
    expect(await rendering.rpc.call("projects.delete", { name: "spare" })).toEqual({ endedRenders: 0 });
    expect((await rendering.rpc.call("projects.list")).projects).toEqual(["board"]);
  });

  it("confirmed, fails only that project's pending renders, revokes their share links, removes the folder, and the sweep stops asking", async () => {
    const rendering = await startRendering({
      files: { "clip.mp4": CLIP },
      seed: [pendingRecord("job-other", { project: "other" })],
      env: { UNFRAMED_TEST_SWEEP_MS: "150" },
      status: (id) => ({ kind: "data", data: { id, status: "in_progress", progress: 5 } }),
    });
    const tab = await connectTab(rendering.engine.port, "board");
    await tab.loaded;
    const started = await rendering.rpc.call("video.start", startRequest({ input_references: [videoRef("project-file:clip.mp4")], shareLocalVideos: true }));
    expect(await shareCopies(rendering)).toHaveLength(1);
    const shared = rendering.jobs.creates[0]!.body.input_references[0].video_url.url as string;
    expect((await fetch(shared)).status).toBe(200);

    const before = Date.now();
    expect(await rendering.rpc.call("projects.delete", { name: "board", confirmRenders: true })).toEqual({ endedRenders: 1 });
    expect(existsSync(rendering.folder)).toBe(false);
    expect((await rendering.rpc.call("projects.list")).projects).toEqual([]);
    expect((await tab.closed()).code).toBe(1012);
    const jobs = await readJobs(rendering);
    expect(jobs.find((job) => job.id === started.jobId)).toMatchObject({ status: "failed", error: PROJECT_DELETED });
    expect(jobs.find((job) => job.id === started.jobId).resolvedAt).toBeGreaterThanOrEqual(before);
    expect(jobs.find((job) => job.id === "job-other")).toMatchObject({ status: "pending", project: "other" });
    expect(await shareCopies(rendering)).toEqual([]);
    expect((await fetch(shared)).status).toBe(404);

    // The sweep may have polled before the delete, and a poll it sent just before may still
    // land, so count from two sweep intervals after it.
    const pollsOfJob = () => rendering.jobs.polls.filter((request) => request.path.endsWith(started.jobId)).length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const polledBefore = pollsOfJob();

    // Even once upstream says it finished, nothing collects it or recreates the folder.
    rendering.jobs.status((id, request) => completedHere(id, request));
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(rendering.jobs.downloads.map((request) => request.path)).not.toContain(`/files/${started.jobId}.mp4`);
    expect(pollsOfJob()).toBe(polledBefore);
    expect(existsSync(rendering.folder)).toBe(false);
  });

  it("keeps a render failed and its folder gone when the delete lands during the clip's download", async () => {
    const rendering = await startRendering({
      seed: [pendingRecord("job-a")],
      env: { UNFRAMED_TEST_SWEEP_MS: "150" },
      status: (id, request) => completedHere(id, request),
    });
    const download = gate<void>();
    rendering.jobs.clip(async (id) => {
      await download.promise;
      return Buffer.from(`clip of ${id}`);
    });
    await eventually(async () => rendering.jobs.downloads.length > 0, "the sweep to start the download");
    expect(await rendering.rpc.call("projects.delete", { name: "board", confirmRenders: true })).toEqual({ endedRenders: 1 });
    download.release();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(existsSync(rendering.folder)).toBe(false);
    expect((await readJobs(rendering))[0]).toMatchObject({ id: "job-a", status: "failed", error: PROJECT_DELETED });
  });

  it("says the renders were stopped but the folder remains when removal fails, and a retry succeeds", async () => {
    const rendering = await startRendering({ seed: [pendingRecord("job-a")] });
    const locked = join(rendering.folder, "locked");
    await mkdir(locked);
    await writeFile(join(locked, "keep.png"), "x");
    await chmod(locked, 0o555);
    try {
      await expect(rendering.rpc.call("projects.delete", { name: "board", confirmRenders: true })).rejects.toMatchObject({
        code: "internal",
        message: expect.stringMatching(/^Stopped 1 render\(s\), but the project folder could not be deleted: EACCES: .+\. Deleting again is safe\.$/),
      });
      expect((await readJobs(rendering))[0]).toMatchObject({ status: "failed", error: PROJECT_DELETED });
      expect(existsSync(rendering.folder)).toBe(true);
    } finally {
      await chmod(locked, 0o755);
    }
    expect(await rendering.rpc.call("projects.delete", { name: "board" })).toEqual({ endedRenders: 0 });
    expect(await readdir(rendering.output)).toEqual(["jobs.json"]);
  });

  it("names the failure plainly when nothing was stopped", async () => {
    const rendering = await startRendering();
    const locked = join(rendering.folder, "locked");
    await mkdir(locked);
    await writeFile(join(locked, "keep.png"), "x");
    await chmod(locked, 0o555);
    try {
      await expect(rendering.rpc.call("projects.delete", { name: "board" })).rejects.toMatchObject({
        code: "internal",
        message: expect.stringMatching(/^Could not delete the project: EACCES: /),
      });
    } finally {
      await chmod(locked, 0o755);
    }
  });
});
