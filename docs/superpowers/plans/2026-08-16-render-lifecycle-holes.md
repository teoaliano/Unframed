# Closing the Render-Lifecycle Holes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three holes found reviewing PR #15, so the lifecycle contract in `docs/video-and-sharing.md` can be stated as a guarantee with named preconditions rather than as a promise its own matrix contradicts.

**Architecture:** Correctness, not prohibition. The mutations that could strand a paid render — output-folder change, project rename, project delete, API-key removal — each resolve the pending job records they affect, rather than being blocked while a render is in flight. A render lock was considered and rejected: no route can resolve a pending record on demand, and `forgetJob` only clears the node's copy, so a lock keyed on "any job is pending" would be un-clearable by any user action for up to the 24-hour give-up window. On the client, undo stops resurrecting a stale `running` marker on a node it restores from a delete.

**Tech Stack:** Node 18+ built-in `fetch`, plain-`node` assert tests (no framework), React 18 + React Flow client.

## Global Constraints

- Work on the existing branch `render-lifecycle-and-field-policy` (PR #15 is open and unmerged; these fixes belong in it). Never push to `main`; no worktree.
- No new dependencies. No new HTTP endpoint.
- Nothing that spends money in any test.
- Node components have no unit tests by design — verify those in the running app and say so.
- Comments explain WHY at the surrounding density and voice.
- Every server-side job-store write goes through the module-level `enqueue` chain in `server/jobs.js` (`persistJob` and the new helpers). A read-modify-write outside it can interleave with one inside it.
- `CHANGELOG.md` is user-visible only; `## YYYY-MM-DD` headings, `### Added`/`### Changed`/`### Fixed` groups.
- Decisions already made by the repo owner, not to be re-litigated: key **removal** fails pending renders immediately; key **replacement** does not (it may be a renewed key for the same account, and the existing 24-hour clock already ends a genuinely unresolvable job); project delete fails the jobs **before** removing the folder.

---

### Task 1: Undo stops freezing a node it restores from a delete

**The user story:** an image or text node is running; the user deletes it; the request finishes with nowhere to land; the user undoes the delete. The node comes back carrying `data.running` stamped with the *current* session, so the mount-only self-clear (which only clears markers from a different session) does not fire, `isRunning` reads true, and Run is disabled until a page reload.

`data.job` must keep the opposite treatment: a video render is durable server-side, so a restored node should resume watching it.

**Files:**
- Modify: `client/src/graph/runMarkers.js` (`keepLiveRunMarkers`)
- Test: `client/src/graph/resolve.test.js` (the `runMarkers` block; the existing `ghost` assertion at ~line 447 changes meaning and must be replaced, not merely added to)

**Interfaces:**
- Consumes/Produces: `keepLiveRunMarkers(restored, live)` — signature unchanged.

- [ ] **Step 1: Replace the ghost assertion and add the new cases**

In `client/src/graph/resolve.test.js`, find the block beginning with the comment `// A node undo is bringing back from a delete has no live counterpart` and replace that comment and its two lines (the `ghost` const and its assertion) with:

```js
  // A node undo is bringing back from a delete has no live counterpart, and the
  // two markers part company there. `job` is durable server-side, so a restored
  // video node should resume watching its render. `running` is not: it belongs to
  // one HTTP request owned by a component instance that no longer exists, so a
  // restored image or text node would show a permanently disabled Run button --
  // the mount-only self-clear cannot help, because the marker's session id still
  // matches this tab.
  const ghostVideo = keepLiveRunMarkers([{ id: 'gone-v', data: { job: { id: 'j-old' } } }], []);
  assert.equal(ghostVideo[0].data.job.id, 'j-old',
    'a restored video node keeps its job, so it resumes watching a render that is still running');

  const staleRun = { startedAt: 1, session: 's1' };
  const ghostRun = keepLiveRunMarkers([{ id: 'gone-t', data: { running: staleRun, text: 'keep me' } }], []);
  assert.equal(ghostRun[0].data.running, undefined,
    'a restored image or text node drops its run marker, or Run stays disabled until a reload');
  assert.equal(ghostRun[0].data.text, 'keep me', 'the rest of a restored node is untouched');
  assert.notEqual(ghostRun[0], ghostRun[0].data === undefined ? ghostRun[0] : ghostRun[0],
    'placeholder — replaced below');
```

Then delete that last placeholder assertion and add these instead:

```js
  // The undo stack holds the snapshot itself; computing what the canvas should
  // show must not rewrite it, or stepping forward again reads the amended copy.
  const snapshot = [{ id: 'gone-t2', data: { running: staleRun } }];
  const amended = keepLiveRunMarkers(snapshot, []);
  assert.notEqual(amended[0], snapshot[0], 'a cleared marker produces a new node object');
  assert.equal(snapshot[0].data.running, staleRun, 'the snapshot in the undo stack is not mutated');

  // Same-object fast path still applies on this branch: a restored node with
  // nothing to clear must not be rebuilt, or every undo churns identity for the
  // whole canvas.
  const cleanGhost = [{ id: 'gone-p', data: { text: 'a prompt' } }];
  assert.equal(keepLiveRunMarkers(cleanGhost, [])[0], cleanGhost[0],
    'a restored node with no run marker comes back as the identical object');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node client/src/graph/resolve.test.js`
Expected: FAIL at `a restored image or text node drops its run marker, or Run stays disabled until a reload` — the current code returns the snapshot untouched.

- [ ] **Step 3: Split the absent-from-live branch**

In `client/src/graph/runMarkers.js`, replace `keepLiveRunMarkers` (keep the file's other exports and the module comment unchanged) with:

```js
export function keepLiveRunMarkers(restored, live) {
  const byId = new Map(live.map((n) => [n.id, n.data]));
  return restored.map((n) => {
    const liveData = byId.get(n.id);
    // Still on the canvas: the live value wins for every marker, in both
    // directions -- undoing past a Generate must not strand a render, and
    // redoing past a finish must not resurrect a dead one.
    if (liveData) {
      if (RUN_MARKERS.every((k) => liveData[k] === n.data?.[k])) return n;
      const data = { ...n.data };
      for (const k of RUN_MARKERS) data[k] = liveData[k];
      return { ...n, data };
    }
    // Absent from the live graph: undo is bringing this node back from a
    // delete, and there is no live value to prefer. The two markers part
    // company here, which is the whole reason this branch is not just "keep
    // the snapshot".
    //
    // `job` is kept: a video render is durable on the server, so the restored
    // node's resume effect picks it up and the clip still lands.
    //
    // `running` is dropped: it belongs to a single HTTP request owned by a
    // component instance that no longer exists. Its result can never arrive,
    // and the mount-only self-clear cannot save the node either -- that only
    // clears a marker from a DIFFERENT session, and this one is stamped with
    // the session that is still open. Kept, it disables Run forever, which is
    // the same bug this module was written to end, reached through the delete
    // door instead of the undo door.
    //
    // The trade this accepts, deliberately: a request in flight when the node
    // was deleted CAN still land on it afterwards, since updateNodeData
    // addresses by id. So there is a brief window where Run is enabled while a
    // request is still coming. A rare double-run beats a certain permanent
    // freeze.
    if (n.data?.running === undefined) return n;
    return { ...n, data: { ...n.data, running: undefined } };
  });
}
```

- [ ] **Step 4: Run to verify it passes, then the whole suite**

Run: `node client/src/graph/resolve.test.js` — expect `resolve.js: all checks passed`
Run: `npm test` — expect all six files ok.

- [ ] **Step 5: Commit**

```bash
git add client/src/graph/runMarkers.js client/src/graph/resolve.test.js
git commit -m "Drop a stale run marker when undo restores a deleted node"
```

---

### Task 2: An output-folder change that cannot move its renders fails visibly

**The user story:** a render is in flight; the user points the output folder somewhere new; the migration fails (permissions, a disk that went away). Today the API still returns 200, `.env` and the live binding already point at the new folder, and the sweep reads a store that does not contain the render. It is paid for, finishes upstream, and is never collected — with the settings dialog reporting success.

The root cause is ordering: `writeEnv` runs first (`server/index.js`, ~line 132), the live binding flips next (~line 142), and only then is the migration attempted, inside a `try` whose `catch` logs and continues. Keeping the old folder authoritative is not enough on its own — `.env` would still name the new one, so the next restart loses the records anyway.

**Files:**
- Modify: `server/index.js` — `PUT /api/config`, the block from `try { await writeEnv(updates); }` through the end of the `if (updates.OUTPUT_DIR)` block
- Test: `server/host.test.js` (add after the existing output-folder migration case)

**Interfaces:**
- Consumes: `migratePendingJobs(fromDir, toDir)` from `server/jobs.js` — unchanged, already returns the number of records moved and already guards the same-directory case.

- [ ] **Step 1: Write the failing test**

In `server/host.test.js`, after the existing folder-move block (the one ending with the switch-back `PUT` and its status assertion), add:

```js
  // A folder change whose migration cannot complete must FAIL, not report
  // success and leave the render behind. Before this fix the route wrote .env,
  // flipped the live binding, then tried to migrate inside a catch that only
  // logged -- so a store that could not be written left a paid render in a
  // folder nothing sweeps, with the dialog showing "saved". A file where the
  // destination store belongs is the deterministic way to make the write fail,
  // the same trick presets.test.js and jobs.test.js use for unreadable paths.
  const blockedDir = path.join(dataDir, 'blocked');
  await fs.mkdir(blockedDir);
  await fs.mkdir(path.join(blockedDir, 'jobs.json')); // a directory where the file must go
  await fs.writeFile(
    path.join(outDir, 'jobs.json'),
    JSON.stringify([
      {
        id: 'must-not-be-orphaned',
        project: '',
        params: { prompt: 'a render that outlives a failed move', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now(),
        status: 'pending',
      },
    ]),
  );
  const blocked = await fetch(`${base}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputDir: blockedDir }),
  });
  assert.equal(blocked.status, 500, 'a folder change that cannot move its pending renders fails');
  const blockedBody = await blocked.json();
  assert.match(blockedBody.error, /render/i, 'and the message says renders are why, not a raw errno');

  const stillHere = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  assert.equal(
    stillHere.find((j) => j.id === 'must-not-be-orphaned')?.status,
    'pending',
    'the render stays in the old store, still pending, still swept',
  );
  const afterBlocked = await (await fetch(`${base}/api/health`)).json();
  assert.equal(afterBlocked.outputDir, outDir, 'the live output folder did not move');
  assert.doesNotMatch(
    await fs.readFile(path.join(dataDir, '.env'), 'utf8'),
    /OUTPUT_DIR=.*blocked/,
    'and .env did not move either, so a restart cannot lose the render',
  );
