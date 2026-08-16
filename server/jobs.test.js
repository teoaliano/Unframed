// node server/jobs.test.js  (also part of `npm test`)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readJobs,
  writeJobs,
  jobsPath,
  upsertJob,
  pruneJobs,
  persistJob,
  givenUp,
  UNREACHABLE_MS,
  migratePendingJobs,
  readJobsStrict,
  pendingJobsFor,
  copyPendingJobs,
  dropPendingJobs,
  failPendingJobs,
  reassignPendingJobs,
} from './jobs.js';

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

// ---- givenUp ----
// pruneJobs above keeps every pending record forever, and sweepOne returns
// silently on a failed poll, so a job whose id OpenRouter has forgotten was
// re-polled every 30 seconds for the life of the process and jobs.json only ever
// grew. This is the only thing that ends one.
assert.equal(givenUp({ id: 'x', status: 'pending' }, now), false,
  'a job that has never failed a poll is never given up on');
assert.equal(givenUp({ id: 'x', unreachableSince: now - 60_000 }, now), false,
  'a minute of failed polls is a blip, not a dead job');
assert.equal(givenUp({ id: 'x', unreachableSince: now - UNREACHABLE_MS + 1000 }, now), false,
  'still inside the window with a second to go');
assert.equal(givenUp({ id: 'x', unreachableSince: now - UNREACHABLE_MS }, now), true,
  'a full day with no answer at all ends the job');
// Same rule pruneJobs follows: an age that cannot be computed is not evidence of
// anything. Failing a job over a garbage timestamp would throw away a paid render.
assert.equal(givenUp({ id: 'x', unreachableSince: NaN }, now), false,
  'a NaN unreachableSince is not treated as infinitely stale');
assert.equal(givenUp({ id: 'x', unreachableSince: 'yesterday' }, now), false,
  'nor is a non-numeric one');

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

// The other half of the give-up clock: sweepOne clears unreachableSince by
// patching it to undefined, and that has to actually reach the FILE. If the field
// survived on disk, one blip today plus one tomorrow would read as a day of
// continuous silence and fail a job that is still rendering.
const clockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-clock-'));
await writeJobs(clockDir, [{ id: 'C', status: 'pending', startedAt: now, unreachableSince: now - 60_000 }]);
await persistJob(clockDir, 'C', { unreachableSince: undefined });
const [cleared] = await readJobs(clockDir);
assert.equal('unreachableSince' in cleared, false, 'a successful poll clears the clock on disk, not just in memory');
assert.equal(cleared.status, 'pending', 'and leaves the rest of the record alone');
await fs.rm(clockDir, { recursive: true, force: true });

// A job absent from the store entirely (persistJob's first-ever write for that
// id) still gets a real startedAt, so it can't come back with a NaN age the
// instant it's created -- the identical shape of bug as the pruneJobs case
// above, at the other place a fresh record can be born.
const freshJobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-fresh-'));
const created = await persistJob(freshJobDir, 'never-seen-before', { status: 'failed', error: 'x' });
assert.ok(Number.isFinite(created.startedAt), 'a brand-new record gets a real startedAt, not undefined');
await fs.rm(freshJobDir, { recursive: true, force: true });

// ---- migratePendingJobs: two paths naming the SAME directory must be a no-op ----
// Reviewed bug: fromDir and toDir being two different strings that resolve to
// one physical directory (a case alias, or a symlink) was not guarded. The
// call site's guard in index.js is `oldDir !== OUTPUT_DIR`, a string compare
// of path.resolve() output -- which normalises trailing slashes and `..` but
// not case and not a symlink, so it stays `true` (different) for both aliases
// below and lets the call through. Once inside, the "migration" wrote the
// pending records back to the alias (a no-op, since it's the same file) and
// then overwrote that same file with the non-pending remainder -- deleting
// every in-flight render. Both cases here assert the guard catches it via
// fs.stat's dev+ino instead.

