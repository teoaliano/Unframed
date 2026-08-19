# OpenRouter OAuth Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "create a key at openrouter.ai, copy it, paste it here" with a single Connect button that obtains the key through OpenRouter's browser authorization flow.

**Architecture:** A new `server/oauth.js` holds the pure flow logic and a 10-minute in-memory store of one pending attempt. Four routes drive it; the `code_verifier` never leaves the server process. The key it obtains is written through the existing `env.js` funnel, so every consumer downstream is untouched. The client gains a Connect button, a waiting state polled from `App`, and a connected-state display built from `GET /api/v1/key`.

**Tech Stack:** Node 18+ (built-in `fetch`, `node:crypto`), Express 4, React + React Flow, plain `node` + `node:assert/strict` tests (no framework).

**Spec:** `docs/superpowers/specs/2026-08-19-openrouter-oauth-design.md`
**Research (every OpenRouter fact, cited):** `docs/research/2026-08-19-openrouter-oauth.md`

## Global Constraints

- **Two PRs.** Task 1 is a security fix that ships alone; Tasks 2–8 are the feature. The boundary is marked. Changes land by PR — never a direct push to `main`.
- **Node 18+**, built-in `fetch`. No new dependencies for any task in this plan.
- **Every `await` that can reject sits inside a `try/catch` that returns a response.** This Express 4 setup has no error-handling middleware; an unhandled rejection exits the process. The documented escape hatch is a callee built to return failures as a value.
- **Tests are plain `node` + `node:assert/strict`**, no framework, no fixtures. Each file ends with `console.log('<name>: ok')` and is added to the `test` script in `package.json`.
- **Nothing that spends money goes in a test.** OpenRouter endpoints are stubbed via an env var that is unset — and therefore inert — in every real environment, following the existing `UNFRAMED_TEST_VIDEOS_STATUS_BASE` and `UNFRAMED_TEST_CHAT_COMPLETIONS_URL` precedent in `server/host.test.js`.
- **Key material passes `PATTERNS.OPENROUTER_API_KEY` before being written**, including a key that came from OpenRouter itself.
- **Prose is reviewed for length the way code is reviewed for logic.** A comment earns its length only if deleting it would let someone make a wrong change.
- **Node components have no tests** by design. Client work is verified in the browser and said so.
- `UNFRAMED_OAUTH_BOUNCE` is the one new environment variable. Unset means direct loopback, which is the development mode and the permanent fallback.

---

# PR 1 — Prerequisite security fix

Ships on its own branch and its own PR, merged before Task 2 starts. It is independently valuable and must not be buried in a feature branch.

### Task 1: Restrict CORS to loopback origins