```

- [ ] **Step 2: Run to verify it fails**

Run: `node server/host.test.js`
Expected: FAIL at `a folder change that cannot move its pending renders fails` — the route currently answers 200.

- [ ] **Step 3: Reorder the route**

In `server/index.js`, the validation block that `mkdir`s the new folder stays exactly where it is. Replace the section that begins `try { await writeEnv(updates); }` and includes the whole `if (updates.OUTPUT_DIR) { ... }` block with this, keeping the other three `if (updates.OPENROUTER_*)` assignment lines in the same relative position:

```js
  // The migration runs BEFORE anything is committed, and its failure is fatal
  // to the request. Ordering is the whole fix: this used to write .env, flip
  // the live binding, and only then try to move the pending records inside a
  // catch that logged and carried on -- so a store that could not be written
  // answered 200 while leaving a paid render in a folder nothing sweeps any
  // more. Migrating first means a failure leaves BOTH .env and the live
  // binding on the old folder, where the sweep is still watching the render;
  // the user sees an error and can try somewhere else. Keeping only the live
  // binding back would not be enough -- .env would still name the new folder,
  // and the next restart would lose the records anyway.
  let movedJobs = 0;
  const nextOutputDir = updates.OUTPUT_DIR ? outputPath(ROOT, updates.OUTPUT_DIR) : null;
  if (nextOutputDir) {
    try {
      movedJobs = await migratePendingJobs(OUTPUT_DIR, nextOutputDir);
    } catch (err) {
      return res.status(500).json({
        error: `Could not move the renders already in progress to that folder, so the folder was not changed: ${err.message}`,
      });
    }
  }

  try {
    await writeEnv(updates);
  } catch (err) {
    return res.status(500).json({ error: `Could not write .env: ${err.message}` });
  }

  // Apply to the live process too, so nothing needs a restart.
  if (updates.OPENROUTER_API_KEY) API_KEY = updates.OPENROUTER_API_KEY;
  if (updates.OPENROUTER_IMAGE_MODEL) IMAGE_MODEL = updates.OPENROUTER_IMAGE_MODEL;
  if (updates.OPENROUTER_TEXT_MODEL) TEXT_MODEL = updates.OPENROUTER_TEXT_MODEL;
  if (updates.OPENROUTER_VIDEO_MODEL) VIDEO_MODEL = updates.OPENROUTER_VIDEO_MODEL;
  if (nextOutputDir) {
    OUTPUT_DIR = nextOutputDir;
    if (movedJobs) console.log(`  moved ${movedJobs} pending video job(s) to the new output folder`);
  }
