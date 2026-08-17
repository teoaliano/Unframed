# Render Lifecycle Close-Out and Run-Marker Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the video-render lifecycle for good — every paid render either lands on disk or visibly says why not, under every disruption a user can cause — and end the recurring "some copy path forgot a live marker" bug class by giving the two in-flight markers one home.

**Architecture:** Scope 1 is server-side: pending job records follow the output folder when it changes, the sweep's network calls get timeouts so one hung socket cannot stall collection, and `sweepOne` contains its own failures so one bad job costs only its own update. A disruption matrix in `docs/video-and-sharing.md` then declares the contract closed. Scope 2 is client-side: a new pure module `client/src/graph/runMarkers.js` owns the list of in-flight markers (`data.job`, `data.running`) and the two operations on them (strip for copies, prefer-live for undo); `save.js`, `insert.js` and `App.jsx`'s undo switch to it. This also fixes a live bug: undo can currently resurrect a stale `running` marker on image/text nodes and freeze their Run button until reload.

**Tech Stack:** Node 18+ built-in `fetch`/`AbortSignal`, plain-`node` assert tests (no framework), React 18 + React Flow client.

## Global Constraints

- Changes land by PR, never a direct push to `main` (CLAUDE.md rule 1).
- No new dependencies.
- Tests are plain `node` assert files run by `npm test`; nothing that spends money goes in a test (CLAUDE.md server bullet).
- Node components have no unit tests by design — verify in the running app and say so.
- `presets.json` is never migrated or rewritten (docs/library.md); anything captured there is permanent.
- Comments explain WHY, matching the surrounding density and voice.
- `CHANGELOG.md` gets a dated entry only for what a user would notice; headings `## YYYY-MM-DD`, groups `### Added/Changed/Fixed`.
- Every store write on the server goes through `persistJob` (`server/jobs.js`) — except where this plan explicitly justifies a raw `writeJobs` on a store nothing else writes to anymore.
- The triage rule (status.md): each fix here names its user action and its cost. Task 1: changes output folder mid-render / loses a paid render. Task 2–3: ride-alongs on files already open. Task 4–5: undo after a run / node frozen until reload, plus receipts (three prior bugs of the class).

---

### Task 1: Pending jobs follow the output folder

A user mid-render opens Settings and points output at a different folder (say, an external disk). Today the server reassigns `OUTPUT_DIR` and the sweep starts reading a fresh, empty `jobs.json` in the new folder — the render still in flight is orphaned in the old file: paid for, finished upstream, never collected, no error shown. Fix: when `OUTPUT_DIR` changes, move the `pending` records into the new store; `done`/`failed` stay behind as the old folder's history.

**Files:**
- Modify: `server/index.js` (import line ~10, and the `PUT /api/config` apply-block at ~line 137–142)
- Test: `server/host.test.js` (insert after the terminal-status block, before the null-guard section)

**Interfaces:**
- Consumes: `readJobs(dir)`, `writeJobs(dir, jobs)`, `persistJob(dir, id, patch)` from `server/jobs.js` (all exist).
- Produces: nothing new — behaviour only.

- [ ] **Step 1: Write the failing test**

In `server/host.test.js`, after the `jobsAfterStillGoing` assertions and before the `for (const route of ['/api/video', '/api/generate'])` loop, add:

```js
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
  await fetch(`${base}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputDir: outDir }),
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node server/host.test.js`
Expected: FAIL with `the pending job is tracked in the NEW folder` (either `ENOENT` reading `out2/jobs.json` or the assert itself — both prove the record did not move).

- [ ] **Step 3: Implement the migration**

In `server/index.js`, extend the jobs import (line ~10):

```js
import { readJobs, writeJobs, persistJob, givenUp } from './jobs.js';
```

Then replace the single line in the `PUT /api/config` apply-block:

```js
  if (updates.OUTPUT_DIR) OUTPUT_DIR = outputPath(ROOT, updates.OUTPUT_DIR);
