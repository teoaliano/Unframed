# Native App — Engine Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Express server hostable by an Electron shell — writing its config outside the repo, serving the built canvas, taking an OS-assigned port, and reporting readiness — without changing anything about how the cloned repo behaves.

**Architecture:** Every change is gated behind an environment variable that is unset in a clone. `UNFRAMED_DATA_DIR` moves `.env` and the default output folder off the repo root; `UNFRAMED_CLIENT_DIST` mounts the built client; `PORT=0` takes an ephemeral port and reports it to the parent over the IPC channel `fork()` provides. That same channel carries reveal requests to the shell, replacing the `osascript` Apple Event that would otherwise force an entitlement and a consent prompt.

**Tech Stack:** Node 18+, Express 4, plain `node:assert` tests with no framework.

## Global Constraints

- **No behaviour change in the clone flow.** With none of the new environment variables set, the server must behave exactly as it does today. This is the property that keeps one Unframed instead of two.
- **No client changes.** Every call in `client/src/api.js` is already relative; serving the canvas from Express keeps the window same-origin.
- **No new dependencies.** Everything here uses `node:` built-ins and the Express already present.
- **Tests are plain `node` scripts** using `node:assert/strict`, ending in `console.log('<name>: ok')`, registered in the root `package.json` `test` script. No framework, no fixtures — match `server/env.test.js`.
- **Comments explain why, not what.** Match the density and voice of the surrounding code.
- Scope is Part 1 of `docs/superpowers/specs/2026-08-13-native-app-design.md`. The Electron shell is a separate plan in a separate repo.

## File Structure

| File | Responsibility |
| --- | --- |
| `server/env.js` (modify) | Gains `envFile(root)` and `outputPath(root, dir)` — the two path rules that decide where user data lands. Already the home for rules load-bearing enough to test. |
| `server/env.test.js` (modify) | Asserts both path rules, including that an absolute path passes through untouched. |
| `server/index.js` (modify) | Uses those two functions at five sites; mounts static; takes an ephemeral port; reports ready; routes reveal to the parent. |
| `server/host.test.js` (create) | Forks the real server the way the shell will and asserts what the shell depends on. Possible for the first time *because* of this work — a temp data dir and an ephemeral port are what made `index.js` untestable before. |
| `package.json` (modify) | Registers `host.test.js`. |
| `CLAUDE.md` (modify) | Documents hosted mode as a design decision. |

---

### Task 1: Move user data off the repo root

**Files:**
- Modify: `server/env.js`
- Modify: `server/env.test.js`
- Modify: `server/index.js:8,16,35,73,118,137`

**Interfaces:**
- Consumes: nothing.
- Produces: `envFile(root: string) => string` — absolute path to the `.env` file. `outputPath(root: string, dir?: string) => string` — absolute path to the output folder, where `dir` may be absolute, relative, or undefined.

- [ ] **Step 1: Write the failing test**

Append to `server/env.test.js`, before the final `console.log`:

```js
// Path rules. The default keeps a clone writing exactly where it always did;
// UNFRAMED_DATA_DIR moves both, because in a packaged app the repo root is a
// read-only bundle and a key written there would fail or vanish on update.
delete process.env.UNFRAMED_DATA_DIR;
assert.equal(envFile('/repo'), '/repo/.env');
assert.equal(outputPath('/repo'), '/repo/output');
assert.equal(outputPath('/repo', './output'), '/repo/output');

// An absolute output dir passes through untouched -- what the folder picker
// returns and what the packaged app always supplies.
assert.equal(outputPath('/repo', '/Users/me/Pictures/Unframed'), '/Users/me/Pictures/Unframed');

process.env.UNFRAMED_DATA_DIR = '/data';
assert.equal(envFile('/repo'), '/data/.env');
assert.equal(outputPath('/repo', './output'), '/data/output');
assert.equal(outputPath('/repo', '/abs'), '/abs');
delete process.env.UNFRAMED_DATA_DIR;
```

And extend the import on line 3:

```js
import { upsertEnv, PATTERNS, envFile, outputPath } from './env.js';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node server/env.test.js`
Expected: FAIL — `SyntaxError` or `TypeError: envFile is not a function`, because neither export exists yet.

- [ ] **Step 3: Write the implementation**

At the top of `server/env.js`, add the import:

```js
import path from 'node:path';
```

At the end of `server/env.js`, add:

```js
// Where user data lives. Defaults to the project root, which is right for a
// clone; a packaged app points UNFRAMED_DATA_DIR at a writable directory,
// because there the root is inside a read-only bundle. Both rules live here
// rather than at their call sites so the read path and the write path cannot
// drift -- writing .env somewhere the next boot does not read it loses the key
// silently.
export const envFile = (root) => path.join(process.env.UNFRAMED_DATA_DIR || root, '.env');

// An absolute dir passes through untouched, which is what the folder picker and
// the packaged app both hand in; a relative one lands under the data dir.
export const outputPath = (root, dir) =>
  path.resolve(process.env.UNFRAMED_DATA_DIR || root, dir || './output');
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node server/env.test.js`
Expected: PASS — `env.test.js: ok`