```

Note the one behaviour this leaves as it was: if `writeEnv` fails *after* a successful migration, the records have already moved while the live binding has not. That window is far smaller than the one being closed, and the records are recoverable either way (both stores are on disk); do not add a rollback for it, but do not claim it is impossible either.

- [ ] **Step 4: Run to verify it passes, then the whole suite**

Run: `node server/host.test.js`, then `npm test` — expect all six ok.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Fail an output-folder change that cannot take its renders with it"
```

---

### Task 3: The store can name and resolve a project's pending renders

Pure additions, so the rules are asserted rather than clicked through. Tasks 4 and 5 consume them.

**Files:**
- Modify: `server/jobs.js` (add three exports next to `persistJob`; the existing `enqueue` is module-private and must be reused, which is why they belong in this file)
- Test: `server/jobs.test.js`

**Interfaces:**
- Produces (Tasks 4 and 5 rely on these exact names and shapes):
  - `pendingJobsFor(jobs: Job[], project?: string|null) -> Job[]` — pending records; filtered to one project when `project` is a string, all pending when it is `null`/`undefined`. Treats a missing `project` field and `''` as the same "no project".
  - `failPendingJobs(dir: string, opts: {project?: string|null, error: string}) -> Promise<number>` — marks matching pending records `failed` with `error` and a `resolvedAt`, returns how many. Queued.
  - `reassignPendingJobs(dir: string, from: string, to: string) -> Promise<number>` — repoints matching pending records at a new project slug, returns how many. Queued.

