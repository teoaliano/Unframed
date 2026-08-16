# Closing the Render-Lifecycle Holes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three holes found reviewing PR #15, so the lifecycle contract in `docs/video-and-sharing.md` can be stated as a guarantee with named preconditions rather than as a promise its own matrix contradicts.

**Architecture:** Correctness, not prohibition. The four mutations that could strand a paid render — output-folder change, project rename, project delete, API-key removal — each resolve the pending records they affect. Every one of them follows the same rule: **read the store strictly, act on the records first, commit the destructive step last, and compensate or fail visibly when a step in the middle fails.** A render lock was considered and rejected: no route can resolve a pending record on demand and `forgetJob` only clears the node's copy, so a lock keyed on "any job is pending" would be un-clearable for up to the 24-hour give-up window. On the client, undo stops resurrecting a stale `running` marker on a node it restores from a delete.

**Tech Stack:** Node 18+ built-in `fetch`, Express 4, plain-`node` assert tests (no framework), React 18 + React Flow client.

## Global Constraints

- Work on the existing branch `render-lifecycle-and-field-policy` (PR #15 is open and unmerged). Never push to `main`; no worktree.
- No new dependencies. No new HTTP endpoint.
- Nothing that spends money in any test.
- Node components have no unit tests by design — verify those in the running app and say so.
- Comments explain WHY at the surrounding density and voice.
- Every server-side job-store write goes through the module-level `enqueue` chain in `server/jobs.js`. A read-modify-write outside it can interleave with one inside it.
- **This project runs Express 4 with no error-handling middleware.** An `async` route handler that rejects produces an unhandled rejection and NEVER sends a response — the request hangs until the client times out, which is worse than a 500. Every `await` added to a route in this plan must sit inside an explicit `try/catch` that returns a status. There are no exceptions to this.
- **`readJobs` is deliberately lenient and must not be used by any mutation route.** It answers `[]` for a missing file, corrupt JSON, and an unreadable path alike — right for booting the sweep, catastrophic for a lifecycle mutation, where "0 pending" from a damaged store is indistinguishable from "genuinely nothing in flight" and silently licenses orphaning everything. Mutations use `readJobsStrict` (Task 2).
- `CHANGELOG.md` is user-visible only; `## YYYY-MM-DD` headings with `### Added`/`### Changed`/`### Fixed`.
- Owner decisions, not to be re-litigated: key **removal** ends pending renders, key **replacement** does not; delete ends records **before** removing the folder; the contract's preconditions are exactly "the server must eventually be able to run again", "the output storage must remain writable", and "Unframed must retain credentials for the same OpenRouter account that started the job" — never "the machine must stay reachable".

---

### Task 1: Undo stops freezing a node it restores from a delete

**The user story:** an image or text node is running; the user deletes it; the request finishes with nowhere to land; the user undoes the delete. The node returns carrying `data.running` stamped with the *current* session, so the mount-only self-clear (which only clears markers from a different session) never fires, `isRunning` reads true, and Run is disabled until a page reload.

`data.job` must keep the opposite treatment: a video render is durable server-side, so a restored node should resume watching it.

**Files:**
- Modify: `client/src/graph/runMarkers.js` (`keepLiveRunMarkers`)
- Test: `client/src/graph/resolve.test.js` — the existing `ghost` assertion (~line 447) changes meaning and must be REPLACED, not added to

**Interfaces:**
- `keepLiveRunMarkers(restored, live)` — signature unchanged.

- [ ] **Step 1: Replace the ghost assertion**

In `client/src/graph/resolve.test.js`, find the comment `// A node undo is bringing back from a delete has no live counterpart` and replace it, the `ghost` const, and its assertion with:

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

  // The undo stack holds the snapshot itself; computing what the canvas should
  // show must not rewrite it, or stepping forward again reads the amended copy.
  const snapshot = [{ id: 'gone-t2', data: { running: staleRun } }];
  const amended = keepLiveRunMarkers(snapshot, []);
  assert.notEqual(amended[0], snapshot[0], 'a cleared marker produces a new node object');
  assert.equal(snapshot[0].data.running, staleRun, 'the snapshot in the undo stack is not mutated');

  // The same-object fast path applies on this branch too: a restored node with
  // nothing to clear must not be rebuilt, or every undo churns identity for the
  // whole canvas.
  const cleanGhost = [{ id: 'gone-p', data: { text: 'a prompt' } }];
  assert.equal(keepLiveRunMarkers(cleanGhost, [])[0], cleanGhost[0],
    'a restored node with no run marker comes back as the identical object');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node client/src/graph/resolve.test.js`
Expected: FAIL at `a restored image or text node drops its run marker…` — the current code returns the snapshot untouched.

- [ ] **Step 3: Split the absent-from-live branch**

In `client/src/graph/runMarkers.js`, replace `keepLiveRunMarkers` (leave the other exports and the module comment alone) with:

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
    // clears a marker from a DIFFERENT session, and this one carries the
    // session that is still open. Kept, it disables Run forever: the same bug
    // this module was written to end, reached through the delete door.
    //
    // The trade this accepts, deliberately: a request in flight when the node
    // was deleted CAN still land afterwards, since updateNodeData addresses by
    // id. So there is a brief window where Run is enabled while a request is
    // still coming. A rare double-run beats a certain permanent freeze.
    if (n.data?.running === undefined) return n;
    return { ...n, data: { ...n.data, running: undefined } };
  });
}
```

- [ ] **Step 4: Verify, then the whole suite**

Run: `node client/src/graph/resolve.test.js`, then `npm test` — all six ok.

- [ ] **Step 5: Commit**

```bash
git add client/src/graph/runMarkers.js client/src/graph/resolve.test.js
git commit -m "Drop a stale run marker when undo restores a deleted node"
```

---

### Task 2: The store primitives a lifecycle mutation can trust

Every later task depends on these. The headline is `readJobsStrict`: `readJobs`'s leniency is right for the sweep and lethal for a mutation.

**Files:**
- Modify: `server/jobs.js` (add six exports; the module-private `enqueue` is why they belong here)
- Test: `server/jobs.test.js`

**Interfaces (Tasks 3, 4 and 5 rely on these exact names and shapes):**
- `readJobsStrict(dir) -> Promise<Job[]>` — `[]` only when the file does not exist; THROWS on anything else (unreadable path, malformed JSON, valid JSON that is not an array).
- `pendingJobsFor(jobs, project?) -> Job[]` — pure. Pending records, filtered to one project when `project` is a string, all pending when it is `null`/`undefined`. A missing `project` field and `''` are the same bucket.
- `copyPendingJobs(fromDir, toDir) -> Promise<{ids: string[], count: number}>` — queued. Strict-reads the source, merges its pending records into the destination. **Leaves the source untouched.** Returns the ids copied, so the caller can drop exactly those later. `{ids: [], count: 0}` when the two paths are the same directory (`dev`+`ino`, non-zero inode) or when there is nothing pending.
- `dropPendingJobs(dir, ids) -> Promise<number>` — queued. Removes records whose id is in `ids` **and whose status is still `pending`**, returns how many. Strict read.
- `failPendingJobs(dir, {project, error}) -> Promise<number>` — queued, strict read.
- `reassignPendingJobs(dir, from, to) -> Promise<number>` — queued, strict read.

- [ ] **Step 1: Write the failing tests**

In `server/jobs.test.js`, extend the import to add `readJobsStrict, pendingJobsFor, copyPendingJobs, dropPendingJobs, failPendingJobs, reassignPendingJobs`, and add before the final `await fs.rm(dir, ...)`:

```js
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
await fs.rm(brokenDir, { recursive: true, force: true });
```

- [ ] **Step 2: Run to verify it fails**

Run: `node server/jobs.test.js` — FAIL: the named imports do not exist.

- [ ] **Step 3: Add the six exports**

In `server/jobs.js`, after `persistJob`. Note `readJobsStrict` goes next to `readJobs` with a comment pointing each at its own audience:

```js
// The strict twin of readJobs, for callers that are about to CHANGE something.
// readJobs answers [] for a missing file, corrupt JSON and an unreadable path
// alike -- deliberate, because refusing to boot the sweep over one bad file is
// worse than losing the ability to resume. A lifecycle mutation is the opposite
// case: "0 pending" read out of a damaged store is indistinguishable from
// "nothing is in flight", and acting on that silently orphans every render the
// store was tracking. So only a MISSING file stays lenient here -- that one
// genuinely means nothing has been saved yet. Everything else throws, and the
// route turns it into a visible failure.
export async function readJobsStrict(dir) {
  let raw;
  try {
    raw = await fs.readFile(jobsPath(dir), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`The job store at ${jobsPath(dir)} could not be read: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`The job store at ${jobsPath(dir)} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`The job store at ${jobsPath(dir)} is not a list of jobs.`);
  return parsed;
}

// Which pending records an action is about to affect. Pending only: a done or
// failed record has already ended, and nothing a user does to a folder or a
// project can strand it. `project` omitted (or null) means every pending record.
// A record written before projects existed has no `project` field at all, so a
// missing one and '' are deliberately the same bucket.
export function pendingJobsFor(jobs, project) {
  const all = jobs.filter((j) => j.status === 'pending');
  if (project === undefined || project === null) return all;
  return all.filter((j) => (j.project || '') === (project || ''));
}

// Same-directory identity. Two spellings of one folder -- a case variant on
// case-insensitive APFS, or /tmp vs /private/tmp through the symlink macOS puts
// in front of it -- are different strings for the same place, and path.resolve
// normalises neither. A zero inode (some Windows network mounts, some FUSE)
// never satisfies this: a needless copy is a no-op, a wrongly skipped one loses
// renders, so an unknown identity errs toward doing the work.
async function sameDirectory(a, b) {
  try {
    const [x, y] = await Promise.all([fs.stat(a), fs.stat(b)]);
    return Boolean(x.ino) && x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false; // one of them does not exist yet, so they cannot be the same
  }
}

// The first half of a committed move: merge the source's pending records into
// the destination and report exactly which ids travelled. The source is NOT
// touched -- that is dropPendingJobs' job, and splitting them is what lets a
// caller commit its own change in between. A failure anywhere after this point
// therefore duplicates a record rather than losing one, which is the only
// direction worth erring in when the record represents a paid render.
export function copyPendingJobs(fromDir, toDir) {
  return enqueue(async () => {
    if (await sameDirectory(fromDir, toDir)) return { ids: [], count: 0 };
    const source = await readJobsStrict(fromDir);
    const pending = pendingJobsFor(source);
    if (!pending.length) return { ids: [], count: 0 };
    const dest = pending.reduce(upsertJob, await readJobsStrict(toDir));
    await writeJobs(toDir, pruneJobs(dest, Date.now()));
    return { ids: pending.map((j) => j.id), count: pending.length };
  });
}

// The second half: strip exactly the ids that were copied, and only while they
// are still pending. By id rather than "every pending record" on purpose -- a
// render started between the copy and this call has not been copied anywhere,
// and dropping it would be the very loss this split exists to prevent.
export function dropPendingJobs(dir, ids) {
  return enqueue(async () => {
    const wanted = new Set(ids);
    const jobs = await readJobsStrict(dir);
    const going = jobs.filter((j) => j.status === 'pending' && wanted.has(j.id));
    if (!going.length) return 0;
    const gone = new Set(going.map((j) => j.id));
    await writeJobs(dir, pruneJobs(jobs.filter((j) => !gone.has(j.id)), Date.now()));
    return going.length;
  });
}

// Ends matching pending records visibly, and reports how many. Other than the
// sweep resolving one, this is the only way a record stops being pending --
// which is exactly why it exists: an action that would otherwise leave a render
// unpollable forever (its project deleted, its key removed) has to be able to
// say so, or the record sits pending until the 24-hour clock and the user never
// learns what happened. `error` reaches the node, so it names the action.
export function failPendingJobs(dir, { project, error }) {
  return enqueue(async () => {
    const jobs = await readJobsStrict(dir);
    const doomed = pendingJobsFor(jobs, project);
    if (!doomed.length) return 0;
    const at = Date.now();
    const ids = new Set(doomed.map((j) => j.id));
    const next = jobs.map((j) => (ids.has(j.id) ? { ...j, status: 'failed', error, resolvedAt: at } : j));
    await writeJobs(dir, pruneJobs(next, at));
    return doomed.length;
  });
}

// Repoints a project's pending records at a new slug, and reports how many. A
// rename is a plain fs.rename of the folder, but a job record carries the slug
// it was created under and collectVideo mkdirs that path when the clip lands --
// so without this, a render finishing after a rename recreates the OLD folder
// and writes itself into a project the user no longer has. Only pending records
// move: a done one names the folder its files already sit in. Exactly
// reversible, which is what lets the rename route undo it when fs.rename fails.
export function reassignPendingJobs(dir, from, to) {
  return enqueue(async () => {
    const jobs = await readJobsStrict(dir);
    const moving = pendingJobsFor(jobs, from);
    if (!moving.length) return 0;
    const ids = new Set(moving.map((j) => j.id));
    const next = jobs.map((j) => (ids.has(j.id) ? { ...j, project: to } : j));
    await writeJobs(dir, pruneJobs(next, Date.now()));
    return moving.length;
  });
}
```

**Leave `migratePendingJobs` and its existing tests exactly where they are in this task.** `server/index.js` still calls it until Task 3, and an ESM named import of a deleted export fails at module load — which would take `host.test.js` (and the server) down at this commit. Task 3 removes the call and the function together. The same-directory reasoning is duplicated between it and the new `sameDirectory` helper for one commit; that is deliberate and temporary.

- [ ] **Step 4: Verify, then the whole suite**

Run: `node server/jobs.test.js`, then `npm test` — all six ok. Nothing is removed in this task, so the suite must be green before you commit; if it is not, something in the additions is wrong.

- [ ] **Step 5: Commit**

```bash
git add server/jobs.js server/jobs.test.js
git commit -m "Give lifecycle mutations a strict store read and a two-phase move"
```

---

### Task 3: An output-folder change commits or leaves everything where it was

Two failure windows to close, in one protocol. Today the route writes `.env`, flips the live binding, and only then migrates inside a catch that logs — so a failed migration answers 200 while the render is orphaned. Simply moving the migration first creates the mirror-image window: records moved, then `.env` fails, and the process and next restart still read the old folder.

**The commit protocol** — the source strip is the commit point, and it happens last:

1. Strict-read and copy pending records into the new store. Failure → **500, nothing has changed anywhere.**
2. Write `.env`. Failure → compensate by dropping the copies from the new store, **500**; the old store never lost a record either way.
3. Flip the live binding.
4. Drop the copied ids from the old store. Failure → log only; the new store is live and authoritative, and the stale copies left behind are the documented duplication-over-loss residual.

No step can lose a record. The worst outcome anywhere is a duplicate in a store nothing reads.

**Files:**
- Modify: `server/index.js` — the jobs import and `PUT /api/config`
- Test: `server/host.test.js`

- [ ] **Step 1: Write the failing tests**

In `server/host.test.js`, after the existing folder-move block, add:

```js
  // A folder change that cannot take its renders must FAIL, not report success
  // and leave them behind. A directory where the destination store belongs is
  // the deterministic way to make the write fail -- the same trick
  // presets.test.js and jobs.test.js use for unreadable paths.
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
  assert.equal((await (await fetch(`${base}/api/health`)).json()).outputDir, outDir,
    'and the folder stays put rather than moving on a store nobody could read');
  await fs.writeFile(path.join(outDir, 'jobs.json'), '[]');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node server/host.test.js` — FAIL at the 500 assertion; the route answers 200 today.

- [ ] **Step 3: Implement the protocol**

Extend the jobs import to `readJobs, readJobsStrict, persistJob, givenUp, pendingJobsFor, copyPendingJobs, dropPendingJobs, failPendingJobs, reassignPendingJobs` (some are for Task 4; adding them now is fine) and drop `migratePendingJobs`.

**Then remove `migratePendingJobs` itself.** Task 2 deliberately left it in place because this route was still calling it; now that the call is gone, delete the function and its comment from `server/jobs.js` and delete its tests from `server/jobs.test.js` (the alias coverage now lives on `copyPendingJobs`). Grep to confirm no caller or test references it before you commit — a leftover named import fails at module load, not at call time.

Replace the section from `try { await writeEnv(updates); }` through the end of the `if (updates.OUTPUT_DIR)` block with:

```js
  // Moving the output folder is a commit protocol, not a sequence of hopeful
  // steps, because every one of them can fail and a pending record is a paid
  // render. The strip of the OLD store is the commit point and comes LAST, so
  // no failure anywhere can lose a record -- the worst outcome is a duplicate
  // in a store nothing reads. See docs/video-and-sharing.md for the row this
  // makes true.
  let copied = { ids: [], count: 0 };
  const nextOutputDir = updates.OUTPUT_DIR ? outputPath(ROOT, updates.OUTPUT_DIR) : null;
  if (nextOutputDir) {
    // 1. Copy first. A strict read is the point: readJobs would answer [] for a
    // corrupt or unreadable store, which reads exactly like "nothing is in
    // flight" and would wave the folder change through, orphaning every render
    // the store was tracking.
    try {
      copied = await copyPendingJobs(OUTPUT_DIR, nextOutputDir);
    } catch (err) {
      return res.status(500).json({
        error: `Could not move the renders already in progress to that folder, so the folder was not changed: ${err.message}`,
      });
    }
  }

  // 2. Commit the setting. If this fails the copies are rolled back, so the old
  // store is still the only place those records live -- exactly as before the
  // request.
  try {
    await writeEnv(updates);
  } catch (err) {
    if (copied.count) {
      try {
        await dropPendingJobs(nextOutputDir, copied.ids);
      } catch (rollbackErr) {
        console.log(`  could not roll back copied jobs: ${rollbackErr.message}`);
      }
    }
    return res.status(500).json({ error: `Could not write .env: ${err.message}` });
  }

  // Apply to the live process too, so nothing needs a restart.
  if (updates.OPENROUTER_API_KEY) API_KEY = updates.OPENROUTER_API_KEY;
  if (updates.OPENROUTER_IMAGE_MODEL) IMAGE_MODEL = updates.OPENROUTER_IMAGE_MODEL;
  if (updates.OPENROUTER_TEXT_MODEL) TEXT_MODEL = updates.OPENROUTER_TEXT_MODEL;
  if (updates.OPENROUTER_VIDEO_MODEL) VIDEO_MODEL = updates.OPENROUTER_VIDEO_MODEL;

  if (nextOutputDir) {
    const previousDir = OUTPUT_DIR;
    OUTPUT_DIR = nextOutputDir; // 3. the new store is authoritative from here
    // 4. Strip the source last, and only the ids that actually travelled -- a
    // render started between the copy and now has not been copied anywhere.
    // Failure here is the one step allowed to be best-effort: the record exists
    // in the store being swept, so nothing is lost, only duplicated in a folder
    // nothing reads.
    if (copied.count) {
      try {
        await dropPendingJobs(previousDir, copied.ids);
      } catch (err) {
        console.log(`  left ${copied.count} job record(s) behind in the old folder: ${err.message}`);
      }
      console.log(`  moved ${copied.count} pending video job(s) to the new output folder`);
    }
  }
```

- [ ] **Step 4: Verify, then the whole suite**

Run: `node server/host.test.js`, then `npm test` — all six ok.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/host.test.js server/jobs.js server/jobs.test.js
git commit -m "Make an output-folder change commit or change nothing"
```

---

### Task 4: Rename, delete and key removal resolve the renders they affect

One rule, three routes: an action that would make a pending render unpollable resolves it first, so it ends visibly instead of sitting pending until the 24-hour clock. **Express 4 sends no response for a rejected async handler**, so every `await` below sits in a `try/catch` that returns a status.

- **Rename** repoints records, then renames the folder. Records first, because a record write is the more reliable of the two and its rollback is another record write. A failed `fs.rename` reassigns them back.
- **Delete** ends records, then removes the folder. Fail-first is the owner's decision and is right: the other order leaves records pointing at a folder that is gone, and the sweep recreates it as a ghost.
- **Key removal** ends every pending record.
- **Key replacement** deliberately does nothing — it is usually a renewed key for the same account, and a genuinely unusable id is already ended by the 24-hour clock.

**One deliberate departure from "strict read blocks the destructive action", for key removal only.** Removing a key is a security action; someone doing it may be responding to a leak. Holding it hostage to a corrupt `jobs.json` is worse than the orphaning it would prevent — and the user can no longer even edit `.env` by hand in a packaged app. So key removal **always removes the key**, attempts the record cleanup after, and *propagates* the failure to the caller as a warning rather than swallowing it. Failure is reported, never hidden; it just does not block. Every other route blocks as specified.

**Files:**
- Modify: `server/index.js` — `POST /api/projects/:name/rename`, `DELETE /api/projects/:name`, `DELETE /api/key`
- Test: `server/host.test.js`

**Interfaces (Task 5 relies on these):**
- `DELETE /api/projects/:name` → `409 {error, pendingRenders}` when the project has pending renders and `confirmRenders=1` is absent; `?confirmRenders=1` → `200 {ok, endedRenders}`.
- `DELETE /api/key` → `200 {ok, endedRenders, renderCleanupError?, ...settings}`.
- `POST /api/projects/:name/rename` → `200 {ok, name, movedRenders}`.

- [ ] **Step 1: Write the failing tests**

In `server/host.test.js`, before the null-guard loop:

```js
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

  // A damaged store blocks the delete outright -- it cannot know what it would strand.
  await fs.mkdir(path.join(outDir, 'unknowable'), { recursive: true });
  await fs.writeFile(path.join(outDir, 'jobs.json'), '{not json');
  assert.equal((await fetch(`${base}/api/projects/unknowable?confirmRenders=1`, { method: 'DELETE' })).status, 500,
    'an unreadable store blocks the delete');
  await fs.access(path.join(outDir, 'unknowable'), 'and the project survives');

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
  await fetch(`${base}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'sk-or-v1-1111111111111111111111111111111111111111111111111111' }),
  });
  assert.equal(
    JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8')).filter((j) => j.status === 'pending').length,
    3, 'replacing the key leaves renders polling');
  await fetch(`${base}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: fakeKey }),
  });
  await fs.writeFile(path.join(outDir, 'jobs.json'), '[]');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node server/host.test.js` — FAIL at the rename assertion.

- [ ] **Step 3: Implement the three routes**

In `POST /api/projects/:name/rename`, replace the body after the existing `fs.access(dest)` collision check with:

```js
  // Records first, folder second. A job record carries the slug it was created
  // under and collectVideo mkdirs that path when the clip lands -- so a render
  // finishing after a rename would recreate the OLD folder and write itself
  // into a project the user no longer has. Repointing first is deliberate: a
  // record write is the more reliable of the two operations and its rollback is
  // another record write, whereas rolling back an fs.rename is another rename
  // that can fail just as easily.
  let moved = 0;
  try {
    moved = await reassignPendingJobs(OUTPUT_DIR, req.params.name, to);
  } catch (err) {
    return res.status(500).json({
      error: `Could not update the renders in progress for this project, so it was not renamed: ${err.message}`,
    });
  }
  try {
    await fs.rename(from, dest);
  } catch (err) {
    // Put the records back, or they point at a name with no folder and the next
    // collection creates one. If even that fails there is nothing left to try,
    // so say both things plainly rather than reporting a clean failure.
    let restored = true;
    try {
      await reassignPendingJobs(OUTPUT_DIR, to, req.params.name);
    } catch (rollbackErr) {
      restored = false;
      console.log(`  could not restore job records after a failed rename: ${rollbackErr.message}`);
    }
    return res.status(500).json({
      error: restored
        ? `Could not rename: ${err.message}`
        : `Could not rename (${err.message}), and ${moved} render(s) in progress are now recorded under "${to}". Renaming the project to "${to}" by hand will reunite them.`,
    });
  }
  res.json({ ok: true, name: to, movedRenders: moved });
