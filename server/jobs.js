// Pending video jobs, so a render outlives the browser that started it. One
// JSON array in one file at the root of OUTPUT_DIR -- same layout as
// presets.js's presets.json -- read and written by index.js's sweep and its two
// /api/video routes. The user-facing story is in docs/video-and-sharing.md;
// CLAUDE.md's server bullet has the one-line summary.
//
// A job is
// { id, project, params, startedAt, status, savedPath?, error?, refs?, resolvedAt? }.
// params is exactly what a poll needs to name the file and its sidecar (prompt,
// model, duration, resolution, size). resolvedAt is stamped the instant a job
// becomes done/failed (see pruneJobs) and is separate from startedAt, which
// never changes once a job is created.
import fs from 'node:fs/promises';
import path from 'node:path';

export const jobsPath = (dir) => path.join(dir, 'jobs.json');

// UNLIKE presets.js's readPresets, a broken jobs.json reads as [] instead of
// throwing. That tradeoff is real, not free, so here is exactly what does and
// doesn't make it safe. writeJobs below writes via a temp file + rename, so
// THIS code can no longer produce a half-written file for a crash to land in
// the middle of; persistJob's writes are serialized through `enqueue`, so two
// callers finishing different jobs seconds apart can no longer race each other
// into dropping one's update. What is NOT covered: if jobs.json is corrupted by
// something outside this process entirely -- a hand-edit, a dying disk,
// someone deleting it mid-render -- the next persistJob call merges its patch
// onto an empty list and writes that back, forgetting every OTHER job the
// store was tracking. That is accepted, not overlooked: the calling node still
// remembers its own job id (in data.job) and can still get it finished the
// slow way, one poll at a time, once it reconnects -- losing track in the
// store is recoverable, and refusing to boot, or to ever write again, over one
// externally-damaged file is not.
export async function readJobs(dir) {
  let raw;
  try {
    raw = await fs.readFile(jobsPath(dir), 'utf8');
  } catch {
    return []; // no file: nothing saved yet, or OUTPUT_DIR just moved
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // truncated by a crash mid-write, or hand-edited into invalid JSON
  }
}

