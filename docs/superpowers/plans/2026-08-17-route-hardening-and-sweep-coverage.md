# Route Hardening and Sweep Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three deferred items from PR #15 with real user stories — routes that hang instead of erroring, the sweep-only branches no test reaches, and the rename-during-download window — in one PR.

**Architecture:** All server-side; no client code changes. (1) Every `await` in a route moves inside a `try/catch` that returns a status, because Express 4 with no error middleware turns a rejection into a hung request, not a 500 — the three money routes' `await orRes.text()` body reads are the expensive cases, wrapped with a message that says the run may still have been charged. (2) The sweep-only branches (`givenUp`, clock-clear, terminal-failure) get end-to-end tests by forking a server against a seeded store and a per-id status stub — the same harness the sweep-race test already proved. (3) `collectVideo` re-reads the job's project after the download, immediately before writing, and returns the project it actually used so both callers' `done` patches name the folder the clip is really in — closing the narrowed rename window and the record/folder mislabel in one change.

**Tech Stack:** Node 18+ built-in `fetch`/`AbortSignal`, Express 4, plain-`node` assert tests (no framework), forked-server harness in `server/host.test.js`.

## Global Constraints

- Work on branch `harden-routes-and-close-sweep-coverage` (already created from up-to-date `main`). Changes land by PR, never a direct push to `main` (CLAUDE.md rule 1).
- No new dependencies. No new HTTP endpoint.
- Nothing that spends money in any test. Every upstream call in a new test goes to a local stub or is expected to fail before spending (the existing fake-key 401 pattern).
- Tests are plain `node` assert files run by `npm test`.
- **Express 4 here has no error-handling middleware.** An `async` route handler that rejects produces an unhandled rejection and NEVER sends a response — the request hangs until the client times out. Every `await` this plan touches must end up inside an explicit `try/catch` that returns a status. No exceptions.
- Test-only URL overrides follow the existing precedent exactly: an `UNFRAMED_TEST_*` env var, read once at module level, unset — and therefore inert — in every real environment (see `VIDEOS_STATUS_BASE`, `server/index.js:910`).
- Comments explain WHY, matching the surrounding density and voice.
- `CHANGELOG.md` is user-visible only; `## YYYY-MM-DD` headings with `### Added`/`### Changed`/`### Fixed`.
- `status.md` is gitignored: edit it directly in the working tree, never `git add` it.
- Two items stay parked, per the owner's decision (2026-08-17): the ~1ms mid-commit window and the rename rollback not being an exact inverse. Task 5 records how each could bite, in their existing "Known, parked" lines. Do not implement either.
- Out of scope entirely: the preset-assets design (outputs/inputs optionally baked into a preset at save time). Owner chose the direction on 2026-08-17 but it needs its own spec first; Task 5 records the decision in `status.md`. Do not start it here.

---

### Task 1: The three money routes answer instead of hanging when the response body dies

`POST /api/generate`, `POST /api/text` and `POST /api/video` each wrap only the `fetch()` in `try/catch`; the `await orRes.text()` that reads the body sits just outside it. A socket dropping mid-body-read — after OpenRouter accepted the request, so after the money is spent — rejects there, and the request hangs. The user loses a paid generation to a spinner with no error.

**All three share one helper** (owner's decision, 2026-08-17, over three inline copies): `readUpstreamBody(orRes, what)` returns `{raw}` or `{error}`. This follows the repo's own precedent — `fetchVideoStatus` exists so "ask upstream" has one implementation — and it is what makes a single test cover all three routes rather than one, since the other two call the same code. Each route keeps what is genuinely its own: `/api/video` revokes its minted share tokens like every other failure branch in that route, and `what` names the thing the user paid for so the copy fits.

The test drives `/api/text` (the simplest — no share tokens), via a stub that sends headers plus half a body and then destroys the socket.

**Files:**
- Modify: `server/index.js` — a `CHAT_COMPLETIONS_URL` const and the `readUpstreamBody` helper above `POST /api/text` (~line 436), and the three `const raw = await orRes.text();` lines (~482 in `/api/text`, ~830 in `/api/video`, ~1373 in `/api/generate`)
- Test: `server/host.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `readUpstreamBody(orRes, what) -> Promise<{raw: string} | {error: string}>` — module-private in `server/index.js`, called by all three generation routes and nothing else. `UNFRAMED_TEST_CHAT_COMPLETIONS_URL` (env, test-only), consumed only by this task's test.

- [ ] **Step 1: Write the failing test**

In `server/host.test.js`, add the stub next to `statusStub` (directly after the `statusStubBase` line, before the `fork`):

```js
// Stands in for OpenRouter's chat-completions endpoint, dying mid-body: headers
// and half a JSON answer, then the socket is destroyed. This is the failure the
// money routes could not survive -- the fetch() succeeds (headers arrived), so
// the existing try/catch is already passed, and the `await orRes.text()` body
// read is what rejects. Money is spent at this point: OpenRouter accepted the
// request before the connection died. Same override pattern as the status stub
// above: UNFRAMED_TEST_CHAT_COMPLETIONS_URL is unset, and therefore inert, in
// every real environment.
const midBodyStub = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.write('{"choices":[{"message":{"content":"half an ans');
  setTimeout(() => res.destroy(), 50);
});
await new Promise((resolve) => midBodyStub.listen(0, '127.0.0.1', resolve));
const midBodyStubBase = `http://127.0.0.1:${midBodyStub.address().port}/api/v1/chat/completions`;
```

Add to the first `fork`'s env block (next to `UNFRAMED_TEST_VIDEOS_STATUS_BASE`):

```js
    UNFRAMED_TEST_CHAT_COMPLETIONS_URL: midBodyStubBase,
