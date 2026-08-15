// node server/jobs.test.js  (also part of `npm test`)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJobs, writeJobs, jobsPath, upsertJob, pruneJobs } from './jobs.js';

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

await fs.rm(dir, { recursive: true, force: true });
console.log('jobs.test.js: ok');
