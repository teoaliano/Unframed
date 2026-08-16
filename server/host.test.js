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

const waitFor = (type, ms = 10000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${type} message within ${ms}ms`)), ms);
    child.on('message', (m) => {
      if (m?.type === type) {
        clearTimeout(timer);
        resolve(m);
      }
    });
  });

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

console.log('host.test.js: ok');