// Case alias: on default case-insensitive APFS (macOS), `Renders` and
// `renders` are one directory. Elsewhere (ext4 on Linux CI) they are two, so
// this probes the actual filesystem under test rather than assuming macOS.
const caseBase = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-case-'));
const caseDir = path.join(caseBase, 'Renders');
await fs.mkdir(caseDir);
const caseAlias = path.join(caseBase, 'renders');
const caseInsensitive = await fs.stat(caseAlias).then(
  () => true,
  () => false,
);
if (caseInsensitive) {
  await writeJobs(caseDir, [{ id: 'case-job', status: 'pending', startedAt: Date.now() }]);
  const movedCase = await migratePendingJobs(caseDir, caseAlias);
  assert.equal(movedCase, 0, 'a case-alias of the same directory is a no-op, not a migration');
  const stillThereCase = await readJobs(caseDir);
  assert.ok(
    stillThereCase.find((j) => j.id === 'case-job'),
    'the pending record survives a migration call where fromDir and toDir are the same directory under different case',
  );
} else {
  console.log('  (skipping the case-alias check: this filesystem is case-sensitive)');
}
await fs.rm(caseBase, { recursive: true, force: true });

// Symlink alias: works on every platform, unlike the case one above, which is
// why it stands on its own rather than as a fallback for the skip above.
const symlinkBase = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-symlink-'));
const realDir = path.join(symlinkBase, 'real');
await fs.mkdir(realDir);
const symlinkAlias = path.join(symlinkBase, 'alias');
await fs.symlink(realDir, symlinkAlias, 'dir');
await writeJobs(realDir, [{ id: 'symlink-job', status: 'pending', startedAt: Date.now() }]);
const movedSymlink = await migratePendingJobs(realDir, symlinkAlias);
assert.equal(movedSymlink, 0, 'a symlink alias of the same directory is a no-op, not a migration');
const stillThereSymlink = await readJobs(realDir);
assert.ok(
  stillThereSymlink.find((j) => j.id === 'symlink-job'),
  'the pending record survives a migration call where toDir is a symlink to fromDir',
);
await fs.rm(symlinkBase, { recursive: true, force: true });

// ---- readJobsStrict ----
// readJobs answers [] for a missing file, corrupt JSON and an unreadable path
// alike, which is right for booting the sweep and lethal for a mutation: "0
// pending" read out of a damaged store is indistinguishable from "nothing is in
// flight", and acting on it orphans every render the store was tracking.
const strictDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-strict-'));
assert.deepEqual(await readJobsStrict(strictDir), [],
  'a missing file is genuinely nothing saved yet -- the one case that stays lenient');
await writeJobs(strictDir, [job]);
assert.deepEqual(await readJobsStrict(strictDir), [job], 'a readable store round-trips');
await fs.writeFile(jobsPath(strictDir), '{not json');
await assert.rejects(() => readJobsStrict(strictDir), 'corrupt JSON throws instead of reading as empty');
await fs.writeFile(jobsPath(strictDir), '{"oops": true}');
await assert.rejects(() => readJobsStrict(strictDir), 'valid JSON that is not an array throws too');
await fs.rm(jobsPath(strictDir));
await fs.mkdir(jobsPath(strictDir)); // a directory where the file belongs
await assert.rejects(() => readJobsStrict(strictDir), 'an unreadable path throws');
await fs.rm(jobsPath(strictDir), { recursive: true });
await fs.rm(strictDir, { recursive: true, force: true });

// ---- pendingJobsFor ----
const mixed = [
  { id: 'p-a', status: 'pending', project: 'alpha', startedAt: now },
  { id: 'p-a2', status: 'pending', project: 'alpha', startedAt: now },
  { id: 'p-b', status: 'pending', project: 'beta', startedAt: now },
  { id: 'p-root', status: 'pending', project: '', startedAt: now },
  { id: 'p-none', status: 'pending', startedAt: now },
  { id: 'd-a', status: 'done', project: 'alpha', startedAt: now, resolvedAt: now },
];
assert.deepEqual(pendingJobsFor(mixed, 'alpha').map((j) => j.id), ['p-a', 'p-a2'],
  'one project, pending only -- a done record cannot be stranded by an action');