```

Add to the `finally` block that closes `statusStub`:

```js
  await new Promise((resolve) => midBodyStub.close(resolve));
```

Then add the test itself, after the key-replacement block (the one asserting `'replacing the key leaves renders polling'` and its cleanup `await fs.writeFile(path.join(outDir, 'jobs.json'), '[]');`) and before the `for (const route of ['/api/video', '/api/generate'])` null-guard loop:

```js
  // A response body that dies mid-read must produce an ERROR, not a hang.
  // Express 4 with no error middleware sends nothing at all for a rejected
  // async handler -- the request just sits until the client gives up, which for
  // a paid call means the user loses a generation to a spinner with no message.
  // The try in these routes wraps only the fetch(); the body read is a second
  // network operation and used to sit outside it. The timeout on this fetch is
  // the hang detector: before the fix the route never answers and the abort
  // fires, failing the test.
  const midBodyRes = await fetch(`${base}/api/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'a prompt whose answer dies mid-read' }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(midBodyRes.status, 502, 'a dead body read answers 502 instead of hanging');
  const midBodyBody = await midBodyRes.json();
  assert.match(midBodyBody.error, /reading OpenRouter/i, 'and says the answer could not be read');
  assert.match(midBodyBody.error, /charged/i, 'and warns the run may still have been charged');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node server/host.test.js`
Expected: FAIL — the fetch aborts after 5s (`TimeoutError`/`AbortError`), because the route never answers. That IS the bug.

- [ ] **Step 3: Implement the wraps**

In `server/index.js`, directly above `app.post('/api/text', ...)` (~line 436), add:

```js
// Same test-only override pattern as VIDEOS_STATUS_BASE below: unset -- and
// therefore inert -- in every real environment. What it buys is the one
// deterministic way to make a response BODY die mid-read in a test, which no
// real endpoint will do on demand.
const CHAT_COMPLETIONS_URL =
  process.env.UNFRAMED_TEST_CHAT_COMPLETIONS_URL || 'https://openrouter.ai/api/v1/chat/completions';

// Reading a response BODY is a second network operation after the fetch that
// delivered the headers, and it can die on its own -- after OpenRouter accepted
// the request, so after the money is spent. Unwrapped, that rejection hangs the
// request (Express 4 here has no error-handling middleware, so a rejected async
// handler sends NO response) and the user loses a paid run to a spinner with no
// message. One implementation for all three generation routes, the same reason
// fetchVideoStatus below exists: "ask upstream" is one behaviour, not three.
// `what` names the thing the user paid for, so the copy fits the route. Callers
// keep their own cleanup -- /api/video's minted share tokens, for one.
async function readUpstreamBody(orRes, what) {
  try {
    return { raw: await orRes.text() };
  } catch (err) {
    return {
      error: `Lost the connection while reading OpenRouter's answer: ${err.message}. The ${what} may still have completed and been charged — check your OpenRouter activity page.`,
    };
  }
}
```

In `POST /api/text`, change the fetch target from the literal `'https://openrouter.ai/api/v1/chat/completions'` to `CHAT_COMPLETIONS_URL`, and replace:

```js
  const raw = await orRes.text();
```

with:

```js
  const { raw, error: bodyError } = await readUpstreamBody(orRes, 'run');
  if (bodyError) return res.status(502).json({ error: bodyError });
```

In `POST /api/generate` (~line 1373), replace `const raw = await orRes.text();` with:

```js
  const { raw, error: bodyError } = await readUpstreamBody(orRes, 'run');
  if (bodyError) return res.status(502).json({ error: bodyError });
```

In `POST /api/video` (~line 830), the same — plus the share-token revocation every other failure branch in that route performs:

```js
  const { raw, error: bodyError } = await readUpstreamBody(orRes, 'render');
  if (bodyError) {
    // Like every other failure branch in this route: a job nothing will ever
    // learn about has no refs left to fetch, so its share tokens go dark.
    for (const t of mintedTokens) revokeShare(t);
    return res.status(502).json({ error: bodyError });
  }
```

Note the rename to `bodyError`: all three routes already have an `err` in scope from the surrounding `catch` blocks, and `/api/video` also has `error` on the parsed upstream payload — a bare `error` would shadow confusingly.

- [ ] **Step 4: Run to verify it passes, then the whole suite**

Run: `node server/host.test.js`, then `npm test` — all six ok.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Answer with an error, not a hang, when a paid call's body read dies"
```

---

### Task 2: The bookkeeping routes answer instead of hanging

Four unprotected awaits remain after Task 1, all cheaper failures but the same hang: `PUT /api/projects/:name` (autosave — a disk error hangs every save while the UI looks fine, silently lost work), `GET /api/projects` (project list never loads), `PUT /api/presets` (preset save looks like it worked), and `GET /api/video/:id`'s terminal-failure `persistJob` (mildest — the sweep retries regardless).

