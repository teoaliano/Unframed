/**
 * The render job store's I/O half (spec 04): `<output folder>/jobs.json`, one JSON array.
 * Every write runs on one module-level queue, so no two read-modify-writes interleave, and
 * lands through a temp file renamed over the store, so a crash leaves the old file or the
 * new one. Spec 10's lifecycle actions run on the same queue with strict reads.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mergeJob, parseJobsLenient, parseJobsStrict, pruneJobs, upsertJob, type RenderJob, type RenderJobPatch } from "@unframed/domain";
import { errorText } from "../log.ts";

export const jobStorePath = (outputDir: string): string => join(outputDir, "jobs.json");

let queue: Promise<unknown> = Promise.resolve();

/** Runs `task` after every store task queued before it. A failed task does not poison later ones. */
export const onJobStore = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};

/**
 * Missing, unreadable, corrupt or not a list reads as `[]`. Used by the sweep, the poll,
 * the collector and every write: refusing to boot or sweep over one bad file is worse
 * than losing the ability to resume.
 */
export const readJobsLenient = async (outputDir: string): Promise<RenderJob[]> => {
  try {
    return parseJobsLenient(await readFile(jobStorePath(outputDir), "utf8"));
  } catch {
    return [];
  }
};

/**
 * Only a missing file reads as `[]`. For every lifecycle action that could strand a render
 * (spec 10), because "0 pending" from a damaged store reads exactly like "nothing in flight".
 */
export const readJobsStrict = async (outputDir: string): Promise<RenderJob[]> => {
  const path = jobStorePath(outputDir);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`The job store at ${path} could not be read: ${errorText(error)}`);
  }
  const parsed = parseJobsStrict(text, path);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.jobs;
};

/** Writes the whole store through a temp file in the same folder, renamed over `jobs.json`. */
export const writeJobs = async (outputDir: string, jobs: ReadonlyArray<RenderJob>): Promise<void> => {
  await mkdir(outputDir, { recursive: true });
  const path = jobStorePath(outputDir);
  const temp = `${path}.${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(jobs, null, 2)}\n`);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
};

/** Merges `patch` into the record `id` (making it when missing), prunes, writes, and answers the merged record. */
export const persistJob = (outputDir: string, id: string, patch: RenderJobPatch): Promise<RenderJob> =>
  onJobStore(async () => {
    const jobs = await readJobsLenient(outputDir);
    const now = Date.now();
    const merged = mergeJob(
      jobs.find((job) => job.id === id),
      { ...patch, id },
      now,
    );
    await writeJobs(outputDir, pruneJobs(upsertJob(jobs, merged), now));
    return merged;
  });