```

Replace `DELETE /api/projects/:name` entirely with:

```js
// Deleting a project with renders in flight is the one destructive case here:
// the render is paid for and cannot be stopped upstream, so the most the app
// can do is stop tracking it and say so. Two-phase rather than a client-side
// confirmation alone, so a caller that forgets to ask cannot silently abandon a
// render: without confirmRenders the route reports what is at stake and changes
// nothing.
app.delete('/api/projects/:name', async (req, res) => {
  const name = req.params.name;
  let pending;
  try {
    // Strict: a store that cannot be read cannot tell us what this delete would
    // strand, and guessing "nothing" is how a paid render disappears silently.
    pending = pendingJobsFor(await readJobsStrict(OUTPUT_DIR), name);
  } catch (err) {
    return res.status(500).json({
      error: `Could not check whether this project has renders in progress, so nothing was deleted: ${err.message}`,
    });
  }
  if (pending.length && req.query.confirmRenders !== '1') {
    return res.status(409).json({
      error: `This project has ${pending.length} video render${pending.length === 1 ? '' : 's'} in progress.`,
      pendingRenders: pending.length,
    });
  }
  // Records first, folder second. If the rm then fails, the user retries a
  // delete on a project that is still intact; the other order would leave
  // records pointing at a folder that is gone, and the sweep would recreate it
  // as a ghost holding one clip and no graph.
  let ended = 0;
  if (pending.length) {
    try {
      ended = await failPendingJobs(OUTPUT_DIR, {
        project: name,
        error: 'Stopped tracking this render: the project it belonged to was deleted. It may still finish upstream, but nothing here will save the result.',
      });
    } catch (err) {
      return res.status(500).json({
        error: `Could not stop the renders in progress, so the project was not deleted: ${err.message}`,
      });
    }
    for (const job of pending) revokeJobShares(job.id);
  }
  try {
    await fs.rm(projectDir(name), { recursive: true, force: true });
  } catch (err) {
    // The one partial outcome with no compensation worth having: un-failing a
    // record would claim a render is still being watched when its project may
    // be half-deleted. State both facts instead, so a retry is an informed one.
    return res.status(500).json({
      error: ended
        ? `Stopped ${ended} render(s), but the project folder could not be deleted: ${err.message}. Deleting again is safe.`
        : `Could not delete the project: ${err.message}`,
    });
  }
  res.json({ ok: true, endedRenders: ended });
});
```

In `DELETE /api/key`, after `API_KEY = '';` and before the response:

```js
  // The sweep returns immediately without a key, so every pending render would
  // sit unresolved until the 24-hour clock -- neither collected nor failed,
  // precisely the state the lifecycle contract says cannot happen. Removing a
  // key is an explicit "stop using my account", so ending them now and saying
  // why is the honest answer. REPLACING a key deliberately does not do this: it
  // is usually a renewed key for the same account, and a genuinely unusable id
  // is already ended by the clock.
  //
  // Unlike every other lifecycle mutation here, a store this cannot read does
  // NOT block the action -- the key is already gone by this line, on purpose.
  // Removing a key is a security act, and someone doing it may be responding to
  // a leak; refusing over a corrupt JSON file would be a worse failure than the
  // orphaning it prevents, and in a packaged app they cannot edit .env by hand
  // either. So the failure is REPORTED rather than swallowed, and the caller
  // decides what to say about it.
  let ended = 0;
  let renderCleanupError;
  try {
    ended = await failPendingJobs(OUTPUT_DIR, {
      project: null,
      error: 'Stopped tracking this render: the OpenRouter key was removed, so its progress can no longer be checked. It may still finish upstream, but nothing here will save the result.',
    });
  } catch (err) {
    renderCleanupError = `The key was removed, but renders already in progress could not be stopped: ${err.message}`;
    console.log(`  ${renderCleanupError}`);
  }
  res.json({ ok: true, endedRenders: ended, ...(renderCleanupError ? { renderCleanupError } : {}), ...settings() });
