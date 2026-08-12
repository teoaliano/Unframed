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
} finally {
  child.kill();
  await fs.rm(dataDir, { recursive: true, force: true });
}

console.log('host.test.js: ok');
