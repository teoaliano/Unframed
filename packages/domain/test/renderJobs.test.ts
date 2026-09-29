import { describe, expect, it } from "vitest";
import { classifyVideoStatus, givenUp, mergeJob, parseJobsLenient, parseJobsStrict, pendingFor, pruneJobs, upsertJob, type RenderJob } from "../src/index.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const params = { prompt: "a fox", model: "bytedance/seedance-2.0", duration: 5, resolution: null, size: null };

const job = (id: string, overrides: Partial<RenderJob> = {}): RenderJob => ({ id, project: "board", params, startedAt: 1_000, status: "pending", ...overrides });

describe("upsert", () => {
  it("replaces the record with the same id, else appends", () => {
    const jobs = [job("a"), job("b")];
    expect(upsertJob(jobs, job("b", { status: "done" })).map((each) => [each.id, each.status])).toEqual([
      ["a", "pending"],
      ["b", "done"],
    ]);
    expect(upsertJob(jobs, job("c")).map((each) => each.id)).toEqual(["a", "b", "c"]);
    expect(jobs.map((each) => each.status)).toEqual(["pending", "pending"]);
  });
});

describe("merge", () => {
  it("lays the patch over the record and keeps its id and first start", () => {
    expect(mergeJob(job("a", { startedAt: 5 }), { id: "a", status: "done", cost: 0.4 }, 99)).toEqual({ ...job("a", { startedAt: 5 }), status: "done", cost: 0.4 });
  });

  it("stamps startedAt now for a record it has never seen", () => {
    expect(mergeJob(undefined, { id: "new", project: "p", status: "pending" }, 1234)).toEqual({ id: "new", project: "p", status: "pending", startedAt: 1234 });
  });

  it("removes a key the patch sets to undefined", () => {
    const merged = mergeJob(job("a", { unreachableSince: 50 }), { id: "a", unreachableSince: undefined }, 99);
    expect("unreachableSince" in merged).toBe(false);
    expect(JSON.stringify(merged)).not.toContain("unreachableSince");
  });

  it("never lets a patch change the id", () => {
    expect(mergeJob(job("a"), { id: "a", ...({ id: "b" } as object) }, 1).id).toBe("a");
  });
});

describe("prune", () => {
  const now = 100 * DAY;
  it.each([
    ["a pending record, however old", job("p", { startedAt: 0 }), true],
    ["a done record resolved under 7 days ago", job("d", { status: "done", startedAt: 0, resolvedAt: now - 7 * DAY + 1 }), true],
    ["a done record resolved 7 days ago", job("d", { status: "done", startedAt: 0, resolvedAt: now - 7 * DAY }), false],
    ["a failed record resolved 8 days ago", job("f", { status: "failed", resolvedAt: now - 8 * DAY }), false],
    ["a render that sat pending a week and resolved now", job("slow", { status: "done", startedAt: now - 8 * DAY, resolvedAt: now }), true],
    ["a done record with no resolvedAt, started 8 days ago", job("old", { status: "done", startedAt: now - 8 * DAY }), false],
    ["a done record with no resolvedAt, started a day ago", job("young", { status: "done", startedAt: now - DAY }), true],
    ["a record whose age is not a number", job("nan", { status: "done", startedAt: Number.NaN }), true],
    ["a record whose resolvedAt is not a number", job("str", { status: "failed", resolvedAt: "soon" as unknown as number }), true],
  ])("keeps %s: %s", (_case, record, kept) => {
    expect(pruneJobs([record], now)).toEqual(kept ? [record] : []);
  });
});

describe("givenUp", () => {
  const now = 10 * DAY;
  it.each([
    ["24 hours unreachable", now - 24 * HOUR, true],
    ["25 hours unreachable", now - 25 * HOUR, true],
    ["just under 24 hours", now - 24 * HOUR + 1, false],
    ["no stamp", undefined, false],
    ["a stamp that is not a number", "yesterday", false],
    ["a NaN stamp", Number.NaN, false],
  ])("%s gives %s", (_case, stamp, expected) => {
    const record = stamp === undefined ? job("a") : job("a", { unreachableSince: stamp as number });
    expect(givenUp(record, now)).toBe(expected);
  });
});

describe("pendingFor", () => {
  const jobs = [
    job("a"),
    job("b", { status: "done" }),
    job("c", { project: "other" }),
    job("d", { project: null }),
    job("e", { project: "" }),
    { ...job("f"), project: undefined } as unknown as RenderJob,
    job("g", { status: "failed", project: "other" }),
  ];
  it("answers every pending record when no project is named", () => {
    expect(pendingFor(jobs).map((each) => each.id)).toEqual(["a", "c", "d", "e", "f"]);
    expect(pendingFor(jobs, null).map((each) => each.id)).toEqual(["a", "c", "d", "e", "f"]);
  });

  it("answers the pending records of one project, a missing project and '' being one bucket", () => {
    expect(pendingFor(jobs, "board").map((each) => each.id)).toEqual(["a"]);
    expect(pendingFor(jobs, "other").map((each) => each.id)).toEqual(["c"]);
    expect(pendingFor(jobs, "").map((each) => each.id)).toEqual(["d", "e", "f"]);
  });
});

describe("the two parsers", () => {
  it.each([
    ["a list", `[${JSON.stringify(job("a"))}]`, [job("a")]],
    ["an empty list", "[]", []],
    ["an object", '{"jobs":[]}', []],
    ["null", "null", []],
    ["a number", "7", []],
    ["broken JSON", '[{"id":', []],
    ["nothing", "", []],
  ])("lenient reads %s", (_case, text, expected) => {
    expect(parseJobsLenient(text)).toEqual(expected);
  });

  it("strict reads a list", () => {
    expect(parseJobsStrict(`[${JSON.stringify(job("a"))}]`, "/out/jobs.json")).toEqual({ ok: true, jobs: [job("a")] });
  });

  it("strict names the path and the fault for broken JSON", () => {
    const answer = parseJobsStrict('[{"id":', "/out/jobs.json");
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toMatch(/^The job store at \/out\/jobs\.json is not valid JSON: .+/);
  });

  it.each(['{"jobs":[]}', "null", '"text"', "3"])("strict names the path for %s, which is not a list", (text) => {
    expect(parseJobsStrict(text, "/out/jobs.json")).toEqual({ ok: false, error: "The job store at /out/jobs.json is not a list of jobs." });
  });
});

describe("classifying an upstream status", () => {
  it("reads completed as done", () => {
    expect(classifyVideoStatus({ status: "completed" })).toEqual({ kind: "done" });
  });

  it.each(["failed", "expired", "cancelled", "canceled"])("reads %s as a terminal failure with the provider's message", (status) => {
    expect(classifyVideoStatus({ status, error: { message: "Output flagged" } })).toEqual({ kind: "failed", message: "Output flagged" });
    expect(classifyVideoStatus({ status, error: "plain words" })).toEqual({ kind: "failed", message: "plain words" });
    expect(classifyVideoStatus({ status })).toEqual({ kind: "failed", message: "Generation failed." });
  });

  it.each([
    ["queued", 0, 0],
    ["in_progress", 42, 42],
    ["pending", undefined, null],
    ["a status nobody has seen", "half", null],
  ])("keeps waiting on %s", (status, progress, read) => {
    expect(classifyVideoStatus({ status, progress })).toEqual({ kind: "rendering", status, progress: read });
  });

  it("keeps waiting when the answer has no status at all", () => {
    expect(classifyVideoStatus({})).toEqual({ kind: "rendering", status: "", progress: null });
  });
});