```

- [ ] **Step 4: Verify, then the whole suite**

Run: `node server/host.test.js`, then `npm test` — all six ok.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Rename, delete and key removal resolve the renders they affect"
```

---

### Task 5: The client asks before abandoning a render, and stops swallowing failures

`deleteProject` returns the bare `fetch` and checks nothing, and `confirmDelete` updates the project list regardless of outcome — so today *any* failed delete already looks successful in the UI, and the new `409` would be swallowed the same way.

**Two dialogs rather than one that changes shape.** `deleting` stays exactly as it is (a project name), and a second state drives a second `AlertDialog`. This avoids depending on whether `AlertDialog` closes itself on `onAction`, which would fight a single dialog trying to stay open to escalate.

**Files:**
- Modify: `client/src/api.js` (`deleteProject`), `client/src/App.jsx`

- [ ] **Step 1: Make deleteProject report what happened**

In `client/src/api.js`, replace `deleteProject`:

```js
// Unlike its neighbours this one reads the body: a project with renders in
// flight answers 409 with how many, and the caller escalates its confirmation
// before calling again with confirmRenders. Returning the bare fetch (as this
// did) meant that refusal -- and every other failure -- read as success, and the
// project vanished from the list without being deleted.
export const deleteProject = (name, { confirmRenders } = {}) =>
  fetch(`/api/projects/${encodeURIComponent(name)}${confirmRenders ? '?confirmRenders=1' : ''}`, {
    method: 'DELETE',
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(d.error || `Could not delete the project (${r.status})`);
      err.pendingRenders = d.pendingRenders ?? 0;
      throw err;
    }
    return d;
  });
```

