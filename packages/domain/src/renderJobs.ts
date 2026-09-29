/**
 * The render job store's pure half (spec 04): the record format of `jobs.json` and the
 * rules for merging, pruning, giving up and reading it, plus the one classification of an
 * upstream job status. The engine owns the file, the queue and the reads.
 */

export interface RenderJobParams {
  readonly prompt: string;
  readonly model: string;
  readonly duration: number | null;
  readonly resolution: string | null;
  readonly size: string | null;
}

/** One record of `jobs.json`. The first eleven fields are the old app's format exactly. */
export interface RenderJob {
  /** OpenRouter's job id. */
  readonly id: string;
  /** The project folder name; missing and '' are one bucket. */
  readonly project: string | null;
  readonly params: RenderJobParams;
  /** Epoch ms, never changes. */
  readonly startedAt: number;
  readonly status: "pending" | "done" | "failed";
  readonly refs?: { readonly images: number; readonly videos: number; readonly frames: number } | null;
  readonly savedPath?: string;
  readonly cost?: number | null;
  /** Epoch ms, stamped on done or failed. */
  readonly resolvedAt?: number;
  readonly error?: string;
  /** Epoch ms of the first unanswered poll in the current run of them. */
  readonly unreachableSince?: number;
  readonly landing?: { readonly shapeId?: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Spec 03's recipe schema. */
  readonly recipe?: unknown;
  readonly forgotten?: true;
}

/** A change to one record. A key set to undefined is removed from the written file. */
export type RenderJobPatch = { readonly [K in keyof RenderJob]?: RenderJob[K] | undefined };

/** Done and failed records are pruned this long after they resolved. */
export const JOB_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** A job upstream never answered about for this long fails. */
export const GIVE_UP_MS = 24 * 60 * 60 * 1000;

export const upsertJob = (jobs: ReadonlyArray<RenderJob>, job: RenderJob): RenderJob[] => {
  const at = jobs.findIndex((each) => each.id === job.id);
  return at < 0 ? [...jobs, job] : jobs.map((each, index) => (index === at ? job : each));
};

/** `{ startedAt: now, ...existing, ...patch, id }`, where a patch key set to undefined removes that key. */
export const mergeJob = (existing: RenderJob | undefined, patch: RenderJobPatch & { readonly id: string }, now: number): RenderJob => {
  const merged: Record<string, unknown> = { startedAt: now, ...existing, ...patch, id: existing?.id ?? patch.id };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete merged[key];
  return merged as unknown as RenderJob;
};

/**
 * Keeps every pending record, and a done or failed one while it resolved under 7 days ago.
 * Age counts from `resolvedAt` (else `startedAt`), so a render that sat pending for a week
 * is not deleted in the write that resolves it. A record whose age is not a number is kept.
 */
export const pruneJobs = (jobs: ReadonlyArray<RenderJob>, now: number): RenderJob[] =>
  jobs.filter((job) => {
    if (job.status === "pending") return true;
    const age = now - (job.resolvedAt ?? job.startedAt);
    return !Number.isFinite(age) || age < JOB_KEEP_MS;
  });

/** True when the job has gone unanswered for 24 hours. A record without the stamp is never given up. */
export const givenUp = (job: RenderJob, now: number): boolean => {
  const since = now - (job.unreachableSince as number);
  return typeof job.unreachableSince === "number" && Number.isFinite(since) && since >= GIVE_UP_MS;
};

/** Pending records: all of them without a project, else those of that project (missing counts as ''). */
export const pendingFor = (jobs: ReadonlyArray<RenderJob>, project?: string | null): RenderJob[] =>
  jobs.filter((job) => job.status === "pending" && (project === undefined || project === null || (job.project ?? "") === project));

/** A list, or `[]` for anything that is not a JSON list. */
export const parseJobsLenient = (text: string): RenderJob[] => {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as RenderJob[]) : [];
  } catch {
    return [];
  }
};

/** A list, or the error that names the file and its fault. */
export const parseJobsStrict = (text: string, path: string): { readonly ok: true; readonly jobs: RenderJob[] } | { readonly ok: false; readonly error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `The job store at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  return Array.isArray(parsed) ? { ok: true, jobs: parsed as RenderJob[] } : { ok: false, error: `The job store at ${path} is not a list of jobs.` };
};

export type UpstreamVideoStatus =
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly message: string }
  /** Still in flight: the raw status, so an unusual one reads as unusual. */
  | { readonly kind: "rendering"; readonly status: string; readonly progress: number | null };

/** What a failed render says when the provider gives no reason. */
export const GENERATION_FAILED = "Generation failed.";

const TERMINAL = new Set(["failed", "expired", "cancelled", "canceled"]);

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/**
 * One home for "what did upstream say": `completed` is done; failed, expired, cancelled and
 * canceled are terminal; anything else, a status nobody has seen included, keeps waiting.
 */
export const classifyVideoStatus = (data: unknown): UpstreamVideoStatus => {
  const status = field(data, "status");
  if (status === "completed") return { kind: "done" };
  if (typeof status === "string" && TERMINAL.has(status)) {
    const error = field(data, "error");
    const message = field(error, "message");
    return { kind: "failed", message: typeof message === "string" ? message : typeof error === "string" ? error : GENERATION_FAILED };
  }
  const progress = field(data, "progress");
  return { kind: "rendering", status: typeof status === "string" ? status : "", progress: typeof progress === "number" && Number.isFinite(progress) ? progress : null };
};