- [ ] **Step 5: Wire the five call sites in `server/index.js`**

Line 8, extend the import:

```js
import { upsertEnv, PATTERNS, envFile, outputPath } from './env.js';
```

Line 16, replace:

```js
dotenv.config({ path: path.join(ROOT, '.env'), override: true });
```

with:

```js
dotenv.config({ path: envFile(ROOT), override: true });
```

Line 35, replace:

```js
let OUTPUT_DIR = path.resolve(ROOT, process.env.OUTPUT_DIR || './output');
```

with:

```js
let OUTPUT_DIR = outputPath(ROOT, process.env.OUTPUT_DIR);
```

Lines 72-76, replace the whole function (the local `const envPath` would shadow the import):

```js
async function writeEnv(updates) {
  const file = envFile(ROOT);
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  await fs.writeFile(file, upsertEnv(text, updates));
}
```

Line 118, replace `const dir = path.resolve(ROOT, updates.OUTPUT_DIR);` with:

```js
    const dir = outputPath(ROOT, updates.OUTPUT_DIR);
```

Line 137, replace `if (updates.OUTPUT_DIR) OUTPUT_DIR = path.resolve(ROOT, updates.OUTPUT_DIR);` with:

```js
  if (updates.OUTPUT_DIR) OUTPUT_DIR = outputPath(ROOT, updates.OUTPUT_DIR);
```

- [ ] **Step 6: Verify the clone flow is unchanged**

Run: `npm test`
Expected: PASS, all suites.

Run: `npm run server`
Expected: the same startup banner as before, `output:` still pointing at `<repo>/output`, no errors. Stop it with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add server/env.js server/env.test.js server/index.js
git commit -m "Anchor user data to an overridable data dir"
```

---

### Task 2: Hosted mode — static canvas, ephemeral port, ready signal

**Files:**
- Modify: `server/index.js:41,943-952`
- Create: `server/host.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `envFile`, `outputPath` from Task 1.
- Produces: the parent-process contract — the server sends `{ type: 'ready', port: number }` on `process.send` once listening. Reads `UNFRAMED_CLIENT_DIST` (absolute path to a built client) and `PORT` (`'0'` for an OS-assigned port).

- [ ] **Step 1: Write the failing test**

Create `server/host.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node server/host.test.js`
Expected: FAIL — `no ready message within 10000ms`, because the server never calls `process.send`.

- [ ] **Step 3: Mount the built client**

In `server/index.js`, immediately after the `express.json` middleware on line 41, add:

```js
// A packaged app serves the canvas from the same origin as the API, so the window
// needs no CORS and no file:// handling. Unset in a clone, where Vite serves it
// on 5173 and proxies /api here.
if (process.env.UNFRAMED_CLIENT_DIST) app.use(express.static(process.env.UNFRAMED_CLIENT_DIST));
```

- [ ] **Step 4: Take an ephemeral port and report it**

Replace the `app.listen(PORT, () => {` line (943) with:

```js
// PORT=0 asks the OS for any free port, which is how the packaged app avoids
// fighting whatever else is on 8787. The parent cannot guess it, so it is
// reported back over the IPC channel fork() provides.
const server = app.listen(PORT, () => {
  const { port } = server.address();
```

and inside that callback, replace the first `console.log` line with:

```js
  console.log(`\n  Unframed server  →  http://localhost:${port}`);
```

Then, at the end of the same callback (after the `output:` line, before the closing `});`), add:

```js
  process.send?.({ type: 'ready', port });
```

Line 18 also needs `PORT` coerced, since env values are strings:

```js
const PORT = Number(process.env.PORT ?? 8787);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node server/host.test.js`
Expected: PASS — `host.test.js: ok`

- [ ] **Step 6: Register it in the test script**

In `package.json`, append ` && node server/host.test.js` to the `test` script.

- [ ] **Step 7: Verify the clone flow is unchanged**

Run: `npm test`
Expected: PASS, all suites including the new one.

Run: `npm run server`
Expected: the banner still says `http://localhost:8787` — no env vars set means the old behaviour. Stop with Ctrl-C.

- [ ] **Step 8: Commit**

```bash
git add server/index.js server/host.test.js package.json
git commit -m "Let the server be hosted: static canvas, ephemeral port, ready signal"
```

---

### Task 3: Route reveal through the parent

**Files:**
- Modify: `server/index.js:750-780`
- Modify: `server/host.test.js`

