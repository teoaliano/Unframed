// Pending video jobs, so a render outlives the browser that started it. One
// JSON array in one file at the root of OUTPUT_DIR -- same layout as
// presets.js's presets.json -- read and written by index.js's sweep and its two
// /api/video routes. The user-facing story is in docs/video-and-sharing.md;
// CLAUDE.md's server bullet has the one-line summary.
//
// A job is { id, project, params, startedAt, status, savedPath?, error?, refs? }.
// params is exactly what a poll needs to name the file and its sidecar (prompt,
// model, duration, resolution, size) -- the same shape the client used to keep
// in node data alone before this file existed.
import fs from 'node:fs/promises';
import path from 'node:path';

export const jobsPath = (dir) => path.join(dir, 'jobs.json');

// UNLIKE presets.js's readPresets, a broken jobs.json reads as [] instead of
// throwing. That looks like the exact footgun presets.test.js exists to catch --
// so here is why it isn't one. readPresets throws on damage because saving a
// preset is read-all -> append -> write-all; a falsely-empty read there would
// let the next save silently replace a full library with one item. Nothing here
// has that shape: every write below (job creation, the sweep, the poll route)
// replaces the array with data the CALLER already holds -- a job it just made,
// or one it just polled -- never with a blind append onto whatever this read
// returned. So a damaged file costs only the ability to resume jobs that hadn't
// finished yet, which is recoverable (the browser's own node data still has the
// id); the alternative, throwing, would take down the boot sequence every OTHER
// job -- including perfectly healthy pending ones -- needs to run before the
// sweep can ever collect them. Losing resume is bad; refusing to start is worse.
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

export async function writeJobs(dir, jobs) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(jobsPath(dir), JSON.stringify(jobs, null, 2));
}

// Replaces the record sharing an id rather than appending a duplicate. Every
// caller already holds the full current record for that id -- creation, the
// sweep, and the poll route all re-upsert it wholesale on every transition
// rather than patching a field in place.
export function upsertJob(jobs, job) {
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx === -1) return [...jobs, job];
  const next = jobs.slice();
  next[idx] = job;
  return next;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// done/failed jobs are clutter after a week; pending ones are kept no matter how
// old, because age alone is never evidence a render was abandoned -- only the
// sweep actually resolving it is. startedAt is the only timestamp a job carries,
// so it is what "seven days" measures against for a finished job too, not just a
// pending one.
export function pruneJobs(jobs, now = Date.now()) {
  return jobs.filter((job) => job.status === 'pending' || now - job.startedAt < SEVEN_DAYS_MS);
}
