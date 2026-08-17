// node server/host.test.js  (also runs as part of `npm test`)
//
// Forks the real server the way the Electron shell will -- throwaway data dir,
// ephemeral port -- and asserts the contract the shell depends on. This is
// possible only because of that: pointing the server at a temp dir is what stops
// a test of it from running against the real .env and the real output folder.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-host-'));
const distDir = path.join(dataDir, 'dist');
const outDir = path.join(dataDir, 'out');
await fs.mkdir(distDir);
await fs.mkdir(outDir);
await fs.writeFile(path.join(distDir, 'index.html'), '<title>canvas</title>');

// A stand-in for OpenRouter's video-status endpoint. There is no honest way to
// make the REAL OpenRouter answer "expired", or a status it has never used, on
// demand -- so this is what lets the terminal-status test below exercise the
// server's actual route and actual classify-and-persist logic instead of
// asserting against a value the test just made up. Only the status GET is
// stubbed (server/index.js reads its base from UNFRAMED_TEST_VIDEOS_STATUS_BASE,
// unset -- and therefore inert -- in every real environment); job creation and
// download still go to the real openrouter.ai and are exercised further down
// expecting the 401 a fake key earns.
const STATUS_STUB_RESPONSES = {
  'expired-job': { status: 'expired', error: 'Job exceeded maximum time to live' },
  'still-going-job': { status: 'queued' }, // a status this server has never named
};
const statusStub = http.createServer((req, res) => {
  const id = decodeURIComponent(req.url.split('/').pop());
  const body = STATUS_STUB_RESPONSES[id];
  res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body || { error: `no stub for ${id}` }));
});
await new Promise((resolve) => statusStub.listen(0, '127.0.0.1', resolve));
const statusStubBase = `http://127.0.0.1:${statusStub.address().port}/api/v1/videos`;

const child = fork(path.join(here, 'index.js'), {
  env: {
    ...process.env,
    UNFRAMED_DATA_DIR: dataDir,
    UNFRAMED_CLIENT_DIST: distDir,
    OUTPUT_DIR: outDir,
    PORT: '0',
    UNFRAMED_TEST_VIDEOS_STATUS_BASE: statusStubBase,
  },
  stdio: 'ignore',
});