```

with:

```js
  if (updates.OUTPUT_DIR) {
    const oldDir = OUTPUT_DIR;
    OUTPUT_DIR = outputPath(ROOT, updates.OUTPUT_DIR);
    // Pending jobs live in <dir>/jobs.json and the sweep only reads the CURRENT
    // dir, so a render still in flight when the folder changes would be orphaned
    // in the old file: paid for, finished upstream, never collected. Move the
    // pending records with the setting; done/failed stay behind as the old
    // folder's history. The raw writeJobs on the OLD store is deliberate and
    // safe: everything else writes through persistJob(OUTPUT_DIR, ...), which
    // from this line on points at the new dir -- nothing races the old file.
    // Best-effort on purpose: the setting itself already saved, and failing the
    // whole request over bookkeeping would leave the UI claiming the folder
    // change failed when it didn't.
    if (oldDir !== OUTPUT_DIR) {
      try {
        const old = await readJobs(oldDir);
        const pending = old.filter((j) => j.status === 'pending');
        for (const j of pending) await persistJob(OUTPUT_DIR, j.id, j);
        if (pending.length) {
          await writeJobs(oldDir, old.filter((j) => j.status !== 'pending'));
          console.log(`  moved ${pending.length} pending video job(s) to the new output folder`);
        }
      } catch (err) {
        console.log(`  could not move pending jobs to the new folder: ${err.message}`);
      }
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node server/host.test.js`
Expected: `host.test.js: ok`

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all six files report ok.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Move pending video jobs with the output folder"
```

---

### Task 2: The sweep cannot hang on one dead socket

Ride-along (triage rule: cosmetic/self-healing, done only because Task 1 already has these files open). The sweep's two `fetch` calls have no timeout, so a hung socket holds them for undici's ~5-minute default — and because jobs are swept sequentially under the `sweeping` flag, one dead connection stalls collection for every pending job behind it.

**Files:**
- Modify: `server/index.js` — `fetchVideoStatus` (~line 727) and `collectVideo`'s download fetch (~line 777)

**Interfaces:**
- Consumes: nothing new. `AbortSignal.timeout` is built into Node 18+.
- Produces: nothing new — an aborted status fetch lands in the existing `catch` and becomes `{ ok: false, networkError }`, which is exactly the "no answer" semantics the 24h give-up clock already counts.

- [ ] **Step 1: Add the signals**

In `fetchVideoStatus`:

```js
    r = await fetch(`${VIDEOS_STATUS_BASE}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      // A status check is one small JSON answer, and the sweep polls jobs one at
      // a time -- without a signal, one hung socket holds the line for undici's
      // ~5-minute default and stalls collection for every job behind it. 30s
      // matches the sweep's own cadence: slower than that IS no answer.
      signal: AbortSignal.timeout(30_000),
    });
```

In `collectVideo`:

```js
  const f = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    // A total-time cap, not an inactivity one: a big clip on a slow line still
    // fits comfortably in five minutes, and the failure this ends is the socket
    // that never answers at all. On abort the throw lands in the caller's
    // existing catch -- the sweep retries next tick, the poll route answers 502.
    signal: AbortSignal.timeout(300_000),
  });
```

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: all ok. (A genuine hang is not economically testable here — asserting it costs 30s+ of wall clock per run. The abort path reuses the not-ok branches that `host.test.js` already pins with the status stub; say this in the PR.)

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "Time out the sweep's upstream calls"
```

---

### Task 3: One bad job costs one update, not the rest of the tick

Ride-along, same justification. `sweepOne`'s comment promises "Never throws", but the failure-branch `persistJob` calls sit outside any try/catch — a rejected store write throws out of `sweepOne` and aborts the remaining jobs in that tick's for-loop (the process survives; both `sweepJobs()` call sites catch).

**Files:**
- Modify: `server/index.js` — `sweepOne` (~line 841)

**Interfaces:** nothing new — behaviour only.

- [ ] **Step 1: Wrap the body**

Rename the existing function to `sweepOneInner` and add a wrapper directly above it, so the existing body (and its heavily-commented branches) does not re-indent:

```js
// One pending job, one tick -- and one job's failure costs only ITS update.
// sweepOneInner's branches await persistJob in several places; a rejected store
// write there used to throw past the for-loop in sweepJobs and silently skip
// every job queued behind this one until the next tick. The wrapper is what
// makes the "never throws" promise in the comment below actually true.
async function sweepOne(job) {
  try {
    await sweepOneInner(job);
  } catch (err) {
    console.log(`  sweep failed for ${job.id}: ${err.message}`);
  }
}
```

