/**
 * Spec 10's job lifecycle on spec 04's store: every operation runs on the store's one
 * queue with the strict read, so a damaged store fails the change instead of reading as
 * "nothing in flight", and every write prunes as spec 04 does. Failures reject with the
 * strict read's message or the write's error.
 */
import {
  copyPendingJobs,
  dropPendingJobs,
  failPendingJobs,
  pendingFor,
  pruneJobs,
  reassignPendingJobs,
  type FailPendingOptions,
  type RenderJob,
} from "@unframed/domain";
import * as Data from "effect/Data";
import { onJobStore, readJobsStrict, writeJobs } from "./jobStore.ts";

/** A lifecycle operation on the job store that did not land: the strict read or the write failed. */
export class JobStoreError extends Data.TaggedError("JobStoreError")<{ readonly reason: string }> {}

/** Reads, edits and writes back only when the edit changed something. */
const edit = <T>(outputDir: string, change: (jobs: RenderJob[]) => { readonly jobs: RenderJob[]; readonly result: T; readonly changed: boolean }) =>
  onJobStore(async () => {
    const out = change(await readJobsStrict(outputDir));
    if (out.changed) await writeJobs(outputDir, pruneJobs(out.jobs, Date.now()));
    return out.result;
  });

/** The pending records of one project (a slug), or of all. */
export const readPendingJobs = (outputDir: string, project?: string): Promise<RenderJob[]> =>
  onJobStore(async () => pendingFor(await readJobsStrict(outputDir), project));

/** Merges every pending record of the store at `from` into the one at `to`; answers the ids copied. */
export const copyPendingJobsTo = (from: string, to: string): Promise<string[]> =>
  onJobStore(async () => {
    const source = await readJobsStrict(from);
    const target = await readJobsStrict(to);
    const { jobs, copied } = copyPendingJobs(source, target);
    if (copied.length > 0) await writeJobs(to, pruneJobs(jobs, Date.now()));
    return copied;
  });

/** Removes these ids from the store's pending records. */
export const dropPendingJobsIn = (outputDir: string, ids: ReadonlyArray<string>): Promise<void> =>
  edit(outputDir, (jobs) => {
    const next = dropPendingJobs(jobs, ids);
    return { jobs: next, result: undefined, changed: next.length !== jobs.length };
  });

/** Fails pending records (of one project, or with these ids, or all); answers the records it failed. */
export const failPendingJobsIn = (outputDir: string, options: FailPendingOptions): Promise<RenderJob[]> =>
  edit(outputDir, (jobs) => {
    const { jobs: next, failed } = failPendingJobs(jobs, { ...options, now: Date.now() });
    return { jobs: next, result: failed, changed: failed.length > 0 };
  });

/** Points the pending records of project `from` at `to`; answers how many moved. */
export const reassignPendingJobsIn = (outputDir: string, from: string, to: string): Promise<number> =>
  edit(outputDir, (jobs) => {
    const { jobs: next, moved } = reassignPendingJobs(jobs, from, to);
    return { jobs: next, result: moved, changed: moved > 0 };
  });