// Factored out so the sweep-staleness test further down (its own forked
// server, its own 'ready' message) can wait on a different child without a
// second copy of this.
const waitForMessage = (proc, type, ms = 10000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${type} message within ${ms}ms`)), ms);
    proc.on('message', (m) => {
      if (m?.type === type) {
        clearTimeout(timer);
        resolve(m);
      }
    });
  });
const waitFor = (type, ms) => waitForMessage(child, type, ms);

try {
  const ready = await waitFor('ready');

  // An OS-assigned port, reported back -- the shell cannot guess it.
  assert.ok(Number.isInteger(ready.port) && ready.port > 0, 'ready carries a real port');
  assert.notEqual(ready.port, 8787, 'PORT=0 means ephemeral, not the default');

  const base = `http://127.0.0.1:${ready.port}`;

  // The API answers on that port.
  assert.equal((await fetch(`${base}/api/health`)).status, 200);

  // ...and the built canvas is served from the same origin, which is what
  // spares the window CORS and file:// handling.
  const page = await fetch(`${base}/index.html`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /canvas/);

  // A setting saved from the UI lands in the data dir, not in the repo.
  const put = await fetch(`${base}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageModel: 'openai/gpt-image-2' }),
  });
  assert.equal(put.status, 200);
  assert.match(
    await fs.readFile(path.join(dataDir, '.env'), 'utf8'),
    /OPENROUTER_IMAGE_MODEL=openai\/gpt-image-2/,
  );

  // Hosted, reveal goes to the parent instead of spawning osascript. That is what
  // keeps the app free of the Apple Events entitlement and the "wants to control
  // Finder" consent prompt -- and it is why this assertion does not open a Finder
  // window while the tests run.
  await fs.writeFile(path.join(outDir, 'shot.png'), 'x');
  const revealed = waitFor('reveal');
  const res = await fetch(`${base}/api/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'shot.png' }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await revealed).files, [path.join(outDir, 'shot.png')]);

  // A null where the client always sends an array used to take the whole process
  // down, so what is asserted is not what these routes reply -- it is that the
  // server is still answering afterwards.
  //
  // Both routes return on a missing key before they ever read the body, so a fake
  // one goes in first. Checking its hint is load-bearing, not decoration: `fork`
  // inherits this shell's environment, so on a machine with OPENROUTER_API_KEY
  // exported, a key that failed to apply means two billed generations, not two 401s.
  const fakeKey = 'sk-or-v1-0000000000000000000000000000000000000000000000000000';
  const keyed = await fetch(`${base}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: fakeKey }),
  });
  assert.equal(keyed.status, 200);
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.keyHint, '0000', 'the live key is the fake one, not an inherited real one');

  // The anti-double-collection guard (2026-08-15 review, Important 3/4 and the
  // step-4 requirement it fixed): GET /api/video/:id must consult the job store
  // BEFORE ever touching OpenRouter, so a job already `done` is served straight
  // from there instead of being polled and re-downloaded. Seed the store the
  // way the sweep (or an earlier poll) would have left it. The fake key set
  // above would turn any REAL upstream call into a 401 within milliseconds --
  // this asserts the happy response instead, which is only possible if
  // OpenRouter was never actually asked.
  const savedClipPath = path.join(outDir, 'already-rendered.mp4');
  await fs.writeFile(savedClipPath, 'not a real mp4 but bytes are bytes');
  await fs.writeFile(
    path.join(outDir, 'jobs.json'),
    JSON.stringify([
      {
        id: 'already-done-job',
        project: '',
        params: { prompt: 'a cat on a skateboard', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now(),
        resolvedAt: Date.now(),
        status: 'done',
        savedPath: savedClipPath,
        cost: 0.42,
      },
    ]),
  );
  const doneRes = await fetch(`${base}/api/video/already-done-job`);
  assert.equal(doneRes.status, 200);
  const doneBody = await doneRes.json();
  assert.equal(
    doneBody.status,
    'completed',
    'a job already done in the store answers completed straight away, with no upstream round trip',
  );
  assert.equal(doneBody.savedPath, savedClipPath, 'and hands back the already-saved path rather than downloading again');

  // Task 14 (2026-08-15 plan, docs/superpowers/plans/2026-08-15-video-input-mode.md):
  // a terminal upstream status must end the job, whatever string the provider
  // used for it. Seed two `pending` records -- what the sweep or an earlier
  // poll would have left -- and let this route actually poll. The status stub
  // above answers in place of OpenRouter, so this exercises the real
  // classify-and-persist code in server/index.js rather than a value the test
  // invented; reverting the fix (recognising only completed/failed) makes both
  // assertions below fail.
  await fs.writeFile(
    path.join(outDir, 'jobs.json'),
    JSON.stringify([
      {
        id: 'expired-job',
        project: '',
        params: { prompt: 'a job that outlived its own time limit', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now(),
        status: 'pending',
      },
      {
        id: 'still-going-job',
        project: '',
        params: { prompt: 'a job still actually rendering', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now(),
        status: 'pending',
      },
    ]),
  );

  // `expired` must take exactly the path `failed` always took: the provider's
  // own message survives verbatim (a generic "Generation failed." would hide
  // the one fact -- it hit its own time limit -- the user actually needs), and
  // the record itself flips to `failed` so sweepJobs (which only re-polls
  // `pending` records) leaves it alone for good.
  const expiredRes = await fetch(`${base}/api/video/expired-job`);
  assert.equal(expiredRes.status, 200);
  const expiredBody = await expiredRes.json();
  assert.equal(expiredBody.status, 'failed', 'an expired job reads as failed to the client');
  assert.equal(
    expiredBody.error,
    'Job exceeded maximum time to live',
    "the provider's own message survives, not a generic one",
  );
  const jobsAfterExpiry = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  const expiredRecord = jobsAfterExpiry.find((j) => j.id === 'expired-job');
  assert.equal(expiredRecord.status, 'failed', 'the store is updated too, not just the response');
  assert.ok(expiredRecord.resolvedAt, 'resolvedAt is stamped so pruneJobs can eventually drop the record');

  // A status this server has never named must NOT be folded into failure --
  // a provider is far more likely to add a new in-flight status than a new
  // terminal one, and failing a job that is still actually rendering would
  // throw away money. It stays pending exactly as it was, and the raw status
  // string rides along in the response so it reads as unusual rather than as
  // ordinary progress.
  const stillGoingRes = await fetch(`${base}/api/video/still-going-job`);
  assert.equal(stillGoingRes.status, 200);
  const stillGoingBody = await stillGoingRes.json();
  assert.equal(stillGoingBody.status, 'queued', 'an unrecognised status is forwarded as-is, not normalised away');
  const jobsAfterStillGoing = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  assert.equal(
    jobsAfterStillGoing.find((j) => j.id === 'still-going-job').status,
    'pending',
    'an unrecognised status leaves the job record untouched -- still eligible for the next sweep',
  );

  // Changing the output folder must not orphan a render in flight. The store
  // lives at <OUTPUT_DIR>/jobs.json and the sweep only reads the CURRENT dir,
  // so before this fix a pending record simply stopped being polled the moment
  // the folder changed -- paid for, finished upstream, never collected. Pending
  // records move with the setting; done/failed stay behind as the old folder's
  // history.
  const outDir2 = path.join(dataDir, 'out2');
  await fs.writeFile(
    path.join(outDir, 'jobs.json'),
    JSON.stringify([
      {
        id: 'mid-render-move-job',
        project: '',
        params: { prompt: 'a render surviving a folder move', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now(),
        status: 'pending',
      },
      {
        id: 'already-history-job',
        project: '',
        params: { prompt: 'old history stays put', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now(),
        resolvedAt: Date.now(),
        status: 'done',
        savedPath: path.join(outDir, 'history.mp4'),
      },
    ]),
  );
  const moved = await fetch(`${base}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputDir: outDir2 }),
  });
  assert.equal(moved.status, 200);
  const newStore = JSON.parse(await fs.readFile(path.join(outDir2, 'jobs.json'), 'utf8'));
  const movedRecord = newStore.find((j) => j.id === 'mid-render-move-job');
  assert.ok(movedRecord, 'the pending job is tracked in the NEW folder');
  assert.equal(movedRecord.status, 'pending', 'still pending -- the sweep keeps polling it');
  const oldStore = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  assert.equal(
    oldStore.find((j) => j.id === 'mid-render-move-job'),
    undefined,
    'the old store no longer lists it as pending, so a later switch back cannot double-collect',
  );
  assert.ok(
    oldStore.find((j) => j.id === 'already-history-job'),
    'done/failed history stays in the folder it belongs to',
  );
  // Point the server back at the first folder so the tests below run unchanged.
  const switchedBack = await fetch(`${base}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputDir: outDir }),
  });
  assert.equal(switchedBack.status, 200, 'the switch-back itself must succeed, or every test below runs against the wrong folder');

  // A folder change that cannot take its renders must FAIL, not report success
  // and leave them behind. A directory where the destination store belongs
  // makes copyPendingJobs' own readJobsStrict(toDir) fail (EISDIR) before any
  // write is ever attempted -- the deterministic way to make the destination
  // store unREADABLE, the same trick presets.test.js and jobs.test.js use for
  // unreadable paths.
  const blockedDir = path.join(dataDir, 'blocked');
  await fs.mkdir(blockedDir);
  await fs.mkdir(path.join(blockedDir, 'jobs.json'));
  const seedOne = () =>
    fs.writeFile(
      path.join(outDir, 'jobs.json'),
      JSON.stringify([{ id: 'must-not-be-orphaned', project: '', params: {}, startedAt: Date.now(), status: 'pending' }]),
    );
  await seedOne();
  const blocked = await fetch(`${base}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputDir: blockedDir }),
  });
  assert.equal(blocked.status, 500, 'a folder change that cannot move its pending renders fails');
  assert.match((await blocked.json()).error, /render/i, 'and says renders are why, not a raw errno');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'))
      .find((j) => j.id === 'must-not-be-orphaned')?.status,
    'pending', 'the render stays in the old store, still pending, still swept');
  assert.equal((await (await fetch(`${base}/api/health`)).json()).outputDir, outDir,
    'the live output folder did not move');
  assert.doesNotMatch(await fs.readFile(path.join(dataDir, '.env'), 'utf8'), /OUTPUT_DIR=.*blocked/,
    'and .env did not move either, so a restart cannot lose the render');

  // A damaged source store must refuse too. This is the case readJobs would
  // have read as "0 pending" and waved through, orphaning everything in it.
  await fs.writeFile(path.join(outDir, 'jobs.json'), '{not json');
  const damagedDest = path.join(dataDir, 'damaged-dest');
  const damaged = await fetch(`${base}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputDir: damagedDest }),
  });
  assert.equal(damaged.status, 500, 'an unreadable job store blocks the folder change');
  assert.match((await damaged.json()).error, /job store/i,
    'pinned to readJobsStrict refusing the damaged store, not just any 500 the route could produce (e.g. a writeEnv failure)');
  assert.equal((await (await fetch(`${base}/api/health`)).json()).outputDir, outDir,
    'and the folder stays put rather than moving on a store nobody could read');
  assert.doesNotMatch(await fs.readFile(path.join(dataDir, '.env'), 'utf8'), /OUTPUT_DIR=.*damaged-dest/,
    'and .env did not move either, same as the blocked-destination case above');
  await fs.writeFile(path.join(outDir, 'jobs.json'), '[]');

  await fs.mkdir(path.join(outDir, 'keepers'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'doomed'), { recursive: true });
  const seedJobs = () =>
    fs.writeFile(path.join(outDir, 'jobs.json'), JSON.stringify([
      { id: 'k-1', project: 'keepers', status: 'pending', startedAt: Date.now(), params: {} },
      { id: 'd-1', project: 'doomed', status: 'pending', startedAt: Date.now(), params: {} },
      { id: 'd-2', project: 'doomed', status: 'pending', startedAt: Date.now(), params: {} },
    ]));

  // Rename: the render follows the project instead of recreating the old folder.
  await seedJobs();
  assert.equal((await fetch(`${base}/api/projects/keepers/rename`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'keepers-renamed' }),
  })).status, 200);
  const afterRename = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  assert.equal(afterRename.find((j) => j.id === 'k-1').project, 'keepers-renamed', 'repointed at the new name');
  assert.equal(afterRename.find((j) => j.id === 'k-1').status, 'pending',
    'and still pending -- a rename does not cost the user their render');
  assert.equal(afterRename.find((j) => j.id === 'd-1').project, 'doomed', 'another project is untouched');

  // A rename that cannot repoint its records must not rename the folder either.
  await fs.writeFile(path.join(outDir, 'jobs.json'), '{not json');
  assert.equal((await fetch(`${base}/api/projects/keepers-renamed/rename`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'keepers-again' }),
  })).status, 500, 'an unreadable store blocks the rename');
  await fs.access(path.join(outDir, 'keepers-renamed'));
  await assert.rejects(fs.access(path.join(outDir, 'keepers-again')), 'and the folder did not move');

  // Rename rollback: a project with pending records but NO folder on disk makes
  // fs.rename itself fail (ENOENT), which is what exercises the rollback branch
  // rather than the earlier "store unreadable" branch above. The record must land
  // back at its OLD project name -- asserting only that a record still exists
  // would pass even if the rollback's two arguments were swapped and it "rolled
  // back" onto the new name instead, which is exactly the stranding this task
  // exists to prevent.
  await fs.writeFile(path.join(outDir, 'jobs.json'), JSON.stringify([
    { id: 'g-1', project: 'ghost', status: 'pending', startedAt: Date.now(), params: {} },
  ]));
  const ghostRename = await fetch(`${base}/api/projects/ghost/rename`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'ghost2' }),
  });
  assert.equal(ghostRename.status, 500, 'renaming a project with no folder on disk fails');
  assert.match((await ghostRename.json()).error, /could not rename/i);
  const afterGhostRollback = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  const ghostJob = afterGhostRollback.find((j) => j.id === 'g-1');
  assert.equal(ghostJob.project, 'ghost',
    'the rollback puts the record back at its OLD project name, not stranded at the new one it never reached');
  assert.equal(ghostJob.status, 'pending', 'and it is still pending, not lost');

  // Delete: refuses without confirmation, and says how many renders are at stake.
  await seedJobs();
  const refused = await fetch(`${base}/api/projects/doomed`, { method: 'DELETE' });
  assert.equal(refused.status, 409, 'deleting a project with renders in flight needs confirmation');
  assert.equal((await refused.json()).pendingRenders, 2, 'and says how many, so the dialog can name it');
  await fs.access(path.join(outDir, 'doomed'));

  const confirmed = await fetch(`${base}/api/projects/doomed?confirmRenders=1`, { method: 'DELETE' });
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).endedRenders, 2, 'reports what it ended');
  const afterDelete = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  for (const id of ['d-1', 'd-2']) {
    const j = afterDelete.find((x) => x.id === id);
    assert.equal(j.status, 'failed', 'a deleted project ends its renders rather than leaving them pending');
    assert.match(j.error, /deleted/i, 'and the reason names the deletion');
  }
  assert.equal(afterDelete.find((x) => x.id === 'k-1').status, 'pending', "another project's render survives");
  await assert.rejects(fs.access(path.join(outDir, 'doomed')), 'and the folder is gone');

  // Delete after a failed rm: records must already be ended before the rm is even
  // attempted, and a folder the rm cannot remove must not silently swallow that --
  // the response has to name BOTH facts, and the folder (still undeleted) has to
  // still be there for a retry. chmod 0o500 strips owner write from the directory
  // itself, so unlinking graph.json inside it fails with EACCES -- confirmed to
  // reproduce on this machine (not running as root, which would bypass the check)
  // before relying on it here.
  await fs.mkdir(path.join(outDir, 'unrmable'), { recursive: true });
  await fs.writeFile(path.join(outDir, 'unrmable', 'graph.json'), '{}');
  await fs.writeFile(path.join(outDir, 'jobs.json'), JSON.stringify([
    { id: 'u-1', project: 'unrmable', status: 'pending', startedAt: Date.now(), params: {} },
    { id: 'u-2', project: 'unrmable', status: 'pending', startedAt: Date.now(), params: {} },
  ]));
  await fs.chmod(path.join(outDir, 'unrmable'), 0o500);
  try {
    const rmFailed = await fetch(`${base}/api/projects/unrmable?confirmRenders=1`, { method: 'DELETE' });
    assert.equal(rmFailed.status, 500, 'a folder that cannot be removed is still reported as a failure');
    const rmFailedBody = await rmFailed.json();
    assert.match(rmFailedBody.error, /stopped 2 render/i, 'names the renders it already stopped');
    assert.match(rmFailedBody.error, /could not be deleted/i, 'and names that the folder deletion itself failed');
    const afterFailedRm = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
    for (const id of ['u-1', 'u-2']) {
      assert.equal(afterFailedRm.find((j) => j.id === id).status, 'failed',
        'records were already ended before the rm was even attempted');
    }
    await fs.access(path.join(outDir, 'unrmable')); // the folder is still there for a retry
  } finally {
    // Restore write access or the final `fs.rm(dataDir, ...)` cleanup at the
    // bottom of this file cannot remove it either.
    await fs.chmod(path.join(outDir, 'unrmable'), 0o700);
  }

  // A damaged store blocks the delete outright -- it cannot know what it would strand.
  await fs.mkdir(path.join(outDir, 'unknowable'), { recursive: true });
  await fs.writeFile(path.join(outDir, 'jobs.json'), '{not json');
  assert.equal((await fetch(`${base}/api/projects/unknowable?confirmRenders=1`, { method: 'DELETE' })).status, 500,
    'an unreadable store blocks the delete');
  await fs.access(path.join(outDir, 'unknowable')); // and the project survives

  // No renders in flight means no extra step.
  await fs.writeFile(path.join(outDir, 'jobs.json'), '[]');
  assert.equal((await fetch(`${base}/api/projects/unknowable`, { method: 'DELETE' })).status, 200,
    'no renders in flight means no confirmation');

  // Key removal ends every pending render, whatever project it belongs to.
  await seedJobs();
  const keyGone = await fetch(`${base}/api/key`, { method: 'DELETE' });
  assert.equal(keyGone.status, 200);
  assert.equal((await keyGone.json()).endedRenders, 3, 'reports how many renders it ended');
  for (const j of JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'))) {
    assert.equal(j.status, 'failed', 'every pending render ends');
    assert.match(j.error, /key/i, 'and the reason names the key');
  }

  // ...and the card polling that render finally learns about it. Ending the
  // record is only half the job: the node hears about a render exclusively
  // through this route, which used to answer 400 on a missing key BEFORE
  // consulting the store -- so the record said `failed` while the one route
  // that could have said so bounced the question for the very reason the record
  // existed, and the card read "Rendering..." until a reload. No key is needed
  // to read a resolved record, so the store answer comes first now. Nothing
  // upstream is contacted here: the store short-circuits before any poll.
  const polledAfterKeyGone = await fetch(`${base}/api/video/k-1`);
  assert.equal(polledAfterKeyGone.status, 200,
    'a resolved record is still readable with no key -- the store, not OpenRouter, holds the answer');
  const polledBody = await polledAfterKeyGone.json();
  assert.equal(polledBody.status, 'failed', 'so the node learns the render ended instead of spinning forever');
  assert.match(polledBody.error, /key/i, 'and shows the reason the record already recorded');

  // A job the store has never heard of still needs a key, since answering it
  // means asking OpenRouter -- the reorder above must not turn the key check off.
  assert.equal((await fetch(`${base}/api/video/never-heard-of-this-one`)).status, 400,
    'an unknown id with no key still refuses, rather than reaching upstream keyless');

  // A damaged store must NOT block removing a key -- that is a security action,
  // and a corrupt JSON file is no reason to make someone keep a leaked key.
  // The failure is reported instead of swallowed.
  await fetch(`${base}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: fakeKey }),
  });
  await fs.writeFile(path.join(outDir, 'jobs.json'), '{not json');
  const keyGoneAnyway = await fetch(`${base}/api/key`, { method: 'DELETE' });
  assert.equal(keyGoneAnyway.status, 200, 'the key is still removed');
  const keyBody = await keyGoneAnyway.json();
  assert.equal(keyBody.hasKey, false, 'and it really is gone');
  assert.ok(keyBody.renderCleanupError, 'but the failure to end renders is reported, not swallowed');

  await fetch(`${base}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: fakeKey }),
  });

  // Key REPLACEMENT ends nothing: usually a renewed key for the same account.
  await seedJobs();
  const replaced = await fetch(`${base}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'sk-or-v1-1111111111111111111111111111111111111111111111111111' }),
  });
  // Assert the replacement itself actually took, before trusting what it did NOT
  // do to the records -- otherwise a rejected PUT (say, a tightened key pattern)
  // would leave every record untouched for a reason that has nothing to do with
  // replacement-vs-removal, and this test would stay green while proving nothing.
  assert.equal(replaced.status, 200, 'the replacement PUT must succeed for this test to mean anything');
  assert.equal((await (await fetch(`${base}/api/health`)).json()).keyHint, '1111',
    'and the live key actually changed to the new one');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8')).filter((j) => j.status === 'pending').length,
    3, 'replacing the key leaves renders polling');
  await fetch(`${base}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: fakeKey }),
  });
  await fs.writeFile(path.join(outDir, 'jobs.json'), '[]');

  for (const route of ['/api/video', '/api/generate']) {
    // What this reaches upstream is a 401, or a connection error when offline.
    // Neither is under test, and neither should be able to hang the suite, hence
    // the abort and the empty catch.
    await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'null reference guard', input_references: null }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
    assert.equal(
      (await fetch(`${base}/api/health`)).status,
      200,
      `server survived a null input_references on ${route}`,
    );
  }

  // frame_images reaches the same route from the same browser and is normalised the
  // same way, so it gets the same guard and the same proof. Only /api/video reads it.
  await fetch(`${base}/api/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'null frame guard', frame_images: null }),
    signal: AbortSignal.timeout(4000),
  }).catch(() => {});
  assert.equal(
    (await fetch(`${base}/api/health`)).status,
    200,
    'server survived a null frame_images on /api/video',
  );
} finally {
  child.kill();
  await new Promise((resolve) => statusStub.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
}

// ---- sweep staleness (2026-08-17) ----
// sweepJobs takes ONE snapshot of the store per tick and used to hand that
// snapshot straight to collectVideo, instead of a fresh re-read, when a job
// turned out to be done. collectVideo resolves the output folder from
// `.project` (`projectDir`, mkdir'd with recursive:true) and only reads it
// AFTER downloading the clip -- so a rename landing between the tick's
// snapshot and that download recreated the OLD project folder, exactly the
// ghost-project bug reassignPendingJobs exists to prevent, just reopened by
// the sweep instead of the rename route.
//
// The running `child` above can't exercise this: the sweep only runs at boot
// and every 30s, and nothing exposes a way to trigger a tick on demand. So
// this forks a SECOND server with a pending job already sitting in its store,
// under project "alpha" -- sweepJobs() runs once at boot, synchronously
// queued (its store read is dispatched) before app.listen is even called, a
// few lines earlier in index.js than the 'ready' message this test waits on.
// A real rename can only reach this new server after that 'ready' message
// arrives (the socket isn't in LISTEN state, and therefore can't accept our
// connection, any earlier), so the ordering -- sweep reads first, our rename
// lands second -- holds by construction, not by luck. The status stub delays
// its "completed" answer well past the time the rename (real HTTP, real disk
// I/O) needs to land, giving the race a wide window rather than a tight one.
{
  const dataDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-sweep-race-'));
  const outDir2 = path.join(dataDir2, 'out');
  await fs.mkdir(outDir2, { recursive: true });
  // Must exist on disk, or the rename below fails at fs.rename (ENOENT) and
  // rolls back before the sweep ever gets a chance to race it.
  await fs.mkdir(path.join(outDir2, 'alpha'), { recursive: true });

  const raceJobId = 'sweep-race-job';
  await fs.writeFile(
    path.join(outDir2, 'jobs.json'),
    JSON.stringify([
      {
        id: raceJobId,
        project: 'alpha',
        params: { prompt: 'sweep staleness race', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now(),
        status: 'pending',
      },
    ]),
  );

  // Stands in for OpenRouter's status AND download endpoints. The status leg
  // answers "completed" after a delay long enough for the rename below to
  // land first; the download leg (whatever URL that answer points at) needs
  // no delay -- by the time it's fetched the race is already decided.
  let raceBase;
  const raceServer = http.createServer((req, res) => {
    if (req.url.startsWith('/api/v1/videos/')) {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'completed', unsigned_urls: [`${raceBase}/clip.mp4`] }));
      }, 1000);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    res.end('not a real mp4 but bytes are bytes');
  });
  await new Promise((resolve) => raceServer.listen(0, '127.0.0.1', resolve));
  raceBase = `http://127.0.0.1:${raceServer.address().port}`;

  const child2 = fork(path.join(here, 'index.js'), {
    env: {
      ...process.env,
      UNFRAMED_DATA_DIR: dataDir2,
      OUTPUT_DIR: outDir2,
      PORT: '0',
      // Ambient, not saved through /api/config -- read directly at module
      // load, before the boot sweep's first line runs, no upstream call ever
      // reaches a real OpenRouter with it.
      OPENROUTER_API_KEY: 'sk-or-v1-sweep-race-0000000000000000000000000000',
      UNFRAMED_TEST_VIDEOS_STATUS_BASE: `${raceBase}/api/v1/videos`,
    },
    stdio: 'ignore',
  });

  try {
    const ready2 = await waitForMessage(child2, 'ready');
    const base2 = `http://127.0.0.1:${ready2.port}`;

    const renamed = await fetch(`${base2}/api/projects/alpha/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'beta' }),
    });
    assert.equal(renamed.status, 200, 'the rename itself must succeed for this test to mean anything');
    assert.equal(
      JSON.parse(await fs.readFile(path.join(outDir2, 'jobs.json'), 'utf8')).find((j) => j.id === raceJobId)
        ?.project,
      'beta',
      'the record is repointed to the new name -- this part already passed before this fix',
    );

    // Now wait for the sweep to actually finish collecting it (the stub
    // answers after 1s, plus collectVideo's own download and writes).
    let finalRecord;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const jobs = JSON.parse(await fs.readFile(path.join(outDir2, 'jobs.json'), 'utf8').catch(() => '[]'));
      finalRecord = jobs.find((j) => j.id === raceJobId);
      if (finalRecord?.status === 'done') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(finalRecord?.status, 'done', 'the sweep collected the job within the deadline');

    // THE new assertion -- about collectVideo's input, which the sweep (not
    // the rename route) controls. Before the fix, sweepOneInner passed this
    // tick's stale snapshot (project "alpha") into collectVideo; after it,
    // it passes the freshly re-read record (project "beta"). This is what
    // must fail before the fix and pass after.
    assert.match(
      finalRecord.savedPath,
      /[\\/]beta[\\/]/,
      'the sweep saved the clip under the RENAMED project, not the tick\'s stale snapshot',
    );
    const ghostRecreated = await fs.access(path.join(outDir2, 'alpha')).then(() => true, () => false);
    assert.equal(
      ghostRecreated,
      false,
      'and did not recreate the old "alpha" folder as a ghost project',
    );
  } finally {
    child2.kill();
    await new Promise((resolve) => raceServer.close(resolve));
    await fs.rm(dataDir2, { recursive: true, force: true });
  }
}

console.log('host.test.js: ok');