All four get deterministic tests via the directory-where-a-file-belongs trick this repo's tests already use — including the `persistJob` one. (This plan originally claimed a `persistJob` rejection was not cheaply inducible from outside the process and told the implementer to skip that test. That was false, caught in Task 2's review on 2026-08-17 and corrected: making `jobs.json` a directory makes `writeJobs`' rename fail with `EISDIR`, and `readJobs` swallows its own read error so the route still reaches the branch under test.)

**A fifth call site, added in Task 2's fix round (owner-approved 2026-08-17):** `fetchVideoStatus` (~line 985) reads its response body with a bare `await r.text()` outside its own try/catch, making its "Never throws" comment false. `sweepOne` catches, so the sweep survives — but `GET /api/video/:id` awaits it outside any try, so a status answer dying mid-body hangs that route and can kill the process. It returns the existing `{ok: false, networkError}` shape, because "could not read the answer" means what "could not reach" means to both callers, and the 24h give-up clock counts it identically. Untested on purpose: the mid-body stub is wired to chat-completions, and re-pointing it at the video status base would disturb the video tests that depend on that stub.

**Files:**
- Modify: `server/index.js` — `GET /api/projects` (~line 547), `PUT /api/projects/:name` (~line 562), `PUT /api/presets` (~line 699), and the terminal-failure `persistJob` in `GET /api/video/:id` (~line 1206)
- Test: `server/host.test.js`

**Interfaces:** nothing new — behaviour only.

- [ ] **Step 1: Write the failing tests**

In `server/host.test.js`, directly after Task 1's mid-body block (still before the null-guard loop):