`app.use(cors())` sends `Access-Control-Allow-Origin: *`. Any website visited while Unframed is running can read `/api/health` (key hint, model settings, and the output folder path, which usually contains the user's username), enumerate and read projects, and call `DELETE /api/key`. Permissive preflight answers mean the non-simple methods work too.

Neither real consumer needs CORS: Vite's proxy makes its requests server-side (no browser origin involved), and the packaged app is same-origin. The share tunnel is a separate HTTP server by design (see the security note at the top of `server/share.js`), so it is not behind this middleware at all. An allowlist is chosen over deleting the middleware because a reflected loopback origin keeps any local tooling working while closing the hole — a browser sets `Origin` itself, so a page on `evil.com` cannot claim to be `localhost`.

**Files:**
- Modify: `server/index.js:49`
- Test: `server/host.test.js` (add a block)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. Behavioural contract only — requests carrying a non-loopback `Origin` receive no `access-control-allow-origin` header.

- [ ] **Step 1: Write the failing test**

Add to `server/host.test.js`, inside the existing `try {` block, after the `/api/health` assertion near the top (it needs only `base`):

```js
  // CORS is loopback-only. With `cors()` wide open, any site the user visits
  // while Unframed runs could read /api/health -- which carries the key hint,
  // the model settings and the output path -- and call DELETE /api/key. A
  // browser sets Origin itself, so an allowlist is a real boundary here.
  const evil = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.status, 200, 'a cross-origin GET still answers');
  assert.equal(
    evil.headers.get('access-control-allow-origin'),
    null,
    'but the browser is not told it may read the answer',
  );

  // The dev client's own origin is reflected, so local tooling keeps working.
  const dev = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:5173');

  // And a preflight for a destructive method is refused the same way.
  const preflight = await fetch(`${base}/api/key`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example',
      'Access-Control-Request-Method': 'DELETE',
    },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node server/host.test.js`
Expected: FAIL — an `AssertionError` on the first new assertion, showing `'*'` where `null` was expected.

- [ ] **Step 3: Write the minimal implementation**

Replace `server/index.js:49` (`app.use(cors());`) with:

```js
// Loopback only. A wide-open ACAO let any page the user happened to be visiting
// read this API cross-origin -- /api/health alone carries the key hint, the
// model settings and the output path -- and call DELETE /api/key. Neither real
// consumer needs CORS at all: Vite proxies server-side, and the packaged app is
// same-origin. The allowlist rather than nothing is for local tooling, and it is
// a real boundary because the browser sets Origin, not the page.
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || LOOPBACK_ORIGIN.test(origin)),
  }),
);
```

`!origin` covers same-origin requests and non-browser callers (curl, the forked test server), which send no `Origin` and need no header back.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all files pass, including `host.test.js: ok`.

- [ ] **Step 5: Verify in the running app**

Run `npm run dev`, load the canvas at `http://localhost:5173`, confirm it loads and the settings dialog opens with its models populated — that exercises `/api/health`, `/api/models` and `/api/projects` through the Vite proxy. Then in the browser console on any *other* site, confirm `fetch('http://localhost:8787/api/health')` is now blocked by CORS.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Restrict CORS to loopback origins"
```

- [ ] **Step 7: Add a CHANGELOG entry**

A user would not notice this in the UI, but it closes a hole that affected every install, so it is user-visible in the sense that matters. Add under a dated heading in `CHANGELOG.md`, matching the format its own header states.

```markdown
### Fixed
- The local API no longer accepts cross-origin requests from arbitrary websites.
  Previously any page open in the same browser could read your settings (including
  which key was in use and your output folder path) or remove your API key.
```

- [ ] **Step 8: Commit and open the PR**

```bash
git add CHANGELOG.md
git commit -m "CHANGELOG: loopback-only CORS"
```

Open the PR and merge it before starting Task 2. Confirm `gh auth status` shows `teoaliano` first.

---

# PR 2 — The Connect flow

Everything below is one branch and one PR.

### Task 2: `server/oauth.js` — the pure flow and the pending-attempt store

The module exists because its rules are load-bearing and silently breakable — the same trigger that produced `env.js`, `presets.js` and `jobs.js`. Above all, `claim` must succeed exactly once per nonce: a nonce claimable twice is a replayable callback, and that failure is invisible from outside.

OpenRouter offers no `state` parameter, so the nonce substitutes for one. It is hex rather than base64url so it stays alphanumeric — the bounce page validates it with a character class, and `-`/`_` would widen that for no benefit.

**Files:**
- Create: `server/oauth.js`
- Create: `server/oauth.test.js`
- Modify: `package.json` (the `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces, all named exports:
  - `challengeFrom(verifier: string) => string` — base64url SHA-256.
  - `authorizeUrl({ callback: string, challenge: string }) => string`
  - `callbackUrl({ port: number, nonce: string, bounce?: string }) => string`
  - `start(now?: number) => { nonce: string, challenge: string }` — supersedes any existing attempt.
  - `claim(nonce: string, now?: number) => string | null` — the verifier, once; `null` if unknown, already claimed, or expired.
  - `cancel() => void`
  - `pendingCount() => number` — for tests.
  - `PENDING_TTL_MS: number`

- [ ] **Step 1: Write the failing test**

Create `server/oauth.test.js`:

```js
// node server/oauth.test.js  (also runs as part of `npm test`)
import assert from 'node:assert/strict';
import {
  challengeFrom,
  authorizeUrl,
  callbackUrl,
  start,
  claim,
  cancel,
  pendingCount,
  PENDING_TTL_MS,
} from './oauth.js';

// The S256 transformation, against the worked example in RFC 7636 Appendix B.
// Pinned to the standard rather than to our own output: if this drifts,
// OpenRouter rejects every exchange with an opaque error and the flow is dead.
assert.equal(
  challengeFrom('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
);

// The authorize URL. OpenRouter's parameter is callback_url, NOT redirect_uri,
// and the method sent here must be echoed on the exchange or it 400s.
const au = new URL(authorizeUrl({ callback: 'http://127.0.0.1:8787/api/oauth/callback/abc', challenge: 'chal' }));
assert.equal(au.origin + au.pathname, 'https://openrouter.ai/auth');
assert.equal(au.searchParams.get('callback_url'), 'http://127.0.0.1:8787/api/oauth/callback/abc');
assert.equal(au.searchParams.get('code_challenge'), 'chal');
assert.equal(au.searchParams.get('code_challenge_method'), 'S256');

// The callback carries the port and nonce in the PATH, never the query: whether
// OpenRouter preserves pre-existing query params on callback_url is undocumented,
// so nothing here may depend on it.
assert.equal(
  callbackUrl({ port: 8787, nonce: 'abc123' }),
  'http://127.0.0.1:8787/api/oauth/callback/abc123',
);
assert.equal(au.searchParams.get('callback_url').includes('?'), false);

// With a bounce configured, the same two values become one path segment for the
// public page to parse and redirect onward.
assert.equal(
  callbackUrl({ port: 51423, nonce: 'abc123', bounce: 'https://example.com/connect' }),
  'https://example.com/connect/51423-abc123',
);
// A trailing slash on the configured value must not double up.
assert.equal(
  callbackUrl({ port: 51423, nonce: 'abc123', bounce: 'https://example.com/connect/' }),
  'https://example.com/connect/51423-abc123',
);

// The nonce is 128 bits and alphanumeric, so the bounce page can validate it
// with a plain character class.
cancel();
const first = start();
assert.match(first.nonce, /^[0-9a-f]{32}$/);
assert.equal(typeof first.challenge, 'string');

// Starting again supersedes: two clicks on Connect leave exactly one live
// attempt, and the abandoned one cannot be completed.
const second = start();
assert.equal(pendingCount(), 1);
assert.equal(claim(first.nonce), null, 'the superseded attempt is dead');

// claim succeeds exactly once. A nonce that can be claimed twice is a
// replayable callback, and nothing about that is visible from outside.
const verifier = claim(second.nonce);
assert.equal(typeof verifier, 'string');
assert.equal(challengeFrom(verifier), second.challenge, 'the stored verifier matches the challenge sent');
assert.equal(claim(second.nonce), null, 'the second claim fails');
assert.equal(pendingCount(), 0);

// An unknown nonce is refused rather than throwing.
assert.equal(claim('deadbeef'), null);

// Expiry, driven by an injected clock -- OpenRouter's codes live 10 minutes, and
// an attempt must not outlive the code it is waiting for.
const third = start();
assert.equal(claim(third.nonce, Date.now() + PENDING_TTL_MS + 1), null, 'expired');
assert.equal(pendingCount(), 0, 'and an expired attempt is not left behind');

// Cancel drops the attempt, so an approval that arrives after the user pressed
// Cancel is refused instead of silently writing a key.
const fourth = start();
cancel();
assert.equal(claim(fourth.nonce), null);

console.log('oauth.test.js: ok');
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node server/oauth.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND`, cannot find `./oauth.js`.

- [ ] **Step 3: Write the implementation**

Create `server/oauth.js`:

```js
import crypto from 'node:crypto';

// OpenRouter's browser flow, which is NOT RFC 6749: the parameter is
// `callback_url` rather than `redirect_uri`, and there is no `state`. The nonce
// below substitutes for state -- the callback is a top-level browser navigation,
// which CORS does not protect, so an unguessable single-use value is what makes a
// hostile local page's navigation pointless.
//
// The `code_verifier` never leaves this process. That is what lets the code
// travel back through a public web page without that page being able to do
// anything with it.
const b64url = (buf) => buf.toString('base64url');

export const challengeFrom = (verifier) =>
  b64url(crypto.createHash('sha256').update(verifier).digest());

export function authorizeUrl({ callback, challenge }) {
  const url = new URL('https://openrouter.ai/auth');
  url.searchParams.set('callback_url', callback);
  url.searchParams.set('code_challenge', challenge);
  // Whatever is sent here must be echoed on the exchange, or OpenRouter answers
  // 400 Invalid code_challenge_method.
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

// The port and nonce travel in the PATH. Whether OpenRouter preserves
// pre-existing query parameters on callback_url is undocumented, and it appends
// `?code=` to whatever it is given -- so depending on the query would be building
// on an unknown.
export function callbackUrl({ port, nonce, bounce }) {
  if (!bounce) return `http://127.0.0.1:${port}/api/oauth/callback/${nonce}`;
  return `${bounce.replace(/\/+$/, '')}/${port}-${nonce}`;
}