- [ ] **Step 2: Add the second state**

In `client/src/App.jsx`, immediately after the `deleting` declaration (~line 184):

```js
  // Second stage of the delete confirmation, reached only when the server
  // refuses because the project has renders in flight. A separate state (and a
  // separate dialog below) rather than reshaping `deleting`: the first dialog
  // may close itself when its action fires, and a single dialog trying to stay
  // open to escalate would be fighting that.
  const [deleteRenders, setDeleteRenders] = useState(null); // { name, count } | null
```

- [ ] **Step 3: Rewrite confirmDelete and add the escalated handler**

Replace `confirmDelete` (~line 552) with:

```js
  // Shared tail: the project is gone on the server, so bring the UI in line.
  function projectDeleted(name) {
    const rest = projects.filter((p) => p !== name);
    setProjects(rest.length ? rest : ['default']);
    if (project === name) {
      if (rest.length) switchProject(rest[0]);
      else openFresh('default');
    }
  }

  async function confirmDelete() {
    const name = deleting;
    setDeleting(null);
    try {
      await deleteProject(name);
    } catch (err) {
      // A refusal is not a failure: the server is telling us what this delete
      // would abandon so the user can decide. Anything else is a real error,
      // and must NOT remove the project from the list -- doing that regardless
      // of outcome is what made a failed delete look successful.
      if (err.pendingRenders > 0) {
        setDeleteRenders({ name, count: err.pendingRenders });
        return;
      }
      toast({ body: err.message, uniqueID: `delete-project-${name}` });
      return;
    }
    projectDeleted(name);
  }

  async function confirmDeleteWithRenders() {
    const { name } = deleteRenders;
    setDeleteRenders(null);
    try {
      await deleteProject(name, { confirmRenders: true });
    } catch (err) {
      toast({ body: err.message, uniqueID: `delete-project-${name}` });
      return;
    }
    projectDeleted(name);
  }
```