```js
  // The same hang, three cheaper doors. Each of these routes awaits filesystem
  // work outside any try/catch, so a disk error was a request that never
  // answered -- for the first one that is AUTOSAVE, work that looks saved and
  // is not. A directory where the file belongs is the deterministic way to make
  // each write fail (the presets.test.js / jobs.test.js trick); the timeout on
  // each fetch is the hang detector.

  // PUT /api/projects/:name -- autosave.
  await fs.mkdir(path.join(outDir, 'wrapcheck', 'graph.json'), { recursive: true });
  const saveBlocked = await fetch(`${base}/api/projects/wrapcheck`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes: [], edges: [] }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(saveBlocked.status, 500, 'a save that cannot write answers 500 instead of hanging');
  assert.match((await saveBlocked.json()).error, /save/i, 'and says the save is what failed');
  await fs.rm(path.join(outDir, 'wrapcheck'), { recursive: true, force: true });

  // PUT /api/presets.
  await fs.mkdir(path.join(outDir, 'presets.json'));
  const presetsBlocked = await fetch(`${base}/api/presets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([]),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(presetsBlocked.status, 500, 'a preset write that cannot land answers 500 instead of hanging');
  await fs.rm(path.join(outDir, 'presets.json'), { recursive: true, force: true });

  // GET /api/projects -- a FILE where OUTPUT_DIR belongs makes both its awaits
  // (mkdir, readdir) fail. Moved aside and restored rather than left broken,
  // since every test after this still uses outDir. The sweep may tick while the
  // dir is a file; readJobs is lenient by design and reads that as [], writing
  // nothing, so this cannot corrupt anything.
  await fs.rename(outDir, `${outDir}-moved`);
  await fs.writeFile(outDir, 'not a directory');
  const listBlocked = await fetch(`${base}/api/projects`, { signal: AbortSignal.timeout(5000) });
  assert.equal(listBlocked.status, 500, 'an unlistable output folder answers 500 instead of hanging');
  await fs.rm(outDir);
  await fs.rename(`${outDir}-moved`, outDir);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node server/host.test.js`
Expected: FAIL — the first blocked fetch aborts on its 5s timeout (the route hangs today).

- [ ] **Step 3: Implement the wraps**

In `server/index.js`, replace `GET /api/projects` (~line 547) with:

```js
app.get('/api/projects', async (req, res) => {
  // Express 4 with no error middleware: a rejection here used to hang the
  // request, and the project list simply never loaded, with nothing to show why.
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true });
    res.json({ projects: entries.filter((e) => e.isDirectory()).map((e) => e.name) });
  } catch (err) {
    res.status(500).json({ error: `Could not list the output folder: ${err.message}` });
  }
});
```

Replace `PUT /api/projects/:name` (~line 562) with:

```js
app.put('/api/projects/:name', async (req, res) => {
  // This is AUTOSAVE. Unwrapped, a full disk or a permissions change hung every
  // save while the canvas looked fine -- silently lost work, the worst version
  // of the no-error-middleware hang.
  try {
    const dir = projectDir(req.params.name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'graph.json'), JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Could not save the project: ${err.message}` });
  }
});
```

Replace `PUT /api/presets` (~line 699) with:

```js
app.put('/api/presets', async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected an array of presets.' });
  try {
    await writePresets(OUTPUT_DIR, req.body);
    res.json({ ok: true });
  } catch (err) {
    // Unwrapped this hung -- and a preset save that never answers reads as a
    // preset saved, which presets.json's never-rewritten rule makes permanent.
    res.status(500).json({ error: `Could not save the presets: ${err.message}` });
  }
});
```

In `GET /api/video/:id`, replace the terminal-failure block's persist (~line 1206):

```js
      const job = await persistJob(OUTPUT_DIR, id, { status: 'failed', error: message, resolvedAt: Date.now() });
      return res.json(failedResponse(job));
```

with:

```js
      // The one await in this route outside the collect block's try. A rejected
      // store write here hung the poll; the failure still reached the store via
      // the sweep eventually, but the browser sat on a request that never
      // answered. Review-verified rather than tested: a persistJob rejection is
      // not cheaply inducible from outside the process.
      try {
        const job = await persistJob(OUTPUT_DIR, id, { status: 'failed', error: message, resolvedAt: Date.now() });
        return res.json(failedResponse(job));
      } catch (err) {
        return res.status(502).json({
          error: `The render failed upstream (${message}), but recording that failed too: ${err.message}`,
        });
      }
```

- [ ] **Step 4: Run to verify it passes, then the whole suite**

Run: `node server/host.test.js`, then `npm test` — all six ok.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Wrap the bookkeeping routes so a disk error answers instead of hanging"
```

---

### Task 3: The sweep-only branches get end-to-end tests (test-only)

`sweepOneInner`'s give-up, clock-clear and terminal-failure branches are each reached ONLY through the sweep; what `host.test.js` covers today is the poll route's equivalents. The sweep-race harness already proved the shape: seed `jobs.json` BEFORE the fork and the boot sweep — the identical function the 30s interval runs — exercises the real code with zero client polling. One fork, three seeded jobs, one per-id stub.

No production code changes in this task. If any of these tests fails, that is a finding, not a fixture problem — stop and investigate before touching the assertions.

**Files:**
- Test: `server/host.test.js` — a new block after the existing sweep-staleness block

**Interfaces:**
- Consumes: `waitForMessage(proc, type, ms)` (already factored out at the top of the file for exactly this reuse), the `UNFRAMED_TEST_VIDEOS_STATUS_BASE` override, and the give-up message shape from `sweepOneInner` (`Stopped checking after 24 hours with no answer about this render. The last attempt said: ...`).

- [ ] **Step 1: Write the tests**

In `server/host.test.js`, after the sweep-staleness block's closing brace, add:

```js
// ---- the sweep-only branches (2026-08-17) ----
// givenUp, the clock-clear, and terminal failure are each reached ONLY through
// the sweep -- the poll route has its own equivalents, and those are what the
// tests above exercise. Same harness as the sweep-staleness test: jobs seeded
// before the fork, so the boot-time sweepJobs() -- the identical function the
// 30s interval runs -- processes them against a stub that answers per id.
{
  const dataDir3 = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-sweep-branches-'));
  const outDir3 = path.join(dataDir3, 'out');
  await fs.mkdir(outDir3, { recursive: true });

  const HOUR = 60 * 60 * 1000;
  await fs.writeFile(
    path.join(outDir3, 'jobs.json'),
    JSON.stringify([
      {
        // 25 continuous hours of silence: past the 24h window, so the sweep must
        // END this record -- the only way an id OpenRouter has forgotten ever
        // stops being re-polled every 30 seconds.
        id: 'giveup-job',
        project: '',
        params: { prompt: 'a render nobody can ask about', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now() - 26 * HOUR,
        unreachableSince: Date.now() - 25 * HOUR,
        status: 'pending',
      },
      {
        // Marked unreachable ten minutes ago, but the stub ANSWERS for it now --
        // any answer at all, even "still queued", must clear the clock, or a blip
        // today and a blip tomorrow add up to a day of silence.
        id: 'clockclear-job',
        project: '',
        params: { prompt: 'a blip, not a death', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now() - HOUR,
        unreachableSince: Date.now() - 10 * 60 * 1000,
        status: 'pending',
      },
      {
        // The provider killed it. The sweep's own terminal-failure branch -- not
        // the poll route's, which the expired-job test further up already pins --
        // must fail the record with the provider's message.
        id: 'sweep-terminal-job',
        project: '',
        params: { prompt: 'killed upstream, no browser open', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now() - HOUR,
        status: 'pending',
      },
    ]),
  );

  // Per-id answers: giveup-job is deliberately ABSENT, so the stub 404s it --
  // the exact shape an id OpenRouter has forgotten produces.
  const branchResponses = {
    'clockclear-job': { status: 'queued' },
    'sweep-terminal-job': { status: 'expired', error: 'Job exceeded maximum time to live' },
  };
  const branchStub = http.createServer((req, res) => {
    const id = decodeURIComponent(req.url.split('/').pop());
    const body = branchResponses[id];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body || { error: `no stub for ${id}` }));
  });
  await new Promise((resolve) => branchStub.listen(0, '127.0.0.1', resolve));

  const child3 = fork(path.join(here, 'index.js'), {
    env: {
      ...process.env,
      UNFRAMED_DATA_DIR: dataDir3,
      OUTPUT_DIR: outDir3,
      PORT: '0',
      OPENROUTER_API_KEY: 'sk-or-v1-sweep-branches-000000000000000000000000000',
      UNFRAMED_TEST_VIDEOS_STATUS_BASE: `http://127.0.0.1:${branchStub.address().port}/api/v1/videos`,
    },
    stdio: 'ignore',
  });

  try {
    await waitForMessage(child3, 'ready');

    // The boot sweep resolves all three; poll the store until it has.
    let jobs;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      jobs = JSON.parse(await fs.readFile(path.join(outDir3, 'jobs.json'), 'utf8').catch(() => '[]'));
      const giveup = jobs.find((j) => j.id === 'giveup-job');
      const terminal = jobs.find((j) => j.id === 'sweep-terminal-job');
      const cleared = jobs.find((j) => j.id === 'clockclear-job');
      if (giveup?.status === 'failed' && terminal?.status === 'failed' && cleared && !('unreachableSince' in cleared)) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const giveup = jobs.find((j) => j.id === 'giveup-job');
    assert.equal(giveup?.status, 'failed', 'after 24h of continuous silence the sweep ends the record');
    assert.match(giveup.error, /24 hours/, 'and the reason says how long it tried');
    assert.match(giveup.error, /OpenRouter \(404\)/, 'and carries what the last attempt actually said');
    assert.ok(Number.isFinite(giveup.resolvedAt), 'resolvedAt is stamped so pruneJobs can age it out');

    const cleared = jobs.find((j) => j.id === 'clockclear-job');
    assert.equal(cleared?.status, 'pending', 'a job that answered stays pending -- an answer is not a failure');
    assert.equal('unreachableSince' in cleared, false,
      'and the silence clock is CLEARED, so two blips a day apart never add up to 24 hours');

    const terminal = jobs.find((j) => j.id === 'sweep-terminal-job');
    assert.equal(terminal?.status, 'failed', 'the sweep ends a job the provider killed, with no browser open');
    assert.equal(terminal.error, 'Job exceeded maximum time to live',
      "and the record carries the provider's own message, not a generic one");
  } finally {
    child3.kill();
    await new Promise((resolve) => branchStub.close(resolve));
    await fs.rm(dataDir3, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Run the suite**

Run: `node server/host.test.js`, then `npm test` — all six ok. These tests should pass immediately: the branches exist and are believed correct; what was missing was proof. If one fails, the branch has a real bug — investigate it, do not adjust the assertion.

- [ ] **Step 3: Verify each test can fail**

The repo's standard for a new test is that it fails when the code it pins is broken. Check the three cheaply, one at a time, reverting each break before the next:

1. In `server/jobs.js`, change `UNREACHABLE_MS` to `Infinity` → the give-up assertions fail (record stays pending). Revert.
2. In `server/index.js` `sweepOneInner`, comment out the `if (job.unreachableSince) await persistJob(...unreachableSince: undefined...)` line → the clock-clear assertion fails. Revert.
3. In `sweepOneInner`, change `isTerminalFailure(status)` to `false &&` it → the terminal assertions fail. Revert.

Run `node server/host.test.js` after each break and after the final revert (must be green).

- [ ] **Step 4: Commit**

```bash
git add server/host.test.js
git commit -m "Test the sweep's give-up, clock-clear and terminal branches end to end"
```

---

### Task 4: `collectVideo` re-reads the project at write time, and done records name the folder they used

Two related residues from PR #15's `850666b`. First, the narrowed-but-open window: `collectVideo` computes its output folder from the `job.project` it was HANDED, then downloads for up to 300s, then writes — a rename landing during the download still puts the clip under the old name. Second, the mislabel: the sweep's `done` patch never touches `project` (so the merged record keeps the renamed value while `savedPath` points into the old folder), and the poll route's `done` patch writes `project: job.project` from the same pre-download read — either way, a record whose `project` and `savedPath` disagree.

One change closes both: re-read the store after the download completes, immediately before the write, use THAT record's project for the folder, and return the project actually used so both callers persist it into the `done` record. The record and the folder can no longer disagree, whatever the timing.

**Files:**
- Modify: `server/index.js` — `collectVideo` (~line 987, the `dir` computation) and its two callers' `done` persists (sweep ~line 1125, poll route ~line 1240); also the sweep's now-stale explanatory comment (~1189-1201), which currently credits `collectVideo`'s late `.project` read with the ghost-folder bug this task moves inside `collectVideo` itself
- Test: `server/host.test.js` — a new block after Task 3's block, plus the older sweep-staleness block's comment (~758-767), whose "must fail before the fix" claim stops being true once the re-read lives in `collectVideo`

**Both callers need their own test.** The sweep-driven test alone cannot pin either `done` patch: after a rename, `reassignPendingJobs` has already set the record's `project`, and `persistJob` merges onto it, so the assertion passes whether or not the patch supplied it. The poll route needs its own coverage for the same reason and one sharper one — with no store record it takes the `const job = fresh || {…}` branch, which is the only path that exercises the fallback and the only one that would have caught the shadowing bug described below. Cover two cases through the poll route: no store record at all (asserting a 200 and a written clip), and a rename landing during a parked download (asserting `savedPath` and the record's `project` both name the new project).

**Interfaces:**
- Consumes: `readJobs(dir)` from `server/jobs.js` (lenient on purpose: a damaged store falls back to the handed job, same tolerance both callers already have).
- Produces: `collectVideo(job, data) -> Promise<{savedPath, cost, project}>` — `project` is the value the folder was actually resolved from. Both callers in this task consume it; nothing else calls `collectVideo`.

- [ ] **Step 1: Write the failing test**

In `server/host.test.js`, after Task 3's block, add:

```js
// ---- rename during the download window (2026-08-17) ----
// 850666b narrowed the stale-project window to "between sweepOneInner's store
// re-read and collectVideo's write" -- but collectVideo's own download sits
// inside that gap and can run for up to 300s. This holds the download open,
// lands a real rename while it is open, then releases it: fully deterministic,
// no timing luck. Two things must be true after: the clip is written under the
// NEW name, and the done record's `project` names the folder its savedPath is
// actually in -- before this fix the sweep's done patch never set `project` at
// all, so the record said "beta" while the file sat in "alpha".
{
  const dataDir4 = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-download-rename-'));
  const outDir4 = path.join(dataDir4, 'out');
  await fs.mkdir(path.join(outDir4, 'alpha'), { recursive: true });

  const holdJobId = 'held-download-job';
  await fs.writeFile(
    path.join(outDir4, 'jobs.json'),
    JSON.stringify([
      {
        id: holdJobId,
        project: 'alpha',
        params: { prompt: 'renamed mid-download', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now(),
        status: 'pending',
      },
    ]),
  );

  // Status answers "completed" immediately; the DOWNLOAD is parked until the
  // test releases it, after the rename has landed.
  let holdBase;
  let releaseDownload;
  const downloadArrived = new Promise((resolve) => {
    releaseDownload = resolve;
  });
  const holdServer = http.createServer((req, res) => {
    if (req.url.startsWith('/api/v1/videos/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'completed', unsigned_urls: [`${holdBase}/clip.mp4`] }));
      return;
    }
    // The download leg: signal the test it has started, and park the response
    // object for the test to finish later.
    downloadArrived.parked = res;
    releaseDownload();
  });
  await new Promise((resolve) => holdServer.listen(0, '127.0.0.1', resolve));
  holdBase = `http://127.0.0.1:${holdServer.address().port}`;

  const child4 = fork(path.join(here, 'index.js'), {
    env: {
      ...process.env,
      UNFRAMED_DATA_DIR: dataDir4,
      OUTPUT_DIR: outDir4,
      PORT: '0',
      OPENROUTER_API_KEY: 'sk-or-v1-download-rename-00000000000000000000000000',
      UNFRAMED_TEST_VIDEOS_STATUS_BASE: `${holdBase}/api/v1/videos`,
    },
    stdio: 'ignore',
  });

  try {
    const ready4 = await waitForMessage(child4, 'ready');
    const base4 = `http://127.0.0.1:${ready4.port}`;

    // Wait until the sweep is INSIDE the download -- past its own store
    // re-read, which is exactly the window 850666b left open.
    await downloadArrived;

    const renamed = await fetch(`${base4}/api/projects/alpha/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'beta' }),
    });
    assert.equal(renamed.status, 200, 'the mid-download rename itself must succeed for this test to mean anything');

    // NOW let the download finish.
    downloadArrived.parked.writeHead(200, { 'Content-Type': 'video/mp4' });
    downloadArrived.parked.end('bytes standing in for a clip');

    let record;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const jobs = JSON.parse(await fs.readFile(path.join(outDir4, 'jobs.json'), 'utf8').catch(() => '[]'));
      record = jobs.find((j) => j.id === holdJobId);
      if (record?.status === 'done') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(record?.status, 'done', 'the sweep collected the held job within the deadline');
    assert.match(record.savedPath, /[\\/]beta[\\/]/,
      'the clip lands under the RENAMED project even when the rename arrives mid-download');
    assert.equal(record.project, 'beta',
      "and the done record's project names the folder its savedPath is actually in");
    const ghostAlpha = await fs.access(path.join(outDir4, 'alpha')).then(() => true, () => false);
    assert.equal(ghostAlpha, false, 'and the old folder is not recreated as a ghost');
  } finally {
    child4.kill();
    await new Promise((resolve) => holdServer.close(resolve));
    await fs.rm(dataDir4, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node server/host.test.js`
Expected: FAIL at `the clip lands under the RENAMED project…` — `savedPath` contains `/alpha/`, because `collectVideo` resolved the folder from the record as it stood before the download.

- [ ] **Step 3: Implement**

In `server/index.js`, in `collectVideo`, replace:

```js
  const { prompt = '', model = '', duration, resolution, size } = job.params || {};
  const dir = job.project ? projectDir(job.project) : OUTPUT_DIR;
```

with:

```js
  const { prompt = '', model = '', duration, resolution, size } = job.params || {};
  // Resolve the project AFTER the download, from the store as it stands NOW.
  // The download above can run for minutes, and `job` was read before it
  // started -- a rename landing in between is exactly what used to recreate the
  // old folder as a ghost (the same bug 850666b fixed one call frame up, left
  // open here for the length of the download). `current` can legitimately be
  // absent -- a damaged or replaced store -- so fall back to the handed job,
  // the same tolerance both callers already have. Not `||`: '' is a real value
  // meaning "no project".
  const current = (await readJobs(OUTPUT_DIR)).find((j) => j.id === job.id);
  const project = current ? current.project : job.project;
  const dir = project ? projectDir(project) : OUTPUT_DIR;
```

and change the return line from:

```js
  return { savedPath: videoPath, cost };
```

to:

```js
  // `project` rides along so the callers' done patches can record the folder
  // the clip ACTUALLY went into. Without it the sweep's patch left `project`
  // untouched and the poll route's wrote its own pre-download copy -- either
  // way a record whose project and savedPath could disagree after a rename.
  return { savedPath: videoPath, cost, project };
```

In the sweep (`sweepOneInner`, ~line 1125), replace:

```js
    const { savedPath, cost } = await collectVideo(fresh || job, data);
    await persistJob(OUTPUT_DIR, job.id, { status: 'done', savedPath, cost, resolvedAt: Date.now() });
```

with:

```js
    const { savedPath, cost, project } = await collectVideo(fresh || job, data);
    await persistJob(OUTPUT_DIR, job.id, { status: 'done', savedPath, cost, project, resolvedAt: Date.now() });
```

In the poll route (~line 1240), replace:

```js
    const { savedPath, cost } = await collectVideo(job, data);
    const saved = await persistJob(OUTPUT_DIR, id, {
      project: job.project,
```

with:

```js
    const { savedPath, cost, project: usedProject } = await collectVideo(job, data);
    const saved = await persistJob(OUTPUT_DIR, id, {
      project: usedProject,
```

(the rest of that persist — `params`, `refs`, `status`, `savedPath`, `cost`, `resolvedAt` — stays exactly as it is).

**The rename to `usedProject` is load-bearing, not style.** This route already binds `project` from `req.query` above, and a bare `const { … project }` here is declared inside the `try` block — which shadows it for the whole block and puts the earlier `project: project || null` read (in the `const job = fresh || {…}` fallback) in its temporal dead zone. That throws `ReferenceError` whenever `fresh` is falsy — the job is absent from the store, which is exactly the pre-store-era and damaged-`jobs.json` cases the comment above it names — and never throws when it is truthy, so a test suite that always seeds the store stays green while a paid render is lost in silence. This plan shipped the bare version first; it was caught in Task 4's review on 2026-08-17 and is corrected here.

- [ ] **Step 4: Run to verify it passes, then the whole suite**

Run: `node server/host.test.js`, then `npm test` — all six ok. The existing sweep-staleness test must still pass untouched: its rename lands before the status answer, so the earlier fix still covers it, and this change only moves the project read later.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Resolve a clip's project at write time, not before the download"
```

---

### Task 5: Docs, changelog, and status.md

**Files:**
- Modify: `docs/video-and-sharing.md` (rows and footnotes 8, 9, 10, 15), `CLAUDE.md` (one sentence in the server bullet), `CHANGELOG.md` (new `## 2026-08-17` section)
- Edit directly, never `git add`: `status.md` (gitignored)

**Interfaces:** none — documentation.

- [ ] **Step 1: Upgrade the matrix rows the new tests earn**

In `docs/video-and-sharing.md`:

Row 8 (`the provider ends the job…`): change `partial [^8]` to `yes [^8]`, and replace footnote 8 with:

```markdown
[^8]: Terminal-status classification and message handling are tested on both paths: via the poll route (`expired-job`/`still-going-job` cases in `host.test.js`) and, since 2026-08-17, via the sweep itself — the sweep-branches block forks a server against a seeded store and asserts the real boot sweep fails the record with the provider's own message, no browser involved.
```

Row 9 (`the provider forgets the job id…`): change `partial [^9]` to `yes [^9]`, and replace footnote 9 with:

```markdown
[^9]: The 24h threshold is unit-tested (`givenUp` cases in `jobs.test.js`), and since 2026-08-17 the sweep-branches block in `host.test.js` seeds a record 25 hours unreachable, lets the real boot sweep poll a stub that 404s it, and asserts the record ends `failed` with the give-up message and what the last attempt said.
```

Row 10 (`the connection…blips…`): change `partial [^10]` to `yes [^10]`, and replace footnote 10 with:

```markdown
[^10]: Clearing the flag on disk is unit-tested (clock-clear case in `jobs.test.js`), and since 2026-08-17 the sweep-branches block in `host.test.js` seeds a record mid-silence, has the stub answer "queued", and asserts the real sweep clears `unreachableSince` while leaving the record pending.
```

Row 15 (`the user renames the project`): in the row's "What happens" cell, replace the final sentence (the one beginning `A narrower, known gap remains:`) with:

```markdown
Since 2026-08-17 the download window is closed too: `collectVideo` re-reads the project from the store after the download, immediately before writing, and the done record names the folder the clip actually went into.
```

And in footnote 15, replace everything from `Known and left open, by design rather than by omission:` to the end of the footnote with:

```markdown
Closed 2026-08-17: `collectVideo` now re-reads the store after its download and resolves the folder from that, and both callers persist the project it actually used into the `done` record — the held-download test in `host.test.js` parks a real download, lands a real rename while it is parked, and asserts the clip and its record both name the new project. What remains is only the instant between that final read and the `fs.writeFile` — no longer a network-length window, and a record can no longer disagree with its own `savedPath` either way.
```

- [ ] **Step 2: CLAUDE.md**

In the server bullet of `CLAUDE.md` (the one beginning `**Server is one file plus four modules**`), append this sentence at the end:

```
One rule with no exceptions in the routes: every `await` sits inside a `try/catch` that returns a status, because this Express 4 setup has no error-handling middleware. A rejected async handler sends NO response — and it is worse than a hung request, because Node exits on an unhandled rejection by default, so one unwrapped `await` can take the whole server down with it. `/api/video`'s own null-guard comment has said so since it was written: "not a failed request but a dead server". Both halves were observed while hardening these routes on 2026-08-17: removing a single wrap killed the forked test server on `UND_ERR_SOCKET`.
```

- [ ] **Step 3: CHANGELOG.md**

Add a new section at the top (below the header block, above `## 2026-08-16`):

```markdown
## 2026-08-17

### Fixed

- A failed project save, preset save, or project-list load now shows an error
  instead of hanging forever with nothing to see. Under the hood these could take
  the local server down with them, which ended the session rather than the request.
- When the connection drops while reading a generation's answer, the node now
  shows an error — with a note that the run may still have been charged —
  instead of spinning forever.
- A render finishing while its project is being renamed now always lands in the
  renamed project, and its record names the folder the clip is actually in.
```

- [ ] **Step 4: status.md (gitignored — edit in the working tree, do not commit)**

Four edits:

1. Delete the todo beginning `- [ ] Wrap the seven \`await\`s` — closed by Tasks 1–2.
2. Delete the todo beginning `- [ ] Finish testing the unattended sweep path` — closed by Task 3.
3. Delete the todo beginning `- [ ] A second rename landing while a job is already mid-download` — closed by Task 4.
4. Extend the two "Known, parked — no repro" lines with how each could bite, so the future reader knows what a symptom would look like:
   - To the ~1ms mid-commit window line, append: `How it would bite: a stray pending row left in the OLD folder's store — if the user later points the output folder back there, the sweep re-collects an already-finished clip under a fresh timestamp (duplicate file, no extra spend), and delete/rename confirmations in that folder count a render that is not real. Duplication and confusion, never loss.`
   - To the rename-rollback line, append: `How it would bite: only if a rename fails while a pending record ALREADY sits under the destination slug (itself only reachable via an earlier failed rename); the rollback would sweep that record to the source name and its clip would land in the wrong project. Misfiled, never lost.`
5. Under `## Decided, not yet built`, add:

```markdown
**Preset assets, optional at save time (2026-08-17).** Owner's design choice for
the machine-local-paths todo above: a preset should be able to carry its assets
— produced outputs AND input images/videos — as an explicit per-save choice, not
stripped always or kept always. Needs its own spec before any code: the save
dialog UX, inlining real bytes (data URLs) vs today's machine-local pointers,
presets.json size (it is read whole on every library open, video inputs cap at
25MB EACH, and the file is never rewritten so a fat preset is permanent), and
the community-sharing risks (assets shared to strangers can carry PII/EXIF and
unclear licensing; an example output shown as "what this preset makes" also
needs to be honest). The existing todo about stripping machine-local paths
STAYS OPEN until that spec lands — pointers that break on another machine are a
bug regardless of which way the asset decision goes.
```

- [ ] **Step 5: Run the suite one last time and commit**

Run: `npm test` — all six ok.

```bash
git add docs/video-and-sharing.md CLAUDE.md CHANGELOG.md
git commit -m "Record the hardened routes and closed sweep coverage in the docs"
```

---

## Self-Review

- **Owner decisions applied before execution (2026-08-17):** Task 1 uses one shared `readUpstreamBody` helper rather than three inline try/catch copies, so a single test covers all three routes and there is no duplicated logic block for the review to flag.
- **Spec coverage:** the three in-scope deferred items map to Tasks 1–2 (seven awaits: three body reads in Task 1; `PUT /api/projects/:name`'s two, `GET /api/projects`'s two — one route wrap each — plus `PUT /api/presets` and the poll persist in Task 2), Task 3 (sweep-only branches), Task 4 (download-window rename + record/folder mislabel). The parked items and the preset-assets feature are explicitly out of scope, recorded in Task 5's status.md step per the owner's answers of 2026-08-17.
- **Placeholders:** none — every step carries its code, command, or exact replacement text.
- **Type consistency:** `collectVideo` returns `{savedPath, cost, project}` in Task 4 and both callers destructure exactly that; `UNFRAMED_TEST_CHAT_COMPLETIONS_URL` is named identically in Task 1's stub env and const; Task 3 consumes the give-up message text exactly as `sweepOneInner` writes it.
- **Money:** nothing in any test reaches a real endpoint with a real key — Task 1's stub replaces chat-completions, Tasks 3–4 use fake keys with stubbed status/download legs, Task 2 is filesystem-only. No in-app verification step exists because no client code changes.
- **Verified against the code, not assumed:** the poll route's `done` patch really does write `project: job.project` today (~line 1240); the sweep's patch really omits `project`; `fetchVideoStatus` really returns `OpenRouter (404): …` for a stub 404, which is what Task 3's give-up assertion matches.