// Write-then-rename rather than a direct write: rename is atomic on the same
// filesystem, so a reader (or a process killed mid-save) only ever observes
// the complete old file or the complete new one, never a half-written one.
// The pid+timestamp suffix is cheap insurance against two temp files
// colliding; the rename is what actually makes this safe.
export async function writeJobs(dir, jobs) {
  await fs.mkdir(dir, { recursive: true });
  const file = jobsPath(dir);
  const tmp = `${file}.${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(jobs, null, 2));
  await fs.rename(tmp, file);
}

// Replaces the record sharing an id rather than appending a duplicate. Every
// caller already holds the full current record for that id -- persistJob below
// re-upserts it wholesale on every transition rather than patching one field
// of the file in place.
export function upsertJob(jobs, job) {
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx === -1) return [...jobs, job];
  const next = jobs.slice();
  next[idx] = job;
  return next;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// done/failed jobs are clutter after a week; pending ones are kept no matter
// how old, because age alone is never evidence a render was abandoned -- only
// the sweep resolving it is. Age is measured from resolvedAt -- the moment a
// job actually finished -- falling back to startedAt only for a record with no
// resolvedAt yet. A record whose age can't be computed at all (a missing or
// invalid timestamp -- NaN either way) is kept rather than guessed at: an
// unknown age is not evidence of anything, and guessing wrong here is exactly
// what deleted a job in the very write that first marked it done, before this
// guard existed.
export function pruneJobs(jobs, now = Date.now()) {
  return jobs.filter((job) => {
    if (job.status === 'pending') return true;
    const age = now - (job.resolvedAt ?? job.startedAt);
    return !Number.isFinite(age) || age < SEVEN_DAYS_MS;
  });
}

// 24 hours. The one thing that can end a `pending` job the sweep can no longer
// poll at all -- an id OpenRouter has forgotten answers 404 forever, sweepOne
// returns silently on any not-ok poll, and pruneJobs above keeps every pending
// record on purpose, so without this the record is re-polled every 30 seconds for
// the life of the process and jobs.json only ever grows.
//
// A duration, not a count of failed polls: at one sweep every 30s, "N failures"
// is really "N/2 minutes of bad luck", and the number that reads as generous
// (say 20) is eight minutes -- shorter than plenty of real outages. And the two
// mistakes here are nothing like symmetrical. Give up too early on a job that
// was only unreachable, and a clip the user already paid for is never collected
// and never mentioned again. Give up too late and it costs one line in jobs.json
// and one poll every 30s. So this errs long, deliberately.
//
// The clock is what makes that honest, and it measures CONTINUOUS unreachability:
// the sweep stamps unreachableSince on the first failed poll and clears it on any
// poll that gets an answer -- even one that only says "still queued". A blip on
// day one followed by a blip on day two is two blips, not 24 hours of silence.
export const UNREACHABLE_MS = 24 * 60 * 60 * 1000;

// A record with no unreachableSince (the normal case) yields NaN and is never
// given up on -- same "an unknown age is not evidence of anything" rule pruneJobs
// follows one function up.
export function givenUp(job, now = Date.now()) {
  const stuck = now - job.unreachableSince;
  return Number.isFinite(stuck) && stuck >= UNREACHABLE_MS;
}

// Every store mutation queues behind the last one, so a read-modify-write on
// the shared file can never interleave with another and drop an update -- two
// jobs finishing seconds apart is the ordinary case once a sweep is polling
// several at once, not a rare one. `fn, fn` on both arguments to .then is
// deliberate: if the previous write rejected, the chain must not stay
// rejected forever -- the same closure gets a chance to run as the rejection
// handler too, so one failed write can't poison every later one.
let storeChain = Promise.resolve();
function enqueue(fn) {
  return (storeChain = storeChain.then(fn, fn));
}

// Reads the store, merges `patch` onto whatever record `id` already has (or
// starts fresh -- startedAt defaults to now so a brand-new record, such as a
// failure recorded for a job the store never learned about, can't read back
// with a NaN age), prunes, writes the whole file back. The one place a job
// record's shape changes, so every writer -- job creation, the poll route,
// the sweep -- can't drift into writing a slightly different shape for the
// same transition. Queued through `enqueue`, never called directly against
// the file, which is what makes concurrent callers safe.
export function persistJob(dir, id, patch) {
  return enqueue(async () => {
    const jobs = await readJobs(dir);
    const existing = jobs.find((j) => j.id === id);
    const job = { startedAt: Date.now(), ...existing, ...patch, id };
    await writeJobs(dir, pruneJobs(upsertJob(jobs, job), Date.now()));
    return job;
  });
}

// Moves every `pending` record from one store to another as a single unit on
// the SAME chain persistJob queues on. That placement is the whole point, not
// an implementation detail: a caller like sweepOne calls persistJob(OUTPUT_DIR,
// ...) with OUTPUT_DIR captured at dispatch time, so a sweep tick started
// just before OUTPUT_DIR changes still has the OLD dir in its closure -- and
// its queued read-modify-write can run at any point after this function is
// called. A migration done as two bare readJobs/writeJobs calls outside the
// queue can land in the gap between that sweep's read and its write, so the
// sweep's own write -- which still targets the old dir and still has the
// pending record in memory -- lands AFTER the migration's write and silently
// resurrects a record this function just moved out. Enqueuing the whole
// migration closes that gap: the sweep's call and this one serialize onto the
// same storeChain, so one fully finishes (old dir stripped, new dir has the
// record) before the other's read-modify-write can even start.
//
// Destination first, source second: if the second write throws (the disk
// error an external drive makes plausible), the worst case is a record
// present in both stores -- and the copy that matters, the one in the folder
// the sweep now reads, already exists. Writing source-first and having the
// destination write fail would delete the only copy of a render still in
// flight, which is exactly the loss this whole feature exists to prevent.
export function migratePendingJobs(fromDir, toDir) {
  return enqueue(async () => {
    const old = await readJobs(fromDir);
    const pending = old.filter((j) => j.status === 'pending');
    if (!pending.length) return 0;
    const dest = pending.reduce(upsertJob, await readJobs(toDir));
    await writeJobs(toDir, pruneJobs(dest, Date.now()));
    await writeJobs(fromDir, old.filter((j) => j.status !== 'pending'));
    return pending.length;
  });
}