- [ ] **Step 4: Add the escalated dialog**

In `client/src/App.jsx`, directly after the existing delete `AlertDialog` (~line 1389-1395):

```jsx
      <AlertDialog
        isOpen={!!deleteRenders}
        onOpenChange={(open) => !open && setDeleteRenders(null)}
        title="Stop renders and delete?"
        description={`This stops tracking ${deleteRenders?.count} video render${deleteRenders?.count === 1 ? '' : 's'}. They may still complete upstream, but their results will not be saved here.`}
        actionLabel="Stop renders and delete"
        onAction={confirmDeleteWithRenders}
      />
```

- [ ] **Step 5: Surface the key-removal warning**

The settings dialog's key-removal handler (~line 464) sets `removed: true` from `clearKey()`'s response. That response can now carry `renderCleanupError`. Surface it: when present, show it in the dialog's existing error slot (`setCfgDlg((d) => ({ ...d, error: r.renderCleanupError }))` alongside `removed: true`), so a user whose renders could not be stopped learns it rather than seeing a plain success. The key WAS removed in that case — the copy must not suggest otherwise.

- [ ] **Step 6: Verify in the running app (node components have no unit tests by design)**

Start `npm run dev`; confirm `/api/health`'s `outputDir` before doing anything. **Spend nothing** — seed a pending record instead of rendering:

1. Create a scratch project. Write `<OUTPUT_DIR>/jobs.json` with one `pending` record whose `project` is that project and whose id OpenRouter will never know (`vid_probe_not_real`).
2. Delete that project → the first dialog appears; confirming shows the second dialog reading "stops tracking 1 video render"; confirming that deletes it, and `jobs.json` shows the record `failed` naming the deletion.
3. Re-seed, then rename the project → `jobs.json` shows the record repointed and still `pending`; no folder appears under the old name.
4. Re-seed, then remove the API key in Settings → the record ends `failed` naming the key. Put the key back.
5. Delete a project with no pending record → only the original dialog, no second step.
6. Confirm a failed delete no longer removes the project from the list: with the server stopped, attempt a delete and check the project is still listed and a toast explains why.

Then stop the server, delete the scratch project, and reset `jobs.json`.

- [ ] **Step 7: Commit**

```bash
git add client/src/api.js client/src/App.jsx
git commit -m "Confirm before abandoning a render, and stop swallowing a failed delete"
```

---

### Task 6: State the contract, with its preconditions named

**Files:**
- Modify: `docs/video-and-sharing.md`, `CLAUDE.md`, `CHANGELOG.md`
- Report only (gitignored, controller applies): `status.md`

- [ ] **Step 1: Rewrite the contract sentence**