// OpenRouter's codes live 10 minutes; an attempt must not outlive one.
export const PENDING_TTL_MS = 10 * 60 * 1000;

// At most one attempt, in memory. A restart mid-flow is a flow the user retries,
// and unlike jobs.json there is no paid work in flight -- so persisting a
// code_verifier to disk would solve a problem nobody has.
const pending = new Map(); // nonce -> { verifier, expiresAt }

export function start(now = Date.now()) {
  pending.clear(); // two clicks on Connect leave exactly one live attempt
  const verifier = b64url(crypto.randomBytes(32)); // 43 chars, PKCE's range
  const nonce = crypto.randomBytes(16).toString('hex'); // 128-bit, alphanumeric
  pending.set(nonce, { verifier, expiresAt: now + PENDING_TTL_MS });
  return { nonce, challenge: challengeFrom(verifier) };
}

// Single-use, whether or not the attempt turned out to be fresh: deleting before
// the expiry check is what stops a stale nonce from being retried indefinitely.
export function claim(nonce, now = Date.now()) {
  const attempt = pending.get(nonce);
  if (!attempt) return null;
  pending.delete(nonce);
  return attempt.expiresAt > now ? attempt.verifier : null;
}

export function cancel() {
  pending.clear();
}

export const pendingCount = () => pending.size;
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node server/oauth.test.js`
Expected: `oauth.test.js: ok`

- [ ] **Step 5: Add it to the suite**

In `package.json`, append ` && node server/oauth.test.js` to the `test` script, after `node server/host.test.js`.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: every file passes, ending with `oauth.test.js: ok`.

- [ ] **Step 7: Commit**

```bash
git add server/oauth.js server/oauth.test.js package.json
git commit -m "Add server/oauth.js: PKCE flow and single-attempt store"
```

---

### Task 3: `POST /api/oauth/start` and `DELETE /api/oauth/pending`

The client cannot build the authorize URL: the callback must point at the engine, and in a clone the client reaches the API through Vite's proxy and does not know the engine's port. The engine reads its own from `server.address()`.

Cancel drops the attempt server-side rather than only resetting the UI. Without it, a user who cancels and then absent-mindedly approves in the browser gets a key in an app that told them the attempt was cancelled — nothing is harmed, but the app would be lying about its own state.

**Files:**
- Modify: `server/index.js` (imports near the top; routes beside `DELETE /api/key`, around line 223)
- Test: `server/host.test.js`

**Interfaces:**
- Consumes: `start`, `cancel`, `authorizeUrl`, `callbackUrl` from `./oauth.js` (Task 2). The module-level `server` binding from `app.listen` at `server/index.js:1600`.
- Produces: `POST /api/oauth/start` → `200 { authorizeUrl: string }`. `DELETE /api/oauth/pending` → `200 { ok: true }`.

- [ ] **Step 1: Write the failing test**

Add to `server/host.test.js` inside the existing `try {` block, after the CORS block from Task 1:

```js
  // The server builds the authorize URL, because only it knows its own port --
  // the client reaches the API through Vite's proxy in a clone.
  const startRes = await fetch(`${base}/api/oauth/start`, { method: 'POST' });
  assert.equal(startRes.status, 200);
  const { authorizeUrl: started } = await startRes.json();
  const parsed = new URL(started);
  assert.equal(parsed.origin + parsed.pathname, 'https://openrouter.ai/auth');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(parsed.searchParams.get('code_challenge'), 'a challenge is sent');

  // The callback points back at THIS server, on the port it was actually given
  // -- PORT=0 means it cannot be a constant.
  const cb = new URL(parsed.searchParams.get('callback_url'));
  assert.equal(cb.port, String(ready.port));
  assert.match(cb.pathname, /^\/api\/oauth\/callback\/[0-9a-f]{32}$/);

  // Cancel answers. That a cancelled attempt cannot then be COMPLETED is
  // asserted in Task 4, where the callback route exists -- asserting it here
  // would pass or fail on a 404 and prove nothing.
  assert.equal((await fetch(`${base}/api/oauth/pending`, { method: 'DELETE' })).status, 200);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node server/host.test.js`
Expected: FAIL — `assert.equal(startRes.status, 200)` sees `404`, since the route does not exist.

- [ ] **Step 3: Write the implementation**

Add to the import block at the top of `server/index.js`:

```js
import {
  start as oauthStart,
  claim as oauthClaim,
  cancel as oauthCancel,
  authorizeUrl,
  callbackUrl,
} from './oauth.js';
```

Add these routes next to `DELETE /api/key` (around `server/index.js:223`):

```js
// Begins the browser flow. Nothing here awaits, so there is nothing to catch --
// the code_verifier is minted and held in oauth.js and never reaches the client.
app.post('/api/oauth/start', (req, res) => {
  const { nonce, challenge } = oauthStart();
  const callback = callbackUrl({
    port: server.address().port,
    nonce,
    // Unset in a clone, which means direct loopback: the development mode, and
    // the fallback when the public page is unreachable. Set, it names the public
    // bounce page, which exists only so the consent screen can say "Unframed"
    // instead of "127.0.0.1:51423".
    bounce: process.env.UNFRAMED_OAUTH_BOUNCE,
  });
  res.json({ authorizeUrl: authorizeUrl({ callback, challenge }) });
});

// Cancel is a real action, not just a UI reset: without it, approving in the
// browser after pressing Cancel would still write a key, and the app would have
// said the attempt was cancelled.
app.delete('/api/oauth/pending', (req, res) => {
  oauthCancel();
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node server/host.test.js`
Expected: `host.test.js: ok`

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Add POST /api/oauth/start and DELETE /api/oauth/pending"
```

---

### Task 4: `GET /api/oauth/callback/:nonce` — the exchange

This is the only route a human's browser lands on directly, so **every branch answers with an HTML page**. A bare JSON 400 in a browser tab is a dead end for the user.

Two `await`s here can reject — the outbound HTTPS call and the file write — and an unhandled rejection exits the process, so both sit inside the `try`.

The key OpenRouter returns is validated against `PATTERNS.OPENROUTER_API_KEY` exactly as a pasted one is, because it lands in a shell-ish file and an HTTP header. But the message differs: the research found `sk-or-v1-` is not a documented contract, so a rejection here means "a shape we do not recognise", not "that does not look like a key" — which would be baffling to read immediately after a successful approval.

**Files:**
- Modify: `server/index.js` (route beside the two from Task 3)
- Test: `server/host.test.js`

**Interfaces:**
- Consumes: `oauthClaim` (Task 3's import block), `PATTERNS` from `./env.js`, the existing `writeEnv` helper at `server/index.js:87`, and the module-level `let API_KEY`.
- Produces: `GET /api/oauth/callback/:nonce?code=…` → `200` HTML on success, `400` HTML on a bad nonce or missing code, `502` HTML on an upstream failure. Reads `UNFRAMED_TEST_AUTH_KEYS_URL` when set.

- [ ] **Step 1: Write the failing test**

Add a stub beside the existing ones near the top of `server/host.test.js`, before `fork`:

```js
// Stands in for OpenRouter's key-exchange endpoint. The real exchange needs a
// real human approving in a real browser, so this is what lets the callback
// route's actual logic -- nonce claim, exchange, key validation, writeEnv -- be
// tested at all. Same override pattern as the two stubs above:
// UNFRAMED_TEST_AUTH_KEYS_URL is unset, and therefore inert, in every real
// environment. The `code` decides which answer comes back.
const AUTH_KEY_STUB_RESPONSES = {
  'good-code': { status: 200, body: { key: 'sk-or-v1-stubbedkey1234', user_id: 'u_1' } },
  'malformed-key-code': { status: 200, body: { key: 'not-a-key\nHost: evil' } },
  'refused-code': { status: 400, body: { error: 'invalid code' } },
};
const authKeyStub = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const sent = JSON.parse(raw || '{}');
    // The verifier must arrive, or PKCE is decorative.
    const answer = sent.code_verifier
      ? AUTH_KEY_STUB_RESPONSES[sent.code]
      : { status: 400, body: { error: 'no code_verifier sent' } };
    const { status, body } = answer || { status: 404, body: { error: `no stub for ${sent.code}` } };
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
});
await new Promise((resolve) => authKeyStub.listen(0, '127.0.0.1', resolve));
const authKeyStubUrl = `http://127.0.0.1:${authKeyStub.address().port}/api/v1/auth/keys`;
```

Add `UNFRAMED_TEST_AUTH_KEYS_URL: authKeyStubUrl,` to the `env` object of the existing `fork(...)` call.

Then add this block inside the `try {`, after Task 3's block:

```js
  // A nonce nobody issued is refused, and the answer is a PAGE -- this is the
  // one route a human's browser lands on, and a bare JSON 400 is a dead end.
  const unknown = await fetch(`${base}/api/oauth/callback/${'0'.repeat(32)}?code=good-code`);
  assert.equal(unknown.status, 400);
  assert.match(unknown.headers.get('content-type') || '', /text\/html/);

  // The happy path: start, then complete, and the key lands in the data dir's
  // .env through the same funnel a pasted key uses.
  const okStart = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const okPath = new URL(new URL(okStart.authorizeUrl).searchParams.get('callback_url')).pathname;
  const done = await fetch(`${base}${okPath}?code=good-code`);
  assert.equal(done.status, 200);
  assert.match(await done.text(), /close this tab/i);
  assert.match(await fs.readFile(path.join(dataDir, '.env'), 'utf8'), /OPENROUTER_API_KEY=sk-or-v1-stubbedkey1234/);

  // ...and the same nonce cannot be replayed.
  assert.equal((await fetch(`${base}${okPath}?code=good-code`)).status, 400);

  // A cancelled attempt cannot be completed either: approving in the browser
  // after pressing Cancel must not quietly write a key.
  const abandoned = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const abandonedPath = new URL(new URL(abandoned.authorizeUrl).searchParams.get('callback_url')).pathname;
  await fetch(`${base}/api/oauth/pending`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}${abandonedPath}?code=good-code`)).status, 400);

  // A callback with no code at all is refused before anything is exchanged.
  const codeless = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const codelessPath = new URL(new URL(codeless.authorizeUrl).searchParams.get('callback_url')).pathname;
  assert.equal((await fetch(`${base}${codelessPath}`)).status, 400);

  // A key in a shape we cannot safely write is refused. It would otherwise reach
  // .env and an HTTP header -- the trust boundary applies to a provider's answer
  // exactly as it does to a paste.
  const badStart = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const badPath = new URL(new URL(badStart.authorizeUrl).searchParams.get('callback_url')).pathname;
  const malformed = await fetch(`${base}${badPath}?code=malformed-key-code`);
  assert.equal(malformed.status, 502);
  assert.match(await malformed.text(), /shape/i);

  // An upstream refusal is reported, not swallowed, and still as a page.
  const refusedStart = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const refusedPath = new URL(new URL(refusedStart.authorizeUrl).searchParams.get('callback_url')).pathname;
  const refused = await fetch(`${base}${refusedPath}?code=refused-code`);
  assert.equal(refused.status, 502);
  assert.match(refused.headers.get('content-type') || '', /text\/html/);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node server/host.test.js`
Expected: FAIL — the first new assertion sees `404` (no route) where `400` was expected.

- [ ] **Step 3: Write the implementation**

Add beside the Task 3 routes in `server/index.js`:

```js
// Unset -- and therefore inert -- in every real environment; the forked test
// server points it at a local stub, because the real exchange needs a human
// approving in a browser. Same pattern as UNFRAMED_TEST_VIDEOS_STATUS_BASE.
const AUTH_KEYS_URL =
  process.env.UNFRAMED_TEST_AUTH_KEYS_URL || 'https://openrouter.ai/api/v1/auth/keys';

// The callback lands in a browser tab, so every branch answers with a readable
// page rather than JSON. Self-contained on purpose: this server does not know
// where the canvas lives -- :5173 in a clone, its own port in the packaged app --
// so it cannot redirect anywhere, and says so instead.
const oauthPage = (heading, detail) =>
  `<!doctype html><meta charset="utf-8"><title>Unframed</title>` +
  `<div style="font:16px/1.5 system-ui;margin:12vh auto;max-width:32em;padding:0 1.5em">` +
  `<h1 style="font-size:1.3em">${heading}</h1><p>${detail}</p></div>`;

app.get('/api/oauth/callback/:nonce', async (req, res) => {
  // Single-use: claim() deletes whatever it finds, so a replayed callback and a
  // superseded one both land here.
  const verifier = oauthClaim(req.params.nonce);
  if (!verifier) {
    return res
      .status(400)
      .send(oauthPage('That link is no longer valid', 'Close this tab and press Connect in Unframed again.'));
  }
  const code = String(req.query.code || '');
  if (!code) {
    return res
      .status(400)
      .send(oauthPage('OpenRouter did not send a code', 'Close this tab and press Connect in Unframed again.'));
  }
  try {
    const orRes = await fetch(AUTH_KEYS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The method must match what the authorize URL declared, or this 400s.
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    });
    const data = await orRes.json().catch(() => ({}));
    if (!orRes.ok || !data.key) {
      return res
        .status(502)
        .send(
          oauthPage(
            'OpenRouter could not complete the connection',
            data.error?.message || data.error || `It answered ${orRes.status}. Try connecting again.`,
          ),
        );
    }
    // Same trust boundary as a paste: this value reaches .env and an auth header.
    // The message differs because "sk-or-v1-" is not a documented contract, so a
    // failure here is about OUR expectations, not the user's typing.
    if (!PATTERNS.OPENROUTER_API_KEY.test(data.key)) {
      return res
        .status(502)
        .send(
          oauthPage(
            'OpenRouter returned a key in a shape Unframed does not recognise',
            'Nothing was saved. You can paste a key manually in Unframed’s settings instead.',
          ),
        );
    }
    await writeEnv({ OPENROUTER_API_KEY: data.key });
    API_KEY = data.key;
    console.log('  oauth:    connected, key saved');
    return res.send(
      oauthPage('Connected to OpenRouter', 'You can close this tab and return to Unframed.'),
    );
  } catch (err) {
    // Both awaits above can reject, and an unhandled rejection exits the process
    // -- not a failed request but a dead server.
    return res.status(502).send(oauthPage('Could not reach OpenRouter', err.message));
  }
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node server/host.test.js`
Expected: `host.test.js: ok`

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all files pass.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Add the OAuth callback route and code exchange"
```

---

### Task 5: `GET /api/oauth/status`

Deliberately **not** folded into `/api/health`: health is called on every page load and must not depend on OpenRouter being reachable, while this is called when the settings dialog opens and is allowed to be slow or to fail.

`GET /api/v1/key` is the only account information a user's own key may read. `GET /api/v1/credits` — the actual purchased balance — is management-key-only, and a management key belongs to *our* account, not the user's, so there is no path to the user's balance. A 401 here is what turns silent revocation into something the dialog can say.

**Files:**
- Modify: `server/index.js` (beside the other OAuth routes)
- Test: `server/host.test.js`

**Interfaces:**
- Consumes: the module-level `let API_KEY`.
- Produces: `GET /api/oauth/status` → `200 { hasKey: false }` when there is no key; `200 { hasKey: true, revoked: true }` on a 401 from OpenRouter; `200 { hasKey: true, label, usage, limit, limitRemaining, limitReset, isFreeTier }` on success; `502 { error }` otherwise.

- [ ] **Step 1: Write the failing test**

Add inside the `try {` block of `server/host.test.js`. The forked server has a stubbed key from Task 4, which is not a real credential, so the live call to OpenRouter earns a 401 — which is exactly the revoked branch:

```js
  // With a key that OpenRouter does not know, the status route reports the key as
  // revoked rather than erroring. That is the branch that turns a silent
  // revocation into something the settings dialog can say out loud.
  const status = await fetch(`${base}/api/oauth/status`);
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.hasKey, true);
  assert.equal(statusBody.revoked, true);
  assert.equal('usage' in statusBody, false, 'no spend is claimed for a key that does not work');
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node server/host.test.js`
Expected: FAIL — `assert.equal(status.status, 200)` sees `404`.

- [ ] **Step 3: Write the implementation**

Add beside the other OAuth routes in `server/index.js`:

```js
// What the settings dialog shows about the connection. Separate from
// /api/health on purpose: health runs on every page load and must answer
// without OpenRouter, while this one is opened deliberately and may be slow.
//
// This is the ONLY account information a user's own key can read. The purchased
// balance lives behind GET /api/v1/credits, which is management-key-only -- and a
// management key is OURS, not theirs -- so there is no way to show a balance. What
// is reachable: all-time spend on this key, its cap if it has one, and whether
// the user has ever bought credit, which is what makes the first-run warning
// possible before a generation fails instead of after.
app.get('/api/oauth/status', async (req, res) => {
  if (!API_KEY) return res.json({ hasKey: false });
  try {
    const orRes = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    // Revoked or disabled upstream. Today this surfaces as a mystery generation
    // failure; here the dialog can name it and offer to reconnect.
    if (orRes.status === 401) return res.json({ hasKey: true, revoked: true });
    const body = await orRes.json().catch(() => ({}));
    if (!orRes.ok || !body.data) {
      return res.status(502).json({ error: `OpenRouter answered ${orRes.status}.` });
    }
    const d = body.data;
    res.json({
      hasKey: true,
      label: d.label || '',
      usage: d.usage ?? 0,
      // null for an uncapped key, which is what the browser flow produces --
      // setting a cap is documented only on the management routes.
      limit: d.limit ?? null,
      limitRemaining: d.limit_remaining ?? null,
      limitReset: d.limit_reset ?? null,
      isFreeTier: Boolean(d.is_free_tier),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node server/host.test.js`
Expected: `host.test.js: ok`

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/host.test.js
git commit -m "Add GET /api/oauth/status"
```

---

### Task 6: Client API helpers

**Files:**
- Modify: `client/src/api.js` (after `clearKey`, around line 135)

**Interfaces:**
- Consumes: the four routes from Tasks 3–5.
- Produces: `startOauth() => Promise<string>` (the authorize URL), `cancelOauth() => Promise<void>`, `oauthStatus() => Promise<object|null>`.

- [ ] **Step 1: Write the implementation**

There is no test step here: these are three `fetch` wrappers in the same shape as the file's existing ones, and this repo does not unit-test the client's HTTP layer. They are exercised by Tasks 7 and 8 in the browser.

Add after `clearKey` in `client/src/api.js`:

```js
// The server builds the authorize URL, because only it knows the port the
// callback has to come back to -- in a clone this client talks to Vite's proxy
// and has no idea what it is.
export const startOauth = () =>
  fetch('/api/oauth/start', { method: 'POST' }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Could not start connecting (${r.status})`);
    return d.authorizeUrl;
  });

// Cancelling drops the attempt on the server too, so approving in the browser
// afterwards is refused rather than quietly saving a key.
export const cancelOauth = () => fetch('/api/oauth/pending', { method: 'DELETE' }).catch(() => {});

// null means "could not ask" -- the dialog then shows nothing about the
// connection rather than claiming zero spend.
export const oauthStatus = () =>
  fetch('/api/oauth/status')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
```

- [ ] **Step 2: Confirm the client still builds**

Run: `npm --prefix client run build`
Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/api.js
git commit -m "Add client helpers for the OAuth routes"
```

---

### Task 7: The Connect button and the waiting state

**The poll lives in `App`, beside `cfg` — not inside the dialog.** Closing the dialog mid-flow must not abandon the connection: the callback still lands server-side, and `App` still notices. A poll owned by the dialog's render path would leave the key written on disk while the toolbar still showed the "add a key" icon until a reload.

**It gives up at ten minutes, not two.** Ten is OpenRouter's real code lifetime. Stopping earlier reports failure on a still-valid flow — the user goes to find a password, comes back, approves, and is told it already failed.

**Files:**
- Modify: `client/src/App.jsx` — imports (around line 36 for icons, and the `api.js` import block); state beside `cfgDlg` (around line 231); a new effect near the existing initial-health effect (around line 400); the keyless branch of the dialog (around line 1490)

**Interfaces:**
- Consumes: `startOauth`, `cancelOauth` from `client/src/api.js` (Task 6); `getHealth`; the existing `cfg` / `setCfg` / `cfgDlg` / `setCfgDlg` state and the existing `toast`.
- Produces: `cfgDlg.connecting` — `undefined`, or `{ since: number, slow: boolean }`. Consumed by Task 8's connected-state render only insofar as it must be cleared.

- [ ] **Step 1: Add the imports**

Add `startOauth, cancelOauth` to the existing import from `./api.js`. No new icon: the Connect button carries a label only, matching the dialog's other buttons.

- [ ] **Step 2: Add the connect handler**

Add beside `saveSettings` in `App.jsx`:

```js
  // Opens OpenRouter in the user's real browser: a plain _blank navigation, which
  // the packaged shell turns into shell.openExternal via setWindowOpenHandler and
  // a clone treats as an ordinary tab. One code path for both.
  async function connectOpenRouter() {
    setCfgDlg((d) => ({ ...d, error: undefined, saved: false }));
    try {
      const url = await startOauth();
      // A blocked popup returns null. The flow is still perfectly valid -- the
      // attempt is live on the server -- so the URL is kept and shown rather than
      // failing, which is also the answer for an environment with no browser.
      const opened = window.open(url, '_blank', 'noopener');
      setCfgDlg((d) => ({ ...d, connecting: { since: Date.now(), slow: false, url, opened: !!opened } }));
    } catch (err) {
      setCfgDlg((d) => ({ ...d, error: err.message }));
    }
  }

  function cancelConnect() {
    cancelOauth();
    setCfgDlg((d) => ({ ...d, connecting: undefined }));
  }
```

- [ ] **Step 3: Add the poll, in `App` and not in the dialog**

Add as its own effect:

```js
  // Polls while a connection is pending. This lives here rather than in the
  // dialog because closing the dialog must NOT abandon the flow -- the callback
  // still lands on the server, and this is what notices. Owned by the dialog, a
  // close would leave the key on disk and the toolbar still showing "add a key".
  //
  // Ten minutes, not two: that is how long OpenRouter's code is valid, and giving
  // up sooner reports failure on a flow that is still perfectly completable.
  useEffect(() => {
    const pending = cfgDlg?.connecting;
    if (!pending) return;
    const id = setInterval(async () => {
      const elapsed = Date.now() - pending.since;
      const h = await getHealth().catch(() => null);
      if (h?.hasKey) {
        setCfg((c) => ({ ...c, ...h, hasKey: true, keyHint: h.keyHint || '' }));
        setCfgDlg((d) => (d ? { ...d, connecting: undefined } : d));
        toast({ body: 'Connected to OpenRouter.', uniqueID: 'oauth-connected' });
        return;
      }
      if (elapsed > 10 * 60 * 1000) {
        setCfgDlg((d) =>
          d ? { ...d, connecting: undefined, error: 'Nothing came back from OpenRouter. Try connecting again.' } : d,
        );
        return;
      }
      // After two minutes the copy softens, but the polling does not stop.
      if (elapsed > 2 * 60 * 1000 && !pending.slow) {
        setCfgDlg((d) => (d?.connecting ? { ...d, connecting: { ...d.connecting, slow: true } } : d));
      }
    }, 1500);
    return () => clearInterval(id);
  }, [cfgDlg?.connecting, toast]);
```

- [ ] **Step 4: Rewrite the keyless branch of the dialog**

Replace the `{!cfg.hasKey && (...)}` explanatory block (around `client/src/App.jsx:1490`) with one paragraph plus the button, and put the existing paste field behind a disclosure. The heading at line 1479 becomes `cfg.hasKey ? 'Settings' : 'Connect OpenRouter to start'`.

```jsx
          {!cfg.hasKey && !cfgDlg?.connecting && (
            <VStack gap={2}>
              <Text type="supporting" as="p">
                Unframed has no image model of its own. It sends your prompts to{' '}
                <Link href="https://openrouter.ai" isExternalLink>
                  OpenRouter
                </Link>
                , which runs the model and bills your OpenRouter account per image (a few cents for
                most models). Connecting takes you there to approve Unframed; the key it gives back
                is saved on this machine and used only by your local server.
              </Text>
              <Button label="Connect OpenRouter" variant="primary" onClick={connectOpenRouter} />
            </VStack>
          )}
          {cfgDlg?.connecting && (
            <VStack gap={2}>
              <Text type="supporting" as="p">
                {!cfgDlg.connecting.opened
                  ? 'Your browser did not open. Open this link to approve Unframed:'
                  : cfgDlg.connecting.slow
                    ? 'Still waiting. Finish approving in your browser, or cancel and try again.'
                    : 'Waiting for OpenRouter in your browser…'}
              </Text>
              {!cfgDlg.connecting.opened && (
                <TextInput
                  label="Authorization link"
                  isLabelHidden
                  value={cfgDlg.connecting.url}
                  isReadOnly
                  onChange={() => {}}
                />
              )}
              <Button label="Cancel" variant="ghost" onClick={cancelConnect} />
            </VStack>
          )}
```

Then gate the existing API-key `VStack` (its label, `TextInput`, Remove button and supporting text — all unchanged) so it is hidden while onboarding until asked for, and shows as it does today once there is a key. Put this immediately before that `VStack`:

```jsx
          {!cfg.hasKey && !cfgDlg?.connecting && !cfgDlg?.showPaste && (
            <Button
              label="or paste a key instead"
              variant="ghost"
              onClick={() => setCfgDlg((d) => ({ ...d, showPaste: true }))}
            />
          )}
```

and wrap the `VStack` itself in `{(cfg.hasKey || cfgDlg?.showPaste) && ( … )}`. A ghost button toggling one flag rather than a new collapsible component: the disclosure is two states and the file already toggles conditional blocks this way.

- [ ] **Step 5: Verify in the browser**

Run `npm run dev`. With no key in `.env`:
1. The dialog shows one paragraph and a Connect button; "or paste a key instead" reveals the old field, which still saves a pasted key.
2. Press Connect: a tab opens at `openrouter.ai/auth`, and the dialog shows the waiting state.
3. Approve. The callback tab says "Connected to OpenRouter — you can close this tab", the dialog closes, the toast appears, and the toolbar icon becomes the settings gear. Confirm `.env` now holds `OPENROUTER_API_KEY=`.
4. Press Connect, then Cancel, then approve in the browser anyway: the callback page says the link is no longer valid and no key is written.
5. Press Connect, close the dialog while waiting, then approve: the toolbar still flips to the gear without a reload.

This is also where the open question gets answered: connect twice and count the rows at `openrouter.ai/settings/keys` to learn whether reconnecting litters the user's account. Record the answer in the spec's open-questions section.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.jsx
git commit -m "Add the Connect button and its waiting state"
```

---

### Task 8: The connected-state display

Nothing distinguishes a connected key from a pasted one, because nothing about them differs — recording the source in `.env` was considered and rejected in the spec.

**Files:**
- Modify: `client/src/App.jsx` — `openSettings` (around line 408) and the API-key section of the dialog (around line 1517)

**Interfaces:**
- Consumes: `oauthStatus` from `client/src/api.js` (Task 6); `connectOpenRouter` (Task 7).
- Produces: `orStatus` state — `null` (not asked, or the ask failed) or the object `GET /api/oauth/status` returns.

- [ ] **Step 1: Fetch it when the dialog opens**

Add `const [orStatus, setOrStatus] = useState(null);` beside the other settings state, and at the end of `openSettings()`:

```js
    // On open, not on a timer: inference responses carry no quota information, so
    // asking is the only way to know, and nothing outside this dialog needs it.
    setOrStatus(null);
    if (cfg.hasKey) oauthStatus().then(setOrStatus);
```

- [ ] **Step 2: Render it**

Replace the supporting `Text` under the API-key field (the `cfg.hasKey ? 'A key is already saved…' : 'Paste it here…'` line) with:

```jsx
            {orStatus?.revoked ? (
              <VStack gap={2}>
                <Text type="supporting" as="p">
                  This key no longer works at OpenRouter — it may have been deleted or disabled
                  there.
                </Text>
                <Button label="Reconnect OpenRouter" variant="primary" onClick={connectOpenRouter} />
              </VStack>
            ) : orStatus?.hasKey ? (
              <VStack gap={2}>
                <Text type="supporting" as="p">
                  Connected to OpenRouter{orStatus.label ? ` as ${orStatus.label}` : ''}. $
                  {orStatus.usage.toFixed(2)} spent with this key
                  {orStatus.limit != null
                    ? `, $${(orStatus.limitRemaining ?? 0).toFixed(2)} of $${orStatus.limit.toFixed(2)} remaining${orStatus.limitReset ? ` (resets ${orStatus.limitReset})` : ''}`
                    : ''}
                  .
                </Text>
                {orStatus.isFreeTier && (
                  <Text type="supporting" as="p">
                    You have not bought any credit yet, so generating will fail. Add some under{' '}
                    <Link href="https://openrouter.ai/credits" isExternalLink>
                      Credits
                    </Link>
                    .
                  </Text>
                )}
              </VStack>
            ) : (
              <Text type="supporting" as="p">
                {cfg.hasKey
                  ? `A key is already saved${cfg.keyHint ? ` (…${cfg.keyHint})` : ''}. Entering a new one replaces it.`
                  : 'Paste it here. It starts with sk-or-'}
              </Text>
            )}
```

The last branch is the existing copy, kept verbatim: it is what shows while the status request is in flight, and when it failed. The dialog never claims zero spend because it could not ask.

- [ ] **Step 3: Improve the insufficient-credit message**

`is_free_tier` does not catch a user who paid once and ran dry; that case still arrives as a 402. Locate the existing handling with `grep -n "402\|insufficient" server/index.js`, and make each 402 branch name the cause and the fix: "OpenRouter says this account is out of credit. Add some at openrouter.ai/credits." Match the surrounding style — these messages are written to be acted on, like the key-absent ones near line 471. If several routes produce it (image, text, video), all of them get it; a batch of one-line message changes, no logic change.

- [ ] **Step 4: Verify in the browser**

With a key saved, open settings and confirm: spend shows; the cap line appears only for a key you capped yourself at openrouter.ai; a brand-new account with no purchase shows the credit prompt. Then delete the key at openrouter.ai, reopen settings, and confirm the revoked state with its Reconnect button.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.jsx server/index.js
git commit -m "Show the connection's spend, cap and credit state"
```

---

### Task 9: Documentation

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`, `.env.example`, `status.md` (gitignored)

- [ ] **Step 1: `CHANGELOG.md`**

Add under a dated heading, in the format its own header states:

```markdown
### Added
- Connect your OpenRouter account with one button instead of creating and pasting
  an API key by hand. Settings now shows what you have spent with the key, its
  spending cap if it has one, and a prompt to add credit before your first
  generation rather than after it fails. Pasting a key still works.
```

- [ ] **Step 2: `CLAUDE.md`**

Two edits, both small — prose here is reviewed for length the way code is reviewed for logic:

1. Add a row to the documentation table: `docs/research/` owns *findings about an external API, with citations and an explicit list of what its docs do not answer*.
2. Add `UNFRAMED_OAUTH_BOUNCE` to the sentence listing the hosted-mode environment variables, as the one that names the public bounce page and, unset, means direct loopback.

Note that another session may be editing `CLAUDE.md` concurrently (a stale `npm test` file list). Re-read the file before editing and rebase rather than assuming this branch's copy is current.

- [ ] **Step 3: `.env.example`**

Add a commented `UNFRAMED_OAUTH_BOUNCE=` line explaining that leaving it unset uses the loopback callback, which is correct for a clone.

- [ ] **Step 4: `status.md`**

Delete any todo this closed. If the bounce page's own work (in the website repo) is now the remaining step, note it there rather than here.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

```bash
git add CHANGELOG.md CLAUDE.md .env.example
git commit -m "Document the OAuth connect flow"
```

- [ ] **Step 6: Open the PR**

Confirm `gh auth status` shows `teoaliano`. The PR body should name the prerequisite (PR 1) as already merged, and state that the bounce page is not yet live so the flow ships on direct loopback — the consent screen will say `127.0.0.1:<port>` until `UNFRAMED_OAUTH_BOUNCE` is set.

---

## Deferred: the bounce page

Not in this repo, and not in this plan. It is a page on the public site that redirects a code onward to the engine, and it exists only so the consent screen can say "Unframed" rather than `127.0.0.1:51423`. Its contract, from the spec:

- Route shape `/<port>-<nonce>`, receiving OpenRouter's appended `?code=…`.
- Redirect to `http://127.0.0.1:<port>/api/oauth/callback/<nonce>?code=<code>`.
- **Parse and rebuild; never accept a URL.** Port must be digits in 1024–65535, nonce must match `^[0-9a-f]{32}$`, and the host must be the hardcoded literal `127.0.0.1`. Taking a URL from its own path and redirecting there is an open redirect on the domain that serves the installers.
- Redirect server-side (302), or fall back to displaying the code for manual entry — which is also OpenRouter's documented headless mode, so the no-JS path and the SSH path are one feature.
- Do not log query strings. The code is single-use, expires in ten minutes, and is useless without the verifier, but there is no reason to keep it.

When it is live, set `UNFRAMED_OAUTH_BOUNCE` in the packaged app's engine environment. No code change here.