Then change only the signature line of the existing function:

```js
async function sweepOneInner(job) {
```

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: all ok. (Inducing a `persistJob` rejection from outside the process is not cheaply possible — `readJobs` never throws, and breaking the directory breaks the seed too. This one is review-verified; say so in the PR.)

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "Contain a failed store write to its own job"
```

---

### Task 4: One home for the in-flight run markers

`data.job` (video) and `data.running` (image/text) are state owned by a live run, not by graph editing. Four mechanisms copy nodes — autosave, undo, presets, clipboard — and each currently hand-rolls its own handling in a separate place. Receipts for the funnel (triage rule): job-leaked-into-preset, job-lost-to-undo, and running-leaked-into-preset were three separate bugs fixed in three separate places within two days. This task creates the module and switches the two strip sites; Task 5 switches undo and fixes the fourth bug of the class.

**Files:**
- Create: `client/src/graph/runMarkers.js`
- Modify: `client/src/library/save.js` (~line 16–31), `client/src/library/insert.js` (~line 22–36)
- Test: `client/src/graph/resolve.test.js` (the save/insert strip assertions already exist and must stay green; add direct unit tests for the new module)

**Interfaces:**
- Produces (Task 5 relies on these exact names):
  - `RUN_MARKERS: string[]` — `['job', 'running']`
  - `stripRunMarkers(data: object) -> object` — copy with every marker set to `undefined`
  - `keepLiveRunMarkers(restored: Node[], live: Node[]) -> Node[]` — restored nodes take the live graph's marker values; nodes absent from `live` are returned unchanged

- [ ] **Step 1: Write the failing tests**

In `client/src/graph/resolve.test.js`, add to the imports:

```js
import { RUN_MARKERS, stripRunMarkers, keepLiveRunMarkers } from './runMarkers.js';
```

and add a new block after the existing `library/save.js: selection -> preset` block:

```js
// ---- graph/runMarkers.js: the one home for in-flight markers ----
{
  const data = { videoModel: 'seedance', job: { id: 'j1' }, running: { session: 's1' }, text: 'keep me' };
  const stripped = stripRunMarkers(data);
  assert.equal(stripped.job, undefined, 'job is stripped');
  assert.equal(stripped.running, undefined, 'running is stripped');
  assert.equal(stripped.text, 'keep me', 'ordinary data survives');
  assert.equal(data.job.id, 'j1', 'the input object is not mutated');

  // Undo restoring a snapshot from BEFORE Generate: the live job must survive.
  const live = [{ id: 'v', data: { job: { id: 'j-live' } } }];
  const restoredWithout = [{ id: 'v', data: { videoModel: 'seedance' } }];
  const kept = keepLiveRunMarkers(restoredWithout, live);
  assert.equal(kept[0].data.job.id, 'j-live', 'a live job survives an undo to before it started');
  assert.equal(kept[0].data.videoModel, 'seedance', 'the snapshot keeps its own content');

  // Undo restoring a snapshot from DURING a run that has since finished: the
  // stale marker must NOT come back -- this is the bug where a text node's Run
  // button froze until reload, because the mount-only session-id self-clear
  // never fires on an undo (no remount, same session).
  const liveDone = [{ id: 't', data: { result: 'answer' } }];
  const restoredMidRun = [{ id: 't', data: { running: { session: 's1' }, result: undefined } }];
  const cleared = keepLiveRunMarkers(restoredMidRun, liveDone);
  assert.equal(cleared[0].data.running, undefined, 'a finished run is not resurrected by undo');

  // A node undo is bringing back from a delete has no live counterpart: the
  // snapshot is all there is, and it keeps it.
  const ghost = keepLiveRunMarkers([{ id: 'gone', data: { job: { id: 'j-old' } } }], []);
  assert.equal(ghost[0].data.job.id, 'j-old', 'a node absent from the live graph keeps its snapshot');

  assert.deepEqual(RUN_MARKERS, ['job', 'running'], 'the list itself is the contract');
}
```

- [ ] **Step 2: Run to verify failure**

Run: `node client/src/graph/resolve.test.js`
Expected: FAIL — cannot resolve `./runMarkers.js`.

- [ ] **Step 3: Create the module**

Create `client/src/graph/runMarkers.js`:

```js
// The in-flight run markers that live inside node data: `job` (a video render
// the node is tracking -- see VideoOutputNode) and `running` (an image or text
// request in flight -- see ImageOutputNode/TextOutputNode). They are state
// owned by a LIVE run, not by graph editing, so every mechanism that copies
// nodes has to treat them specially:
//
//   - autosave PERSISTS them: a reload must be able to resume the run. That is
//     the default, so no code here does it.
//   - copy paths STRIP them (presets, the node clipboard): a copy of a node is
//     not a copy of its network traffic -- and presets.json is never rewritten
//     (docs/library.md), so a marker that leaks into one is permanent.
//   - undo/redo PREFERS THE LIVE VALUE: a snapshot from before a run started
//     must not strand it (spinner forever, no escape button), and one from
//     while it ran must not resurrect it after it finished (button frozen until
//     reload -- the session-stamp self-clear only runs on mount, and undo does
//     not remount).
//
// One home so the next marker, or the next mechanism that copies nodes, changes
// one file. Receipts: job-in-preset, job-lost-to-undo and running-in-preset
// were three separate bugs fixed at three separate call sites in two days
// before this module existed.
export const RUN_MARKERS = ['job', 'running'];