Name exactly these three preconditions, and NOT "the machine must stay reachable" — sleep, tab close, restart and temporary outages are covered by design:

- the server must eventually be able to run again;
- the output storage must remain writable;
- Unframed must retain credentials for the same OpenRouter account that started the job.

- [ ] **Step 2: Update the rows**

Rewrite to what the code now does, setting `Tested?` from what the tests actually reach — do not upgrade a row this branch did not test:

- **changes the output folder** — records are copied first and the source stripped last, so a failure duplicates rather than loses; a change that cannot take them fails with a message and moves nothing.
- **renames the project** — records are repointed before the folder moves, and put back if the move fails. Delete the ghost-project claim.
- **deletes the project** — the app asks first, naming how many renders it will stop tracking, ends those records, then removes the folder. Delete the recreated-folder claim.
- **removes the API key** — every pending record ends, saying the key was removed. Add that **replacing** a key ends nothing, and that a key for a different account leaves the id unpollable until the 24-hour clock.
- Add a row for **a damaged `jobs.json`**: every lifecycle mutation except key removal refuses rather than acting on a store it could not read; key removal proceeds and reports.

- [ ] **Step 3: CLAUDE.md**

Extend the pending-video-job bullet with the rule that makes this coherent: a pending record is the only thing that can strand a paid render, so any action making one unpollable must resolve it visibly — and `readJobs` is deliberately lenient for the sweep while mutations use `readJobsStrict`, because "0 pending" from a damaged store reads exactly like "nothing in flight". Note the ordering rule too: records first, destructive step last, compensate in between.