assert.deepEqual(pendingJobsFor(mixed, '').map((j) => j.id), ['p-root', 'p-none'],
  'a missing project field and an empty one are the same "no project"');
assert.deepEqual(pendingJobsFor(mixed).map((j) => j.id).sort(),
  ['p-a', 'p-a2', 'p-b', 'p-none', 'p-root'], 'no project argument means every pending record');

// ---- copyPendingJobs / dropPendingJobs: the two halves of a committed move ----
// Split so the caller can copy, commit its own change, and only then strip the
// source -- so a failure between the two duplicates a record rather than losing it.
const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-src-'));
const dstDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-dst-'));
await writeJobs(srcDir, mixed);
const copied = await copyPendingJobs(srcDir, dstDir);
assert.equal(copied.count, 5, 'every pending record is copied, whatever project it belongs to');
assert.deepEqual(copied.ids.sort(), ['p-a', 'p-a2', 'p-b', 'p-none', 'p-root'],
  'and it reports exactly which, so the caller can strip precisely those later');
assert.equal((await readJobs(dstDir)).length, 5, 'the destination holds them');
assert.equal((await readJobs(srcDir)).length, 6, 'and the SOURCE is untouched -- copy, not move');

// A job created after the copy must survive the strip: ids, not "all pending".
await persistJob(srcDir, 'p-late', { status: 'pending', project: 'alpha' });
assert.equal(await dropPendingJobs(srcDir, copied.ids), 5, 'drops exactly what was copied');
const afterDrop = await readJobs(srcDir);
assert.deepEqual(afterDrop.map((j) => j.id).sort(), ['d-a', 'p-late'],
  'the done record and a render started after the copy both stay');
assert.equal(await dropPendingJobs(srcDir, copied.ids), 0, 'a second drop is a no-op');
await fs.rm(srcDir, { recursive: true, force: true });
await fs.rm(dstDir, { recursive: true, force: true });

// The same-directory guard lives on the copy half.
const aliasDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-alias-'));
await writeJobs(aliasDir, mixed);
const aliasLink = path.join(path.dirname(aliasDir), `${path.basename(aliasDir)}-link`);
await fs.symlink(aliasDir, aliasLink);
assert.equal((await copyPendingJobs(aliasDir, aliasLink)).count, 0,
  'two paths naming one directory copy nothing rather than round-tripping the file');
assert.equal((await readJobs(aliasDir)).length, 6, 'and nothing is lost');
await fs.unlink(aliasLink);
await fs.rm(aliasDir, { recursive: true, force: true });

// dropPendingJobs' `status === 'pending'` guard is the whole reason the drop
// half is safe: a render that finishes in the SOURCE between the copy and the
// drop must not then be deleted by a drop call that still names its id --
// that would erase the very record the store just collected a result for.
const raceSrcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-race-src-'));
const raceDstDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-race-dst-'));
await writeJobs(raceSrcDir, mixed);
const raceCopied = await copyPendingJobs(raceSrcDir, raceDstDir);
// Simulate the render finishing in the source while the caller is still
// committing its own change, before the drop call ever runs.
const raceJobs = await readJobs(raceSrcDir);
await writeJobs(
  raceSrcDir,
  raceJobs.map((j) => (j.id === 'p-a' ? { ...j, status: 'done', resolvedAt: Date.now() } : j)),
);
const raceDropped = await dropPendingJobs(raceSrcDir, raceCopied.ids);
assert.equal(raceDropped, 4, 'the record that finished mid-move is excluded from the drop count');
const raceAfter = await readJobs(raceSrcDir);
const survived = raceAfter.find((j) => j.id === 'p-a');
assert.ok(survived, 'a render that finished between the copy and the drop is not deleted from the store that just collected it');
assert.equal(survived.status, 'done', 'and its done status is left intact, not reverted to pending or removed');
await fs.rm(raceSrcDir, { recursive: true, force: true });
await fs.rm(raceDstDir, { recursive: true, force: true });

