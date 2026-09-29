/**
 * The pure half of spec 10's job lifecycle: what an output folder move, a project rename
 * or delete and a key removal do to the records of spec 04's job store. The engine reads
 * the store strictly, runs these on spec 04's queue and prunes on every write.
 */
import { upsertJob, type RenderJob } from "./renderJobs.ts";

const isPendingIn = (job: RenderJob, project: string | undefined) => job.status === "pending" && (project === undefined || (job.project ?? "") === project);

/** Every pending record of `from` merged into `into` by id, and the ids it copied. */
export const copyPendingJobs = (from: ReadonlyArray<RenderJob>, into: ReadonlyArray<RenderJob>): { readonly jobs: RenderJob[]; readonly copied: string[] } => {
  const pending = from.filter((job) => job.status === "pending");
  return { jobs: pending.reduce<RenderJob[]>((jobs, job) => upsertJob(jobs, job), [...into]), copied: pending.map((job) => job.id) };
};

/** Removes the pending records with these ids. A done or failed one is history and stays. */
export const dropPendingJobs = (jobs: ReadonlyArray<RenderJob>, ids: ReadonlyArray<string>): RenderJob[] => {
  const drop = new Set(ids);
  return jobs.filter((job) => !(job.status === "pending" && drop.has(job.id)));
};

/** Fails the pending records of one project (a slug), or of every project, stamping `resolvedAt`. */
export const failPendingJobs = (
  jobs: ReadonlyArray<RenderJob>,
  options: { readonly project?: string; readonly error: string; readonly now: number },
): { readonly jobs: RenderJob[]; readonly failed: RenderJob[] } => {
  const failed: RenderJob[] = [];
  const next = jobs.map((job) => {
    if (!isPendingIn(job, options.project)) return job;
    const ended: RenderJob = { ...job, status: "failed", error: options.error, resolvedAt: options.now };
    failed.push(ended);
    return ended;
  });
  return { jobs: next, failed };
};

/** Points every pending record of project `from` at project `to`. */
export const reassignPendingJobs = (jobs: ReadonlyArray<RenderJob>, from: string, to: string): { readonly jobs: RenderJob[]; readonly moved: number } => {
  let moved = 0;
  const next = jobs.map((job) => {
    if (!isPendingIn(job, from)) return job;
    moved++;
    return { ...job, project: to };
  });
  return { jobs: next, moved };
};