Add one sentence to the run-markers paragraph: undo restoring a node from a delete keeps `job` and drops `running`, because only the former is durable server-side.

- [ ] **Step 4: CHANGELOG.md**

Extend the existing `## 2026-08-16` → `### Fixed`. User-visible only:

```markdown
- Renaming a project no longer loses a render that is still going. The clip now
  lands in the renamed project instead of recreating the old one.
- Deleting a project with a render in progress now asks first, and says how many
  renders it will stop tracking.
- Removing your OpenRouter key now ends renders in progress with an explanation,
  instead of leaving them spinning with no way to find out what happened.
- Changing the output folder now fails with a message if it cannot take renders in
  progress with it, instead of reporting success and leaving them behind.
- A failed project delete no longer looks like it worked.
- Undo no longer freezes an image or text node that it brings back from a delete.
```

- [ ] **Step 5: Report on status.md**

Read and report (do not edit) whether either 2026-08-16 follow-up todo or either parked item is affected. Expected: none are — both todos (presets baking machine-local paths; no direct test of the unattended sweep) are untouched by this branch.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test` — all six ok.

```bash
git add docs/video-and-sharing.md CLAUDE.md CHANGELOG.md
git commit -m "State the lifecycle contract with its preconditions named"
```

---

## Self-Review

- **Feedback coverage:** (1) strict read → `readJobsStrict` in Task 2, used by every mutation, with a rejects-test per helper and route-level tests in Tasks 3 and 4. (2) commit strategy → Task 3's four-step protocol with rollback at step 2 and best-effort only at the commit-safe step 4. (3) rename compensation → Task 4 reassigns first and reverses on a failed `fs.rename`, reporting both facts if the reversal also fails. (4) no swallowing → every route returns a status from an explicit `try/catch`, with key removal the one documented, reasoned exception (reports rather than blocks). (5) Task 5 is now exact code, including the two-dialog shape that avoids the `AlertDialog` close-semantics risk.
- **Placeholders:** none.
- **Type consistency:** `readJobsStrict`, `pendingJobsFor`, `copyPendingJobs`, `dropPendingJobs`, `failPendingJobs`, `reassignPendingJobs` named identically in Tasks 2, 3 and 4; `endedRenders`/`pendingRenders`/`movedRenders`/`renderCleanupError` consistent between routes, tests and client.
- **Deleted:** `migratePendingJobs` and its tests, superseded by the copy/drop split. Verify no caller remains.
- **Money:** nothing in any test reaches OpenRouter; Task 5's app verification uses a fake job id.