// A same-id collision in the destination must replace, not duplicate -- two
// records for one render id would be polled twice and could be collected
// twice, writing the clip to disk under two different timestamps.
const collideSrcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-collide-src-'));
const collideDstDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-collide-dst-'));
await writeJobs(collideSrcDir, mixed);
await writeJobs(collideDstDir, [
  { id: 'p-a', status: 'pending', project: 'alpha', startedAt: now, marker: 'stale-destination-copy' },
]);
await copyPendingJobs(collideSrcDir, collideDstDir);
const collideDest = await readJobs(collideDstDir);
assert.equal(collideDest.length, 5, 'the destination gains no extra row for the colliding id');
const collidedMatches = collideDest.filter((j) => j.id === 'p-a');
assert.equal(collidedMatches.length, 1, 'exactly one record for the colliding id, not two');
assert.equal(collidedMatches[0].marker, undefined, "the source's version replaces the destination's stale one");
await fs.rm(collideSrcDir, { recursive: true, force: true });
await fs.rm(collideDstDir, { recursive: true, force: true });

// ---- failPendingJobs ----
const failDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-fail-'));
await writeJobs(failDir, mixed);
assert.equal(await failPendingJobs(failDir, { project: 'alpha', error: 'project deleted' }), 2,
  'reports how many renders it ended -- the number the confirmation copy shows');
const afterFail = await readJobs(failDir);
for (const id of ['p-a', 'p-a2']) {
  const j = afterFail.find((x) => x.id === id);
  assert.equal(j.status, 'failed', `${id} ends visibly instead of staying pending forever`);
  assert.equal(j.error, 'project deleted', 'and says why, so the node can show a reason');
  assert.ok(Number.isFinite(j.resolvedAt), 'resolvedAt is stamped so pruneJobs can drop it in seven days');
}
assert.equal(afterFail.find((x) => x.id === 'p-b').status, 'pending', "another project's render is untouched");
assert.equal(afterFail.find((x) => x.id === 'd-a').status, 'done', 'an already-done record is left alone');
assert.equal(await failPendingJobs(failDir, { project: 'alpha', error: 'again' }), 0, 'a second call reports zero');
await fs.rm(failDir, { recursive: true, force: true });

// ---- reassignPendingJobs ----
const moveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-reassign-'));
await writeJobs(moveDir, mixed);
assert.equal(await reassignPendingJobs(moveDir, 'alpha', 'alpha-renamed'), 2, 'reports how many it repointed');
const afterMove = await readJobs(moveDir);
assert.deepEqual(afterMove.filter((j) => j.project === 'alpha-renamed').map((j) => j.id).sort(),
  ['p-a', 'p-a2'], 'a pending render follows its project, so the clip lands where the user is looking');
assert.equal(afterMove.find((x) => x.id === 'd-a').project, 'alpha',
  'a done record keeps the name its files are already sitting under');
// Reversible, which is what lets the rename route compensate for a failed fs.rename.
assert.equal(await reassignPendingJobs(moveDir, 'alpha-renamed', 'alpha'), 2, 'and it reverses cleanly');
assert.equal((await readJobs(moveDir)).find((x) => x.id === 'p-a').project, 'alpha', 'back where it started');
await fs.rm(moveDir, { recursive: true, force: true });

// Every mutating helper refuses a damaged store rather than reading it as empty.
const brokenDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-broken-'));
await fs.writeFile(jobsPath(brokenDir), '{not json');
await assert.rejects(() => failPendingJobs(brokenDir, { project: 'x', error: 'y' }),
  'failPendingJobs refuses a damaged store');
await assert.rejects(() => reassignPendingJobs(brokenDir, 'x', 'y'), 'reassignPendingJobs refuses too');
await assert.rejects(() => copyPendingJobs(brokenDir, dir), 'and so does copyPendingJobs');
await assert.rejects(() => dropPendingJobs(brokenDir, ['x']), 'and dropPendingJobs too');
await fs.rm(brokenDir, { recursive: true, force: true });

await fs.rm(dir, { recursive: true, force: true });
console.log('jobs.test.js: ok');