- [ ] **Step 1: Write the failing tests**

In `server/jobs.test.js`, extend the import line to include `pendingJobsFor, failPendingJobs, reassignPendingJobs`, and add before the final `await fs.rm(dir, ...)`:

```js
// ---- pendingJobsFor / failPendingJobs / reassignPendingJobs ----
// What the mutation routes need: name the renders an action is about to affect,
// then either end them visibly or repoint them. A pending record is the only
// thing that can strand a paid render, so these are the ways one legitimately
// stops being pending outside the sweep.
const mixed = [
  { id: 'p-a', status: 'pending', project: 'alpha', startedAt: now },
  { id: 'p-a2', status: 'pending', project: 'alpha', startedAt: now },
  { id: 'p-b', status: 'pending', project: 'beta', startedAt: now },
  { id: 'p-root', status: 'pending', project: '', startedAt: now },
  { id: 'p-none', status: 'pending', startedAt: now }, // no project field at all
  { id: 'd-a', status: 'done', project: 'alpha', startedAt: now, resolvedAt: now },
];
assert.deepEqual(pendingJobsFor(mixed, 'alpha').map((j) => j.id), ['p-a', 'p-a2'],
  'one project, pending only -- a done record is not something an action can strand');
assert.deepEqual(pendingJobsFor(mixed, 'beta').map((j) => j.id), ['p-b'], 'and only that project');
assert.deepEqual(pendingJobsFor(mixed, '').map((j) => j.id), ['p-root', 'p-none'],
  'a missing project field and an empty one are the same "no project"');
assert.deepEqual(pendingJobsFor(mixed).map((j) => j.id).sort(),
  ['p-a', 'p-a2', 'p-b', 'p-none', 'p-root'],
  'no project argument means every pending record, whatever it belongs to');
assert.deepEqual(pendingJobsFor([], 'alpha'), [], 'an empty store names nothing');

const failDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-fail-'));
await writeJobs(failDir, mixed);
assert.equal(await failPendingJobs(failDir, { project: 'alpha', error: 'project deleted' }), 2,
  'reports how many renders it ended, which is what the confirmation copy counts');
const afterFail = await readJobs(failDir);
for (const id of ['p-a', 'p-a2']) {
  const j = afterFail.find((x) => x.id === id);
  assert.equal(j.status, 'failed', `${id} ends visibly rather than staying pending forever`);
  assert.equal(j.error, 'project deleted', 'and says why, so the node can show a reason');
  assert.ok(Number.isFinite(j.resolvedAt), 'resolvedAt is stamped so pruneJobs can drop it in seven days');
}
assert.equal(afterFail.find((x) => x.id === 'p-b').status, 'pending',
  "another project's render is untouched");
assert.equal(afterFail.find((x) => x.id === 'd-a').status, 'done', 'and an already-done record is left alone');
assert.equal(await failPendingJobs(failDir, { project: 'alpha', error: 'again' }), 0,
  'a second call finds nothing pending and reports zero');
await fs.rm(failDir, { recursive: true, force: true });

const moveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-jobs-reassign-'));
await writeJobs(moveDir, mixed);
assert.equal(await reassignPendingJobs(moveDir, 'alpha', 'alpha-renamed'), 2, 'reports how many it repointed');
const afterMove = await readJobs(moveDir);
assert.deepEqual(
  afterMove.filter((j) => j.project === 'alpha-renamed').map((j) => j.id).sort(),
  ['p-a', 'p-a2'],
  'a pending render follows its project to the new name, so the clip lands where the user is looking',
);
assert.equal(afterMove.find((x) => x.id === 'd-a').project, 'alpha',
  'a done record keeps the name it was written under -- its files are already on disk there');
assert.equal(afterMove.find((x) => x.id === 'p-b').project, 'beta', "another project's render is untouched");
await fs.rm(moveDir, { recursive: true, force: true });
```

- [ ] **Step 2: Run to verify it fails**

Run: `node server/jobs.test.js`
Expected: FAIL — the named imports do not exist yet.

- [ ] **Step 3: Add the three exports**

In `server/jobs.js`, after `persistJob`, add:

```js
// Which pending records an action is about to affect. Pending only: a done or
// failed record has already ended, and nothing a user does to a folder or a
// project can strand it. `project` omitted (or null) means every pending
// record, whatever it belongs to -- what removing the API key needs. A record
// written before projects existed has no `project` field at all, so a missing
// one and '' are deliberately the same bucket.
export function pendingJobsFor(jobs, project) {
  const all = jobs.filter((j) => j.status === 'pending');
  if (project === undefined || project === null) return all;
  return all.filter((j) => (j.project || '') === (project || ''));
}

// Ends matching pending records visibly, and reports how many. This is the
// only way a pending record stops being pending other than the sweep resolving
// it -- which is exactly why it exists: an action that would otherwise leave a
// render unpollable forever (its project deleted, its key removed) has to be
// able to say so, or the record sits pending until the 24-hour clock and the
// user never learns what happened. `error` reaches the node, so it should name
// the action rather than describe a generic failure. Queued on the same chain
// as persistJob: one read-modify-write, so a sweep tick finishing a different
// job cannot interleave and drop this update.
export function failPendingJobs(dir, { project, error }) {
  return enqueue(async () => {
    const jobs = await readJobs(dir);
    const doomed = pendingJobsFor(jobs, project);
    if (!doomed.length) return 0;
    const at = Date.now();
    const ids = new Set(doomed.map((j) => j.id));
    const next = jobs.map((j) =>
      ids.has(j.id) ? { ...j, status: 'failed', error, resolvedAt: at } : j,
    );
    await writeJobs(dir, pruneJobs(next, at));
    return doomed.length;
  });
}

// Repoints a project's pending records at a new slug, and reports how many.
// A rename is a plain fs.rename of the folder, but a job record carries the
// slug it was created under and collectVideo mkdirs that path -- so without
// this a render finishing after a rename recreates the OLD folder and writes
// the clip into a project the user no longer has open. Only pending records
// move: a done one names the folder its files are already sitting in, and
// rewriting it would point at a path that has nothing in it.
export function reassignPendingJobs(dir, from, to) {
  return enqueue(async () => {
    const jobs = await readJobs(dir);
    const moving = pendingJobsFor(jobs, from);
    if (!moving.length) return 0;
    const ids = new Set(moving.map((j) => j.id));
    const next = jobs.map((j) => (ids.has(j.id) ? { ...j, project: to } : j));
    await writeJobs(dir, pruneJobs(next, Date.now()));
    return moving.length;
  });
}
```

- [ ] **Step 4: Run to verify, then the whole suite**

Run: `node server/jobs.test.js`, then `npm test` — expect all six ok.

- [ ] **Step 5: Commit**

```bash
git add server/jobs.js server/jobs.test.js
git commit -m "Let the job store name and resolve a project's pending renders"
```

---

### Task 4: Rename, delete and key removal resolve the renders they affect

Three routes, one rule: an action that would make a pending render unpollable must resolve it first, so it ends visibly instead of sitting pending until the 24-hour clock.

- **Rename** repoints the records — the render continues and lands in the renamed project. Nothing is lost.
- **Delete** ends the records, *before* removing the folder. Fail-first is deliberate: if the `rm` then fails, the user retries a delete on an intact project. The other order leaves records pointing at a folder that is gone, and the sweep recreates it as a ghost.
- **Key removal** ends every pending record, whatever project it belongs to — the sweep bails without a key, so nothing would ever resolve them.
- **Key replacement** deliberately does NOT end anything: it may be a renewed key for the same account, and a genuinely unusable id is already ended by the 24-hour clock. Do not add a branch for it.

Delete is two-phase so the confirmation cannot be skipped by a client that forgets to ask: without `?confirmRenders=1`, a project with pending renders answers `409` and the count; with it, the delete proceeds. This mirrors the two-step confirm the settings dialog already uses for key removal, and needs no new endpoint.

**Files:**
- Modify: `server/index.js` — `POST /api/projects/:name/rename` (~line 491), `DELETE /api/projects/:name` (~line 510), `DELETE /api/key` (~line 171), and the jobs import line
- Test: `server/host.test.js`

**Interfaces:**
- Consumes: `pendingJobsFor`, `failPendingJobs`, `reassignPendingJobs` (Task 3), plus the already-imported `readJobs`.
- Produces (Task 5 relies on this): `DELETE /api/projects/:name` answers `409 { error, pendingRenders: <number> }` when the project has pending renders and `confirmRenders=1` is absent; `DELETE /api/projects/:name?confirmRenders=1` always proceeds and answers `200 { ok: true, endedRenders: <number> }`.

- [ ] **Step 1: Write the failing tests**

In `server/host.test.js`, add before the null-guard loop:

```js
  // Task 4: the three mutations that could strand a paid render now resolve the
  // records they affect. Seeded directly, the way the sweep or an earlier poll
  // would have left them; none of this reaches OpenRouter.
  await fs.mkdir(path.join(outDir, 'keepers'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'doomed'), { recursive: true });
  const seedJobs = () =>
    fs.writeFile(
      path.join(outDir, 'jobs.json'),
      JSON.stringify([
        { id: 'k-1', project: 'keepers', status: 'pending', startedAt: Date.now(), params: {} },
        { id: 'd-1', project: 'doomed', status: 'pending', startedAt: Date.now(), params: {} },
        { id: 'd-2', project: 'doomed', status: 'pending', startedAt: Date.now(), params: {} },
      ]),
    );

  // Rename: the render follows the project, so the clip lands where the user is
  // now looking instead of recreating the old folder as a ghost.
  await seedJobs();
  const renamed = await fetch(`${base}/api/projects/keepers/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'keepers-renamed' }),
  });
  assert.equal(renamed.status, 200);
  const afterRename = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  assert.equal(afterRename.find((j) => j.id === 'k-1').project, 'keepers-renamed',
    'a pending render is repointed at the new name');
  assert.equal(afterRename.find((j) => j.id === 'k-1').status, 'pending',
    'and is still pending -- a rename does not cost the user their render');
  assert.equal(afterRename.find((j) => j.id === 'd-1').project, 'doomed', 'another project is untouched');

  // Delete: refuses without confirmation, and reports how many renders are at stake.
  const refused = await fetch(`${base}/api/projects/doomed`, { method: 'DELETE' });
  assert.equal(refused.status, 409, 'deleting a project with renders in flight needs confirmation');
  const refusedBody = await refused.json();
  assert.equal(refusedBody.pendingRenders, 2, 'and says how many, so the dialog can name the number');
  await fs.access(path.join(outDir, 'doomed')); // throws if the refusal deleted anything

  // Confirmed: the records end visibly FIRST, then the folder goes.
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

  // A project with no pending renders deletes without ceremony.
  await fs.mkdir(path.join(outDir, 'empty-one'), { recursive: true });
  assert.equal((await fetch(`${base}/api/projects/empty-one`, { method: 'DELETE' })).status, 200,
    'no renders in flight means no confirmation step');

  // Key removal ends every pending render: the sweep bails without a key, so
  // nothing would ever resolve them.
  await seedJobs();
  const keyGone = await fetch(`${base}/api/key`, { method: 'DELETE' });
  assert.equal(keyGone.status, 200);
  assert.equal((await keyGone.json()).endedRenders, 3, 'reports how many renders it ended');
  const afterKey = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  for (const j of afterKey) {
    assert.equal(j.status, 'failed', 'every pending render ends, whatever project it belonged to');
    assert.match(j.error, /key/i, 'and the reason names the key');
  }

  // Put the fake key back for anything after this point.
  await fetch(`${base}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: fakeKey }),
  });

  // Key REPLACEMENT must not end anything -- a renewed key for the same account
  // is the common case, and a genuinely unusable id is already ended by the
  // 24-hour give-up clock.
  await seedJobs();
  await fetch(`${base}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'sk-or-v1-1111111111111111111111111111111111111111111111111111' }),
  });
  const afterSwap = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  assert.equal(afterSwap.filter((j) => j.status === 'pending').length, 3,
    'replacing the key leaves renders polling -- it may be a renewed key for the same account');
  await fetch(`${base}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: fakeKey }),
  });
  await fs.writeFile(path.join(outDir, 'jobs.json'), '[]');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node server/host.test.js`
Expected: FAIL at the rename assertion — records are not repointed today.

- [ ] **Step 3: Implement the three routes**

Extend the jobs import in `server/index.js` to add `pendingJobsFor, failPendingJobs, reassignPendingJobs`.

In `POST /api/projects/:name/rename`, after the successful `await fs.rename(from, dest);` and before the response:

```js
    // A job record carries the slug it was created under, and collectVideo
    // mkdirs that path when the render lands -- so without this, a clip
    // finishing after a rename recreates the OLD folder and writes itself into
    // a project the user no longer has. Repointing costs the user nothing: the
    // render keeps running and lands where they are actually looking. Best
    // effort on purpose -- the rename itself already succeeded, and failing the
    // request now would tell the user it did not.
    let moved = 0;
    try {
      moved = await reassignPendingJobs(OUTPUT_DIR, req.params.name, to);
    } catch (err) {
      console.log(`  could not repoint pending jobs after rename: ${err.message}`);
    }
    res.json({ ok: true, name: to, movedRenders: moved });
```

Replace `DELETE /api/projects/:name` with:

```js
// Deleting a project that has renders in flight is the one destructive case
// here: the render is paid for and cannot be stopped upstream, so the most the
// app can do is stop tracking it and say so. Two-phase rather than a
// client-side confirmation alone, so a caller that forgets to ask cannot
// silently abandon a render: without confirmRenders the route reports what is
// at stake and changes nothing.
app.delete('/api/projects/:name', async (req, res) => {
  const name = req.params.name;
  const pending = pendingJobsFor(await readJobs(OUTPUT_DIR), name);
  if (pending.length && req.query.confirmRenders !== '1') {
    return res.status(409).json({
      error: `This project has ${pending.length} video render${pending.length === 1 ? '' : 's'} in progress.`,
      pendingRenders: pending.length,
    });
  }
  // Records first, folder second. If the rm then fails, the user retries a
  // delete on a project that is still intact; the other order would leave
  // records pointing at a folder that is gone, and the sweep would recreate it
  // as a ghost project holding one clip and no graph.
  let ended = 0;
  if (pending.length) {
    ended = await failPendingJobs(OUTPUT_DIR, {
      project: name,
      error: 'Stopped tracking this render: the project it belonged to was deleted. It may still finish upstream, but nothing here will save the result.',
    });
    for (const job of pending) revokeJobShares(job.id);
  }
  await fs.rm(projectDir(name), { recursive: true, force: true });
  res.json({ ok: true, endedRenders: ended });
});
```

In `DELETE /api/key`, after `API_KEY = '';` and before the response:

```js
  // The sweep returns immediately without a key, so every pending render would
  // sit unresolved until the 24-hour clock -- neither collected nor failed,
  // which is precisely the state the lifecycle contract promises cannot happen.
  // Removing a key is an explicit "stop using my account", so the honest answer
  // is to end them now and say why. REPLACING a key is a different act and
  // deliberately does not do this: it is usually a renewed key for the same
  // account, and a genuinely unusable id is already ended by the clock.
  let ended = 0;
  try {
    ended = await failPendingJobs(OUTPUT_DIR, {
      project: null,
      error: 'Stopped tracking this render: the OpenRouter key was removed, so its progress can no longer be checked. It may still finish upstream, but nothing here will save the result.',
    });
  } catch (err) {
    console.log(`  could not end pending jobs after key removal: ${err.message}`);
  }
  res.json({ ok: true, endedRenders: ended, ...settings() });
```

- [ ] **Step 4: Run to verify, then the whole suite**

Run: `node server/host.test.js`, then `npm test` — expect all six ok.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Rename, delete and key removal resolve the renders they affect"
```

---

### Task 5: The client asks before abandoning a render, and stops swallowing failures

`deleteProject` in `client/src/api.js` currently returns the bare `fetch` and checks nothing, so the new `409` would be ignored and the UI would remove the project from its list as though the delete had happened.

**Files:**
- Modify: `client/src/api.js` (`deleteProject`), `client/src/App.jsx` (`confirmDelete`, and the delete dialog's copy)

**Interfaces:**
- Consumes: the two-phase `DELETE /api/projects/:name` from Task 4.
- Produces: `deleteProject(name, { confirmRenders } = {})` — resolves to `{ ok, endedRenders }`, or throws an error carrying `pendingRenders` when confirmation is needed.

- [ ] **Step 1: Make deleteProject report what happened**

In `client/src/api.js`, replace `deleteProject` with:

```js
// Unlike its neighbours this one has to read the body: a project with renders
// in flight answers 409 with how many, and the caller escalates its
// confirmation before calling again with confirmRenders. Returning the bare
// fetch (as this did) meant that refusal read as success and the project
// vanished from the list without being deleted.
export const deleteProject = (name, { confirmRenders } = {}) =>
  fetch(
    `/api/projects/${encodeURIComponent(name)}${confirmRenders ? '?confirmRenders=1' : ''}`,
    { method: 'DELETE' },
  ).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(d.error || `Could not delete the project (${r.status})`);
      err.pendingRenders = d.pendingRenders ?? 0;
      throw err;
    }
    return d;
  });