**Interfaces:**
- Consumes: the parent-process contract from Task 2.
- Produces: the server sends `{ type: 'reveal', files: string[] }` when hosted. `files` holds absolute paths that exist on disk; when none of the requested names exist it holds the single containing directory.

- [ ] **Step 1: Write the failing test**

In `server/host.test.js`, inside the `try` block, after the `.env` assertion, add:

```js
  // Hosted, reveal goes to the parent instead of spawning osascript. That is
  // what keeps the app free of the Apple Events entitlement and the "wants to
  // control Finder" consent prompt -- and it is why this assertion does not
  // open a Finder window while the tests run.
  await fs.writeFile(path.join(outDir, 'shot.png'), 'x');
  const revealed = waitFor('reveal');
  const res = await fetch(`${base}/api/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'shot.png' }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await revealed).files, [path.join(outDir, 'shot.png')]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node server/host.test.js`
Expected: FAIL — `no reveal message within 10000ms`. A Finder window may open during this run; that is the behaviour being replaced.

- [ ] **Step 3: Write the implementation**

In `server/index.js`, in the `/api/reveal` handler, immediately after the loop that builds `files` and before the `if (process.platform === 'darwin')` branch, add:

```js
  // Hosted by the shell: hand the paths over rather than driving the OS here.
  // The shell's showItemInFolder covers all three platforms, so this one seam
  // replaces all three branches below -- and, on macOS, removes the Apple Event
  // that would otherwise need an entitlement and a first-run consent prompt.
  if (process.send) {
    const targets = files.length ? files : [dir];
    process.send({ type: 'reveal', files: targets });
    return res.json({ ok: true, revealed: files.length || 'folder' });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node server/host.test.js`
Expected: PASS — `host.test.js: ok`, and no Finder window opens.

- [ ] **Step 5: Verify the clone flow is unchanged**

Run: `npm test`
Expected: PASS, all suites.

Reveal still works in a clone: `npm run dev`, generate or open a project with output, click the reveal button, confirm Finder opens. `npm run server` has no parent, so `process.send` is undefined and the `osascript` path runs as before.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Route reveal through the parent process when hosted"
```

---

### Task 4: Document hosted mode and tag the engine

**Files:**
- Modify: `CLAUDE.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: everything above.
- Produces: the tag `engine-v0.2.0`, which the shell repo pins.

- [ ] **Step 1: Document the design decision**

In `CLAUDE.md`, under **Key design decisions**, after the `.env` funnel bullet, add:

```markdown
- **The server runs headless or hosted, on one code path.** Three environment
  variables, all unset in a clone, let an Electron shell host it: `UNFRAMED_DATA_DIR`
  moves `.env` and the default output folder off the repo root (in a bundle that
  root is read-only), `UNFRAMED_CLIENT_DIST` serves the built canvas from the same
  origin as the API, and `PORT=0` takes an OS-assigned port reported back with
  `process.send({ type: 'ready', port })`. The same channel carries
  `{ type: 'reveal', files }`, so the shell calls `shell.showItemInFolder` and the
  app never sends the Apple Event that would need an entitlement and a consent
  prompt. Gating on env vars rather than forking the file is deliberate: a second
  code path is a second Unframed, and every feature would have to be built twice.
  `server/host.test.js` forks the real server to prove the contract — which is
  possible only because a temp data dir and an ephemeral port are exactly what
  made `index.js` untestable before.
```

- [ ] **Step 2: Note the new test in the Commands section**

In `CLAUDE.md:21`, replace:

```
`npm test` runs `client/src/graph/resolve.test.js` plus `server/env.test.js`, `share.test.js` and `presets.test.js` — plain `node`, no test framework, no fixtures.
```

with:

```
`npm test` runs `client/src/graph/resolve.test.js` plus `server/env.test.js`, `share.test.js`, `presets.test.js` and `host.test.js` — plain `node`, no test framework, no fixtures.
```

- [ ] **Step 3: Bump the version**

In `package.json`, set `"version": "0.2.0"`.

- [ ] **Step 4: Verify everything still passes**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit and tag**

```bash
git add CLAUDE.md package.json
git commit -m "Document hosted mode, bump to 0.2.0"
git tag engine-v0.2.0
```

Do **not** create a GitHub Release for this tag. Per the spec, engine versions are plain git tags; only app versions get Releases, because `electron-updater` reads the latest Release and expects installers attached to it.

---

## What this plan does not cover

The Electron shell — the private `unframed-app` repo, `electron-builder` config, signing, notarization, auto-update and CI. That is a separate plan, and it cannot start until two manual steps are done: choosing the bundle identifier and creating the private repo (steps 1 and 2 of the spec's manual section).

`/api/pick-folder` deliberately stays on `osascript`. Its only flaw is that the dialog can open behind the window, and fixing it needs request/response plumbing rather than the fire-and-forget send used for reveal.
