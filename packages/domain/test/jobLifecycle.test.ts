import { describe, expect, it } from "vitest";
import { copyPendingJobs, dropPendingJobs, failPendingJobs, pendingFor, reassignPendingJobs, type RenderJob } from "../src/index.ts";

const params = { prompt: "a fox", model: "bytedance/seedance-2.0", duration: 5, resolution: null, size: null };

const job = (id: string, overrides: Partial<RenderJob> = {}): RenderJob => ({ id, project: "board", params, startedAt: 1_000, status: "pending", ...overrides });

describe("pending for a project", () => {
  it("answers the pending records of one project, a missing project counting as ''", () => {
    const jobs = [job("a"), job("b", { project: "other" }), job("c", { status: "done" }), job("d", { project: null }), job("e", { project: "" })];
    expect(pendingFor(jobs, "board").map((each) => each.id)).toEqual(["a"]);
    expect(pendingFor(jobs, "").map((each) => each.id)).toEqual(["d", "e"]);
    expect(pendingFor(jobs).map((each) => each.id)).toEqual(["a", "b", "d", "e"]);
  });
});

describe("copying pending records into another store", () => {
  it("merges every pending record by id and names what it copied", () => {
    const from = [job("a"), job("b", { status: "done" }), job("c", { status: "failed", error: "no" }), job("d", { project: "other" })];
    const into = [job("x", { status: "done" }), job("d", { status: "pending", project: "stale" })];
    const copied = copyPendingJobs(from, into);
    expect(copied.copied).toEqual(["a", "d"]);
    expect(copied.jobs.map((each) => [each.id, each.status, each.project])).toEqual([
      ["x", "done", "board"],
      ["d", "pending", "other"],
      ["a", "pending", "board"],
    ]);
  });

  it("copies nothing from a store with nothing pending", () => {
    const into = [job("x")];
    expect(copyPendingJobs([job("b", { status: "done" })], into)).toEqual({ jobs: into, copied: [] });
  });
});

describe("dropping copied records", () => {
  it("drops only the pending records with the given ids", () => {
    const jobs = [job("a"), job("b"), job("c", { status: "done" }), job("d")];
    expect(dropPendingJobs(jobs, ["a", "c", "missing"]).map((each) => each.id)).toEqual(["b", "c", "d"]);
  });
});

describe("failing pending records", () => {
  it("fails every pending record with the error and resolvedAt, leaving done and failed ones alone", () => {
    const jobs = [job("a"), job("b", { project: "other" }), job("c", { status: "done", resolvedAt: 5 }), job("d", { status: "failed", error: "earlier", resolvedAt: 6 })];
    const failed = failPendingJobs(jobs, { error: "stopped", now: 99 });
    expect(failed.failed.map((each) => each.id)).toEqual(["a", "b"]);
    expect(failed.jobs).toEqual([
      job("a", { status: "failed", error: "stopped", resolvedAt: 99 }),
      job("b", { project: "other", status: "failed", error: "stopped", resolvedAt: 99 }),
      jobs[2],
      jobs[3],
    ]);
  });

  it("fails only one project's pending records when given one", () => {
    const jobs = [job("a"), job("b", { project: "other" })];
    const failed = failPendingJobs(jobs, { project: "other", error: "deleted", now: 7 });
    expect(failed.failed.map((each) => each.id)).toEqual(["b"]);
    expect(failed.jobs.map((each) => each.status)).toEqual(["pending", "failed"]);
  });
});

describe("reassigning pending records", () => {
  it("repoints every pending record of a project to another and counts them", () => {
    const jobs = [job("a"), job("b", { status: "done" }), job("c", { project: "other" }), job("d")];
    const moved = reassignPendingJobs(jobs, "board", "renamed");
    expect(moved.moved).toBe(2);
    expect(moved.jobs.map((each) => [each.id, each.project])).toEqual([
      ["a", "renamed"],
      ["b", "board"],
      ["c", "other"],
      ["d", "renamed"],
    ]);
  });
});
