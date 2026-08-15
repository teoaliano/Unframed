// node server/host.test.js  (also runs as part of `npm test`)
//
// Forks the real server the way the Electron shell will -- throwaway data dir,
// ephemeral port -- and asserts the contract the shell depends on. This is
// possible only because of that: pointing the server at a temp dir is what stops
// a test of it from running against the real .env and the real output folder.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
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

const child = fork(path.join(here, 'index.js'), {
  env: {
    ...process.env,
    UNFRAMED_DATA_DIR: dataDir,
    UNFRAMED_CLIENT_DIST: distDir,
    OUTPUT_DIR: outDir,
    PORT: '0',
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
  await fs.rm(dataDir, { recursive: true, force: true });
}

console.log('host.test.js: ok');