// For any path that copies a node out of the live graph.
export function stripRunMarkers(data) {
  const copy = { ...data };
  for (const k of RUN_MARKERS) copy[k] = undefined;
  return copy;
}

// For undo/redo. Restored nodes take the live graph's marker values; a node
// absent from the live graph (undo bringing it back from a delete) keeps what
// its snapshot held -- there is no live run to prefer. Untouched nodes are
// returned as the same object, so an undo does not churn React Flow's
// referential equality for the whole canvas.
export function keepLiveRunMarkers(restored, live) {
  const byId = new Map(live.map((n) => [n.id, n.data]));
  return restored.map((n) => {
    const liveData = byId.get(n.id);
    if (!liveData) return n;
    if (RUN_MARKERS.every((k) => liveData[k] === n.data?.[k])) return n;
    const data = { ...n.data };
    for (const k of RUN_MARKERS) data[k] = liveData[k];
    return { ...n, data };
  });
}
```

- [ ] **Step 4: Run to verify the new tests pass**

Run: `node client/src/graph/resolve.test.js`
Expected: `resolve.js: all checks passed`

- [ ] **Step 5: Switch the two strip sites**

In `client/src/library/save.js`, add the import:

```js
import { stripRunMarkers } from '../graph/runMarkers.js';
```

and replace the return's nodes line and its comment block with:

```js
    // `selected` is stripped because it's UI state, not graph shape. The
    // in-flight run markers are stripped for a sharper reason: presets.json is
    // deliberately never migrated or rewritten (see CLAUDE.md and
    // docs/library.md), so a marker captured mid-run sits in that JSON forever
    // -- every later instantiation would arrive pre-stuck tracking a run that
    // ended long ago. WHICH fields count as markers, and how each copy path
    // must treat them, lives in graph/runMarkers.js -- one home, not five call
    // sites. This same function backs the node clipboard (App.jsx's
    // copySelection/pasteNodeClipboard), so the strip covers a mid-render
    // copy-paste too, not just a saved preset.
    nodes: chosen.map((n) => ({ ...n, selected: undefined, data: stripRunMarkers(n.data) })),
```

In `client/src/library/insert.js`, add the import:

```js
import { stripRunMarkers } from '../graph/runMarkers.js';
```

and replace the `const data = { ...n.data, job: undefined, running: undefined };` line and its comment with:

```js
    // The inbound half of the strip in save.js's selectionFragment, and the
    // only half that can help a preset ALREADY on disk: presets.json is never
    // rewritten, so a fragment saved before the outbound strip existed still
    // carries its markers, permanently, and this is the only path that sees
    // them. Left in, a stale video job polls an id OpenRouter has forgotten --
    // a 404 that pollVideo (client/src/api.js) reads as failure to reach our
    // own server, not as an answer -- so the node stays disabled forever. The
    // marker list lives in graph/runMarkers.js.
    const data = stripRunMarkers(n.data);
