// node server/jobs.test.js  (also part of `npm test`)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJobs, writeJobs, jobsPath, upsertJob, pruneJobs, persistJob } from './jobs.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-test-'));

// Nothing saved yet: [] is the honest answer, same as presets.
assert.deepEqual(await readJobs(dir), [], 'a missing file reads as empty');

// Round trip, so the corruption cases below are guarding something that works.
const job = {
  id: 'job-1',
  project: 'demo',
  params: { prompt: 'a cat', model: 'bytedance/seedance-2.0', duration: 5 },
  startedAt: Date.now(),
  status: 'pending',
};
await writeJobs(dir, [job]);
assert.deepEqual(await readJobs(dir), [job], 'what was written comes back');

// UNLIKE presets.js: damaged JSON reads as [] rather than throwing. See the
// comment in jobs.js for why that is the safe direction here and not there —
// losing the ability to resume a job is recoverable, refusing to boot over one
// bad file is not.
await fs.writeFile(jobsPath(dir), '{not json');
assert.deepEqual(await readJobs(dir), [], 'corrupt jobs.json reads as [], never throws');

// Valid JSON that just isn't an array (hand-edited, or from a future format)
// must not throw either, and must not be handed back as-is.
await fs.writeFile(jobsPath(dir), '{"oops": true}');
assert.deepEqual(await readJobs(dir), [], 'valid JSON that is not an array still reads as []');

// A directory in the file's place is the deterministic version of "exists, but
// cannot be read" — same trick presets.test.js uses, since chmod 000 proves
// nothing when the test happens to run as root.
await fs.rm(jobsPath(dir));
await fs.mkdir(jobsPath(dir));
assert.deepEqual(await readJobs(dir), [], 'an unreadable path reads as [], never throws');
await fs.rm(jobsPath(dir), { recursive: true });

// writeJobs creates the folder: a brand-new output dir must accept a first save.
const fresh = path.join(dir, 'nested', 'output');
await writeJobs(fresh, [job]);
assert.deepEqual(await readJobs(fresh), [job], 'a missing output dir is created');

// ---- upsertJob ----
const a = { id: 'a', status: 'pending', startedAt: Date.now() };
const b = { id: 'b', status: 'pending', startedAt: Date.now() };
assert.deepEqual(upsertJob([a], b), [a, b], 'a new id is appended');

const bDone = { id: 'b', status: 'done', savedPath: '/x.mp4', startedAt: b.startedAt };
const upserted = upsertJob([a, b], bDone);
assert.deepEqual(upserted, [a, bDone], 'a matching id replaces in place, not appended');
assert.equal(upserted.length, 2, 'no duplicate record for the same id');

// ---- pruneJobs ----
const now = Date.now();
const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
const oldDone = { id: 'old-done', status: 'done', startedAt: eightDaysAgo };
const oldFailed = { id: 'old-failed', status: 'failed', startedAt: eightDaysAgo };
const oldPending = { id: 'old-pending', status: 'pending', startedAt: eightDaysAgo };
const recentDone = { id: 'recent-done', status: 'done', startedAt: now };

const pruned = pruneJobs([oldDone, oldFailed, oldPending, recentDone], now);
assert.deepEqual(
  pruned.map((j) => j.id).sort(),
  ['old-pending', 'recent-done'].sort(),
  'done/failed jobs older than 7 days are dropped; pending survives regardless of age; a recent done survives too',
);

// A record whose age can't be computed at all -- startedAt missing entirely, or
// present but NaN -- must be kept, not treated as maximally stale. Reviewed
// bug: the original pruneJobs measured age as `now - job.startedAt`; a missing
// value makes that NaN, and `NaN < SEVEN_DAYS_MS` is false, so a done/failed
// record with no startedAt was dropped on sight.
const noTimestamp = { id: 'no-timestamp', status: 'done' };
const nanTimestamp = { id: 'nan-timestamp', status: 'failed', startedAt: NaN };
assert.deepEqual(
  pruneJobs([noTimestamp, nanTimestamp], now)
    .map((j) => j.id)
    .sort(),
  ['nan-timestamp', 'no-timestamp'],
  'a missing or NaN startedAt is kept, not guessed at as infinitely old',
);

// Age is measured from resolvedAt (the moment a job actually finished), not
// startedAt (the moment it was created), falling back to startedAt only when
// resolvedAt is absent. Reviewed bug: a job that sat `pending` for over a week
// before finally resolving was pruned in the SAME write that first marked it
// done, because the old pruneJobs measured age from startedAt regardless of
// status -- exactly the "close the app for a week, come back" scenario this
// whole feature exists for.
const longPendingThenJustDone = {
  id: 'long-pending-then-done',
  status: 'done',
  startedAt: eightDaysAgo,
  resolvedAt: now,
};
const resolvedLongAgoToo = {
  id: 'resolved-long-ago',
  status: 'done',
  startedAt: eightDaysAgo,
  resolvedAt: eightDaysAgo,
};
assert.deepEqual(
  pruneJobs([longPendingThenJustDone, resolvedLongAgoToo], now).map((j) => j.id),
  ['long-pending-then-done'],
  'a job resolved just now survives even after a week pending; one resolved a week ago does not',
);

// ---- persistJob (serialized read-modify-write) ----
// Reviewed bug: persistJob used to be a bare read-modify-write with no
// serialization. Two concurrent calls for DIFFERENT ids could both read the
// same starting array, each write back a version with only their own change,
// and the second write to land would silently erase the first's update --
// reproduced verbatim from the review with the store's own functions before
// this fix:
//   Promise.all([persistJob(dir,'A',{status:'done',...}), persistJob(dir,'B',{status:'done',...})])
//   -> A comes back 'pending' again, even though A.mp4 was already written.
const raceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-race-'));
await writeJobs(raceDir, [
  { id: 'A', status: 'pending', startedAt: Date.now() },
  { id: 'B', status: 'pending', startedAt: Date.now() },
]);
await Promise.all([
  persistJob(raceDir, 'A', { status: 'done', savedPath: '/A.mp4', resolvedAt: Date.now() }),
  persistJob(raceDir, 'B', { status: 'done', savedPath: '/B.mp4', resolvedAt: Date.now() }),
]);
const afterRace = await readJobs(raceDir);
assert.deepEqual(
  afterRace
    .map((j) => ({ id: j.id, status: j.status, savedPath: j.savedPath }))
    .sort((x, y) => x.id.localeCompare(y.id)),
  [
    { id: 'A', status: 'done', savedPath: '/A.mp4' },
    { id: 'B', status: 'done', savedPath: '/B.mp4' },
  ],
  'two concurrent persistJob calls for different ids must not lose either update',
);
await fs.rm(raceDir, { recursive: true, force: true });

// A job absent from the store entirely (persistJob's first-ever write for that
// id) still gets a real startedAt, so it can't come back with a NaN age the
// instant it's created -- the identical shape of bug as the pruneJobs case
// above, at the other place a fresh record can be born.
const freshJobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-fresh-'));
const created = await persistJob(freshJobDir, 'never-seen-before', { status: 'failed', error: 'x' });
assert.ok(Number.isFinite(created.startedAt), 'a brand-new record gets a real startedAt, not undefined');
await fs.rm(freshJobDir, { recursive: true, force: true });

await fs.rm(dir, { recursive: true, force: true });
console.log('jobs.test.js: ok');