```

- [ ] **Step 2: Escalate the confirmation in App.jsx**

`confirmDelete` currently calls `deleteProject(name)` and proceeds unconditionally. Rewrite it to handle the refusal, following the same two-step shape the settings dialog already uses for key removal (`cfgDlg.confirmRemove`). The `deleting` state holds the project name; extend it to an object carrying the name plus a `pendingRenders` count once known — or keep a separate piece of state if that reads more cleanly with the existing dialog. Requirements:

- First call passes no `confirmRenders`.
- On an error carrying `pendingRenders > 0`, do NOT delete anything: keep the dialog open and show the escalated copy, exactly this sentence with the count substituted (singular/plural both correct):
  `This stops tracking N video render(s). They may still complete upstream, but their results will not be saved here.`
- The confirming click calls `deleteProject(name, { confirmRenders: true })`.
- Any other error surfaces in the dialog rather than silently removing the project from the list — the current code updates `projects` regardless of outcome, which is the bug that makes a failed delete look successful.

- [ ] **Step 3: Verify in the running app (node components have no unit tests by design)**

Start `npm run dev`. Confirm `/api/health` reports the expected `outputDir` before spending anything.

1. Seed a project with a pending render cheaply: write `<OUTPUT_DIR>/jobs.json` with one `pending` record whose `project` matches a scratch project and whose id OpenRouter will never know (e.g. `vid_probe_not_real`). No money is spent.
2. Delete that project → the dialog must show the "stops tracking 1 video render" sentence; confirm → the project goes and `jobs.json` shows the record `failed` with the deletion reason.
3. Rename a project holding a pending record → `jobs.json` shows the record repointed, still `pending`.
4. Remove the API key with a pending record present → the record ends `failed` naming the key. Put the key back afterwards.
5. Delete a project with no renders → no extra confirmation step.

Then stop the server and delete the scratch project and any seeded records.

- [ ] **Step 4: Commit**

```bash
git add client/src/api.js client/src/App.jsx
git commit -m "Confirm before abandoning a render, and stop swallowing a failed delete"
```

---

### Task 6: State the contract, with its preconditions named

**Files:**
- Modify: `docs/video-and-sharing.md` (the contract sentence at ~line 127 and the matrix rows for rename, delete, output folder, key change), `CLAUDE.md`, `CHANGELOG.md`
- Report only (do NOT edit — gitignored, controller will apply): `status.md`

- [ ] **Step 1: Rewrite the contract sentence**

Replace the promise with one that names what it depends on. The preconditions are exactly these three — no others, and specifically NOT "the machine stays reachable", since sleep, tab close, restart and temporary outages are all covered by design:

- the server must eventually be able to run again;
- the output storage must remain writable;
- Unframed must retain credentials for the same OpenRouter account that started the job.

- [ ] **Step 2: Update the four rows**

Rewrite these rows to what the code now does, and set `Tested?` from what the tests actually reach (`yes` for the rows Task 4's integration cases cover; keep `partial`/`no` honest elsewhere — do not upgrade a row this branch did not test):

- **changes the output folder** — pending records move with it, and a move that cannot take them fails with a message instead of reporting success.
- **renames the project** — pending records are repointed, so the clip lands in the renamed project. Delete the ghost-project claim; it can no longer happen.
- **deletes the project** — the app asks first, naming how many renders it will stop tracking, then ends those records visibly and removes the folder. Delete the recreated-folder claim.
- **removes the API key** — every pending record ends, saying the key was removed. Add that **replacing** a key does not end anything, and that a key for a different account leaves the id unpollable until the 24-hour clock ends it.

- [ ] **Step 3: CLAUDE.md**

Extend the pending-video-job bullet with one sentence: the four mutations that could strand a render each resolve the records they affect (folder move migrates, rename repoints, delete ends after confirming, key removal ends) — and state the rule that makes this coherent, that a pending record is the only thing that can strand a paid render, so anything making one unpollable must end it visibly.

Also add one sentence to the run-markers paragraph: undo restoring a node from a delete keeps `job` and drops `running`, because only the former is durable server-side.

- [ ] **Step 4: CHANGELOG.md**

Extend the existing `## 2026-08-16` → `### Fixed` group. User-visible only:

```markdown
- Renaming a project no longer loses a render that is still going. The clip now
  lands in the renamed project instead of recreating the old one.
- Deleting a project with a render in progress now asks first, and says how many
  renders it will stop tracking.
- Removing your OpenRouter key now ends renders in progress with an explanation,
  instead of leaving them spinning with no way to find out what happened.
- Changing the output folder now fails with a message if it cannot take renders in
  progress with it, instead of reporting success and leaving them behind.
- Undo no longer freezes an image or text node that it brings back from a delete.
```

- [ ] **Step 5: Report on status.md**

Read it and report (do not edit): whether the two follow-up todos added on 2026-08-16 are affected, and whether either parked item is now resolved. The presets/`data.result` todo is untouched by this branch. The unattended-sweep-test todo is likewise untouched.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test` — expect all six ok.

```bash
git add docs/video-and-sharing.md CLAUDE.md CHANGELOG.md
git commit -m "State the lifecycle contract with its preconditions named"
```

---

## Self-Review

- **Coverage:** issue 1 → Task 1; issue 2 → Task 2; issue 3 → Tasks 3–5 (mechanism) and Task 6 (contract). Both owner refinements are in: key removal vs replacement split across Task 4's two branches and its two tests; delete fails records before `rm`, with the exact confirmation sentence in Task 5 Step 2.
- **Placeholders:** none. Task 1 Step 1 contains a deliberate placeholder assertion that the same step then instructs the implementer to delete — verify it is removed, not shipped.
- **Type consistency:** `pendingJobsFor`/`failPendingJobs`/`reassignPendingJobs` are named identically in Tasks 3, 4 and the interfaces block; `endedRenders`/`pendingRenders`/`movedRenders` are used consistently between Task 4's routes, Task 4's tests and Task 5's client.
- **Money:** nothing in any test reaches OpenRouter. Task 5's app verification uses a fake job id and spends nothing.
- **Rejected:** the render lock (`GET /api/render-locks`, 409s on four routes, client polling, disabled UI) — no route can resolve a pending record on demand and `forgetJob` only clears the node's copy, so the lock would be un-clearable for up to 24 hours, including for the user whose key is the reason the render is failing.