```

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: all ok — including the pre-existing strip assertions in `resolve.test.js`, which now exercise the module through both call sites.

- [ ] **Step 7: Commit**

```bash
git add client/src/graph/runMarkers.js client/src/graph/resolve.test.js client/src/library/save.js client/src/library/insert.js
git commit -m "Give the in-flight run markers one home"
```

---

### Task 5: Undo prefers the live markers — and stops freezing image/text nodes

The user story (new bug, found while planning this): run a text node, let it finish, make another edit, press Cmd+Z twice. The restored snapshot carries the mid-run `running` marker; the session id matches (same tab), and the mount-only self-clear never fires because undo does not remount — so `isRunning` reads true and the Run button is frozen until reload. Same class as the video-node undo strand fixed on 2026-08-16, mirrored. `withLiveJobs` in `App.jsx` only preserves `job`; replacing it with `keepLiveRunMarkers` fixes `running` the same way.

**Files:**
- Modify: `client/src/App.jsx` — delete the `withLiveJobs` helper (~line 125–146) and change its one call site in the undo keydown handler (~line 362)

**Interfaces:**
- Consumes: `keepLiveRunMarkers(restored, live)` from `client/src/graph/runMarkers.js` (Task 4).

- [ ] **Step 1: Swap the helper**

In `client/src/App.jsx`, add the import:

```js
import { keepLiveRunMarkers } from './graph/runMarkers.js';
```

Delete the whole `withLiveJobs` block (the comment beginning `// Undo deliberately does not own \`data.job\`.` through the closing `};`), and replace the undo handler's line:

```js
      setNodes((live) => withLiveJobs(h.stack[to].nodes, live));
```

with:

```js
      // Undo deliberately does not own the in-flight run markers (data.job,
      // data.running): they are pointers at paid network traffic happening
      // right now, and a snapshot from before a run started must not strand it
      // -- nor may one from during a run resurrect it after it finished. The
      // policy and its receipts live in graph/runMarkers.js.
      setNodes((live) => keepLiveRunMarkers(h.stack[to].nodes, live));
```

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: all ok.

- [ ] **Step 3: Verify in the running app (components have no unit tests by design)**

Start `npm run dev` (from THIS worktree — note: launching via the preview tool runs the MAIN checkout's server; use plain `npm run dev` here and check `/api/health`'s `outputDir` points into the worktree before spending anything).

Text node (~a cent):
1. Wire a prompt into a text node, click Run, wait for the answer.
2. Drag a node somewhere (a new undo entry), then press Cmd+Z twice.
3. Before this fix: Run button frozen at "Running…". Expected now: button enabled, no spinner, and redo (Cmd+Shift+Z) stays healthy.

Video node (regression check on the 2026-08-16 fix, ~$0.30 at 480x480/4s — cheapest settings):
4. Click Generate on a video node, press Cmd+Z during "Starting…"/"Rendering…".
5. Expected: card keeps its spinner and "Forget this job"; render completes and lands (clip + sidecar in the project folder).

Then stop the dev server and delete any test output written during verification.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx
git commit -m "Undo prefers live run markers, not just live jobs"
```

---

### Task 6: Close the contract — disruption matrix, docs, changelog, status.md

The point of scope 1 was an ENDING: a written promise with a row per disruption, so future "what if X mid-render" findings are checked against a table instead of becoming a session.

**Files:**
- Modify: `docs/video-and-sharing.md` (after the pruning/give-up paragraphs), `CLAUDE.md` (two bullets), `CHANGELOG.md` (new entries under `## 2026-08-16` — extend the existing heading if present, per its format note)
- Check: `status.md` in the MAIN checkout (gitignored — this session cannot edit it from the worktree; do it after ExitWorktree, or note it for the user)

**Interfaces:** none — documentation.

- [ ] **Step 1: Add the disruption matrix to `docs/video-and-sharing.md`**

Append after the give-up paragraph:

```markdown
## The contract, in one table

Every render started ends in exactly one of two visible states — clip + sidecar
on disk, or a `failed` record that says why — under every disruption below.
This table is the scope: a new "what if X happens mid-render" belongs here as a
row (with its guarantee and its test) before it becomes work anywhere else.

| Mid-render, the user… | What happens | Guaranteed by |
| --- | --- | --- |
| closes the tab or laptop | the server's sweep collects it; files land in the project | `host.test.js` store tests, `jobs.test.js` |
| reloads the page | the node resumes watching via `data.job` | resume effect in `VideoOutputNode`; verified in app 2026-08-15 |
| switches projects | the canvas remounts; the job stays with its project's record | `canvasGeneration` remount; verified in app 2026-08-15 |
| presses undo/redo | live run markers win over the snapshot | `keepLiveRunMarkers` cases in `resolve.test.js`; verified in app 2026-08-16 |
| copies the node or saves it as a preset | markers stripped; the copy is a fresh node | strip cases in `resolve.test.js` |
| inserts a preset saved mid-render years ago | markers stripped again on the way in | inbound-strip case in `resolve.test.js` |
| changes the output folder in Settings | pending records move with the folder | migration case in `host.test.js` |
| — and the provider kills the job | the record fails with the provider's own message | terminal-status cases in `host.test.js` |
| — and the provider forgets the id entirely | failed after 24h of continuous silence, saying so | `givenUp` cases in `jobs.test.js` |
| — and the network blips for less than 24h | the silence clock resets on the first answer | clock-clear case in `jobs.test.js` |
| — and this machine's server restarts | the store is durable; the boot sweep resumes | `host.test.js` forks the real server against a seeded store |
| — and two watchers race the same finished job | one download: store consulted first, then the in-process lock | already-done case in `host.test.js`; three-layer note above |
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the pending-jobs server bullet, after the sentence ending "only ever resolving via the sweep", insert:

```
Changing `OUTPUT_DIR` moves the `pending` records into the new folder's store (done/failed stay behind as history), so a render in flight survives the one settings change that used to orphan it.
```

In the node-types section, after the paragraph about the video output node polling `/api/video/:id`, add:

```
**In-flight run markers have one home.** `data.job` and `data.running` are pointers at live paid runs, and `client/src/graph/runMarkers.js` owns both the list and the two operations on it: copy paths (presets, clipboard) strip them, undo prefers the live value, autosave persists them. A third marker — or a new mechanism that copies nodes — changes that one file, not five call sites.
```

- [ ] **Step 3: CHANGELOG entries**

Under `## 2026-08-16` → `### Fixed` (extend the existing group):

```markdown
- Changing the output folder in Settings no longer loses track of a render
  already in flight — pending renders move with the folder and land there.
- Undo can no longer freeze an image or text node's Run button. Stepping back
  to a moment when a run was in flight used to leave the button disabled, with
  the node showing "Running…" until a reload.
```

(Tasks 2 and 3 get no entry — a user cannot notice them.)

- [ ] **Step 4: status.md (main checkout)**

Nothing in status.md's Todos covers these fixes (checked 2026-08-16), so there is nothing to delete. Two things to keep true, editable only from outside the worktree:
- "Known, parked — no repro" stays empty: both former candidates (the sweep timeout, the store-write containment) shipped here as ride-alongs.
- If any peer session added a todo about job lifecycle or undo since, delete it as closed by this PR.

- [ ] **Step 5: Run the suite one last time and commit**

Run: `npm test`
Expected: all ok.

```bash
git add docs/video-and-sharing.md CLAUDE.md CHANGELOG.md
git commit -m "Declare the render lifecycle contract closed"
```

---

## Self-Review

- **Spec coverage:** Scope 1 = Tasks 1–3 + matrix (Task 6). Scope 2 = Tasks 4–5 + CLAUDE.md bullet (Task 6). The user-requested extras are in: text-node extra work (Task 5 — the `running` resurrection bug), status.md cleanup step (Task 6 Step 4).
- **Placeholders:** none — every step carries its code, command, or exact text.
- **Type consistency:** `RUN_MARKERS`/`stripRunMarkers`/`keepLiveRunMarkers` named identically in Tasks 4, 5 and 6; `sweepOneInner` only referenced in Task 3; the Task 1 test uses only fields `jobs.js` already reads.
- **Money:** the only spend is Task 5's browser verification (~one text run plus one optional cheapest-settings video render); no test spends anything.
