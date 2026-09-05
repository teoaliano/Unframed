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
import net from 'node:net';
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
  'cancelled-job': { status: 'cancelled', error: 'Job was cancelled' },
  'failed-job': { status: 'failed', error: 'Generation failed upstream' },
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

// Stands in for OpenRouter's key-exchange endpoint. The real exchange needs a
// real human approving in a real browser, so this is what lets the callback
// route's actual logic -- nonce claim, exchange, key validation, writeEnv -- be
// tested at all. Same override pattern as the two stubs above:
// UNFRAMED_TEST_AUTH_KEYS_URL is unset, and therefore inert, in every real
// environment. The `code` decides which answer comes back.
const AUTH_KEY_STUB_RESPONSES = {
  'good-code': { status: 200, body: { key: 'sk-or-v1-stubbedkey1234', user_id: 'u_1' } },
  // Answers after a delay, which is the only way to test the window between
  // claim() taking the verifier and the key reaching disk. Every other stub here
  // answers instantly, so that window is microseconds wide and unhittable.
  'slow-code': { status: 200, body: { key: 'sk-or-v1-slowexchangekey', user_id: 'u_1' }, delayMs: 700 },
  'malformed-key-code': { status: 200, body: { key: 'not-a-key\nHost: evil' } },
  'refused-code': { status: 400, body: { error: 'invalid code' } },
};
// Counts the key-info reads below, so the revoked assertion can prove it resolved
// here rather than at openrouter.ai.
let keyInfoReads = 0;
// What the key-info stub answers next. Mutable so one forked server can exercise
// every branch of /api/oauth/status: a dead key, and the success path that shapes
// the payload. Asserting any of it against the real endpoint would need network
// egress and would assume OpenRouter's answers never change shape -- which this
// feature has already been wrong about twice.
let keyInfoAnswer = { status: 401, body: { error: { message: 'no auth credentials found' } } };
const authKeyStub = http.createServer((req, res) => {
  // GET /api/v1/key, the key-info route /api/oauth/status reads, on the same stub
  // because it is the same upstream.
  if (req.url.startsWith('/api/v1/key')) {
    keyInfoReads += 1;
    res.writeHead(keyInfoAnswer.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(keyInfoAnswer.body));
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const sent = JSON.parse(raw || '{}');
    // The verifier must arrive, or PKCE is decorative.
    const answer = sent.code_verifier
      ? AUTH_KEY_STUB_RESPONSES[sent.code]
      : { status: 400, body: { error: 'no code_verifier sent' } };
    const { status, body, delayMs } = answer || { status: 404, body: { error: `no stub for ${sent.code}` } };
    setTimeout(() => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    }, delayMs || 0);
  });
});
await new Promise((resolve) => authKeyStub.listen(0, '127.0.0.1', resolve));
const authKeyStubBase = `http://127.0.0.1:${authKeyStub.address().port}`;
const authKeyStubUrl = `${authKeyStubBase}/api/v1/auth/keys`;
const keyInfoStubUrl = `${authKeyStubBase}/api/v1/key`;

// Fake `claude` and `codex` on PATH, ahead of any real install, so the provider
// detection route can be driven through every outcome without a subscription. The
// fake claude answers --version and fails anything else, so the Agent SDK's auth probe
// cannot get an answer from it (that is the "runs, auth unknown" outcome). The fake
// codex reads its login status from a file the tests rewrite.
const fakeBin = path.join(dataDir, 'fakebin');
await fs.mkdir(fakeBin);
await fs.writeFile(
  path.join(fakeBin, 'claude'),
  '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi\nexit 1\n',
  { mode: 0o755 },
);
await fs.writeFile(
  path.join(fakeBin, 'codex'),
  `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 8.8.8"; exit 0; fi\nif [ "$1" = "login" ] && [ "$2" = "status" ]; then cat "${path.join(fakeBin, 'codex-status')}"; exit 0; fi\nexit 1\n`,
  { mode: 0o755 },
);
await fs.writeFile(path.join(fakeBin, 'codex-status'), 'Not logged in\n');
await fs.writeFile(path.join(fakeBin, 'broken'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

const child = fork(path.join(here, 'index.js'), {
  env: {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    UNFRAMED_DATA_DIR: dataDir,
    UNFRAMED_CLIENT_DIST: distDir,
    OUTPUT_DIR: outDir,
    PORT: '0',
    UNFRAMED_TEST_VIDEOS_STATUS_BASE: statusStubBase,
    UNFRAMED_TEST_CHAT_COMPLETIONS_URL: midBodyStubBase,
    UNFRAMED_TEST_AUTH_KEYS_URL: authKeyStubUrl,
    UNFRAMED_TEST_KEY_URL: keyInfoStubUrl,
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

// Two blocks below (rename-during-download, once for the sweep and once for
// the poll route) await a promise that only resolves once collectVideo's
// download leg actually starts. Left unbounded, a regression that stops the
// sweep or the poll route from ever reaching that leg doesn't fail an
// assertion -- it hangs this await forever, and with it `npm test`, silently,
// with no output pointing at the cause. Every other wait in this file is
// bounded (this file's own `waitForMessage` above, the store-polling deadlines
// below, `AbortSignal.timeout` on the fetches) for the same reason: a suite
// that runs in CI must fail loudly, not sit there.
const withDeadline = (promise, ms, message) => {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  // Cleared once the race settles either way -- same idiom as waitForMessage's
  // own clearTimeout above. Left uncleared, the timer keeps the event loop
  // alive for the full `ms` regardless of which side won, which is how two
  // orphaned 10s timers turned one 4.8s test file into a 13.9s process.
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
};

try {
  const ready = await waitFor('ready');

  // An OS-assigned port, reported back -- the shell cannot guess it.
  assert.ok(Number.isInteger(ready.port) && ready.port > 0, 'ready carries a real port');
  assert.notEqual(ready.port, 8787, 'PORT=0 means ephemeral, not the default');

  const base = `http://127.0.0.1:${ready.port}`;

  // The API answers on that port.
  assert.equal((await fetch(`${base}/api/health`)).status, 200);

  // The preview origin (server/preview.js): its own OS-assigned port, reported both to
  // the shell and to the canvas, serving the project's pages and nothing of the API.
  assert.ok(Number.isInteger(ready.previewPort) && ready.previewPort > 0, 'ready carries the preview port');
  assert.notEqual(ready.previewPort, ready.port, 'a different port is a different origin');
  assert.equal((await (await fetch(`${base}/api/health`)).json()).previewPort, ready.previewPort, 'health reports it');
  const previewBase = `http://127.0.0.1:${ready.previewPort}`;
  await fs.mkdir(path.join(outDir, 'coast'), { recursive: true });
  await fs.writeFile(path.join(outDir, 'coast', '1-launch.html'), '<h1>coast</h1>');
  await fs.writeFile(path.join(outDir, 'coast', '1-launch.json'), '{"source":"agent"}');
  const previewPage = await fetch(`${previewBase}/p/coast/1-launch.html`);
  assert.equal(previewPage.status, 200);
  assert.equal(await previewPage.text(), '<h1>coast</h1>');
  assert.ok(previewPage.headers.get('content-security-policy')?.includes("connect-src 'none'"), 'a page cannot phone home');
  assert.equal((await fetch(`${previewBase}/p/coast/1-launch.json`)).status, 404, 'a sidecar never leaves the folder');
  assert.equal((await fetch(`${previewBase}/api/health`)).status, 404, 'the API is not behind the preview origin');
  assert.equal((await fetch(`${previewBase}/api/oauth/start`, { method: 'POST' })).status, 404);

  // A request with no Origin at all is the ordinary case -- the packaged app's
  // GETs, the Vite proxy, curl -- and must keep working.
  assert.equal((await fetch(`${base}/api/health`)).status, 200, 'no Origin is not suspicious');

  // A non-loopback Origin is refused before the handler runs, not merely denied
  // the ACAO header. cors() decides only whether to echo that header; for any
  // method but OPTIONS it calls next() either way, so a handler with a side
  // effect still fires. And a POST with no body and no custom header is a CORS
  // simple request, so there is no preflight to refuse either -- which is how a
  // website reaches POST /api/pick-folder and opens a native folder dialog on
  // the user's desktop while being unable to read the reply. 403 is the fix.
  const evil = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.status, 403, 'a cross-origin request never reaches the route');
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  // Specifically for the side-effect shape the header check exists to stop.
  const drive = await fetch(`${base}/api/pick-folder`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(drive.status, 403, 'a bodiless cross-origin POST is refused');

  // A loopback origin reaches the route -- the middleware below only refuses a
  // NON-loopback one -- but nothing is echoed back, so no page can read the reply.
  // This used to reflect the origin "so local tooling keeps working", and that was
  // the hole: neither real consumer is ever cross-origin, so the echo served
  // nobody except a page on some other loopback port. The dev client's calls are
  // all relative, so the browser talks to Vite same-origin and Vite proxies
  // server-side, where no browser CORS check exists; the packaged app is
  // same-origin with the engine outright.
  const dev = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(dev.status, 200, 'a loopback origin is not refused');
  assert.equal(dev.headers.get('access-control-allow-origin'), null, 'but nothing is readable');

  // The payload that makes this worth closing. Any page on any loopback port --
  // another dev server, or an XSS in some locally-hosted tool's web UI -- passes
  // the Origin check. If it could READ this reply it would have the nonce and the
  // challenge, which is everything needed to approve that challenge against its
  // own OpenRouter account and have this server write the resulting key into the
  // user's .env: every later prompt and frame billed to, and visible in, someone
  // else's account. It cannot read it, so the 128-bit nonce stays unguessable.
  const nosy = await fetch(`${base}/api/oauth/start`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000' },
  });
  assert.equal(nosy.headers.get('access-control-allow-origin'), null, 'no cross-origin read of a nonce');
  await fetch(`${base}/api/oauth/pending`, { method: 'DELETE' }); // that attempt superseded a real one

  // Same case rule on the Origin side, which matters more than it looks: this
  // check refuses the REQUEST, so a case mismatch here is a 403 rather than a
  // missing response header.
  const shouty = await fetch(`${base}/api/health`, { headers: { Origin: 'HTTP://LOCALHOST:5173' } });
  assert.equal(shouty.status, 200, 'an upper-case loopback origin is still loopback');

  // And a preflight for a destructive method is refused the same way. cors()
  // answers OPTIONS itself and does not call next(), so this one is settled
  // before the guard above ever sees it -- hence a 2xx with no ACAO rather than
  // a 403, which fails in the browser just as firmly.
  const preflight = await fetch(`${base}/api/key`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'DELETE' },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);

  // /api/model-pricing interpolates its `id` into an upstream OpenRouter URL PATH,
  // so the slug check is a trust boundary rather than input tidiness: anything with a
  // traversal segment, a second slash or a query of its own would let a caller aim
  // this server's fetch somewhere else entirely. Refused before the fetch, so none of
  // these touches the network.
  for (const bad of [
    '',
    'not-a-slug',
    'a/../../b',
    'recraft/recraft-v4-vector/endpoints?x=1',
    '../../v1/key',
    'https://evil.example/x',
  ]) {
    const res = await fetch(`${base}/api/model-pricing?id=${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400, `slug refused: ${JSON.stringify(bad)}`);
  }

  // A well-formed slug OpenRouter has never heard of must come back as "no pricing",
  // not as an error the node has to branch on -- no estimate is a legitimate answer
  // here, since most image models are priced per token and get none either way.
  const noSuchModel = await fetch(`${base}/api/model-pricing?id=nobody/no-such-model`);
  assert.equal(noSuchModel.status, 200);
  assert.deepEqual((await noSuchModel.json()).endpoints, []);

  // The Host check, which is NOT the origin check above in another form. A page
  // served from a hostname the attacker resolves to 127.0.0.1 is same-origin with
  // this server: no Origin is sent, so nothing above runs, and the response is
  // readable. Host is the name the browser actually dialled. Raw http.request
  // because fetch does not let Host be set.
  const withHost = (host, path = '/api/health', method = 'GET') =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: ready.port, path, method, headers: { Host: host } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });

  // Both real consumers: Vite proxies without changeOrigin, so the Host it
  // forwards is its own, and the packaged app loads 127.0.0.1 on the port above.
  assert.equal((await withHost('localhost:5173')).status, 200, 'the dev proxy passes');
  assert.equal((await withHost(`127.0.0.1:${ready.port}`)).status, 200, 'the packaged app passes');
  assert.equal((await withHost('[::1]')).status, 200);
  assert.equal((await withHost('rebound.evil.example')).status, 403);
  assert.equal((await withHost('rebound.evil.example:1234')).status, 403, 'with a port too');

  // Host names are case-insensitive, so LOCALHOST names the same machine and
  // refusing it rejects a request that was always legitimate. Paired with the
  // prefix and suffix tricks below, spelled in caps on purpose: what does the
  // refusing is the anchors and the digits-only port group, not the letter case,
  // so the `i` flag cannot widen what gets through.
  assert.equal((await withHost('LOCALHOST:5173')).status, 200, 'the name is matched case-insensitively');
  assert.equal((await withHost('127.0.0.1')).status, 200);
  assert.equal((await withHost('LOCALHOST.evil.example')).status, 403, 'and a suffix is still no match');
  assert.equal((await withHost('evil.example.localhost')).status, 403, 'nor a prefix');

  // A request with NO Host at all, which http.request will not send -- it
  // substitutes the address it dialled -- so this one goes down a raw socket.
  // HTTP/1.1 requires the header, and Node's own parser refuses the request with
  // a 400 before any middleware runs. Asserted so a future change that starts
  // tolerating a missing Host cannot slip past the middleware above, which reads
  // an absent Host as '' and would refuse it too.
  const hostless = await new Promise((resolve, reject) => {
    const sock = net.connect(ready.port, '127.0.0.1', () =>
      sock.write('GET /api/health HTTP/1.1\r\nConnection: close\r\n\r\n'),
    );
    let raw = '';
    sock.on('data', (c) => (raw += c));
    sock.on('end', () => resolve(raw));
    sock.on('error', reject);
  });
  assert.match(hostless.split('\r\n')[0], /^HTTP\/1\.1 (400|403) /, 'a Host-less request is refused');

  // And the payload that makes this worth checking: /api/oauth/start's nonce and
  // challenge are what let an attacker approve their own OpenRouter account
  // against this flow and have the victim's .env receive THEIR key.
  const rebound = await withHost('rebound.evil.example', '/api/oauth/start', 'POST');
  assert.equal(rebound.status, 403);
  assert.doesNotMatch(rebound.body, /code_challenge/, 'no challenge leaks to a rebound host');

  // The socket itself, which is the only check every assertion above cannot make:
  // they all read headers, and a client that is not a browser writes its own.
  // Tested by dialling a real non-loopback address of this machine rather than by
  // asking the server what it thinks it bound -- a listener on 0.0.0.0 answers
  // here, and one on 127.0.0.1 refuses the connection. Skipped where the machine
  // has no such address to dial, which is a missing test, not a passing one.
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((n) => n && n.family === 'IPv4' && !n.internal);
  if (!lan) {
    console.log('host.test.js: no non-loopback interface, bind assertion skipped');
  } else {
    const reachable = await new Promise((resolve) => {
      const sock = net.connect({ host: lan.address, port: ready.port });
      const done = (answer) => {
        sock.destroy();
        resolve(answer);
      };
      sock.setTimeout(2000, () => done(false));
      sock.on('connect', () => done(true));
      sock.on('error', () => done(false));
    });
    assert.equal(reachable, false, `the API is not listening on ${lan.address}`);
  }

  // ...and the built canvas is served from the same origin, which is what
  // spares the window CORS and file:// handling.
  const page = await fetch(`${base}/index.html`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /canvas/);

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

  // Cancel answers. That a cancelled attempt cannot then be COMPLETED needs the
  // callback route, so it is asserted further down, after the happy path has
  // established that the route works at all.
  assert.equal((await fetch(`${base}/api/oauth/pending`, { method: 'DELETE' })).status, 200);

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

  // Depends on the happy-path block just above having already written a key into
  // .env: the route returns before asking anything when there is no key, so
  // reordering this above that block would assert the wrong branch. The key-info
  // read goes to the local stub, which answers 401 -- the revoked branch.
  const readsBefore = keyInfoReads;
  const status = await fetch(`${base}/api/oauth/status`);
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.hasKey, true);
  assert.equal(statusBody.revoked, true);
  assert.equal(keyInfoReads, readsBefore + 1, 'the key was read from the local stub, not openrouter.ai');
  assert.equal('usage' in statusBody, false, 'no spend is claimed for a key that does not work');

  // 403 is the same outcome as 401. Which one a dead key earns is not documented,
  // and treating only 401 as revoked left the dialog saying "a key is already
  // saved" about a key that no longer works, with nothing offering a reconnect.
  keyInfoAnswer = { status: 403, body: { error: { message: 'forbidden' } } };
  const forbidden = await (await fetch(`${base}/api/oauth/status`)).json();
  assert.equal(forbidden.revoked, true, '403 is revoked too');

  // The success path, which is the only branch that SHAPES anything and had no
  // test at all. The values here are deliberately awkward: a cap sent as a
  // string, which the client would call .toFixed on and crash the whole canvas
  // since client/src has no error boundary; a label that is a truncated form of
  // the key, which is what OpenRouter really returns even for a key the user
  // named while approving; and a limit_reset in an undocumented shape.
  keyInfoAnswer = {
    status: 200,
    body: {
      data: {
        label: 'sk-or-v1-abc...123',
        usage: 1.5,
        limit: '5.00',
        limit_remaining: 3.5,
        limit_reset: 'monthly',
        expires_at: '2026-09-01T00:00:00.000Z',
        is_free_tier: false,
      },
    },
  };
  const live = await (await fetch(`${base}/api/oauth/status`)).json();
  assert.equal(live.hasKey, true);
  assert.equal(live.revoked, undefined);
  assert.equal(live.usage, 1.5);
  assert.equal(live.limitRemaining, 3.5);
  assert.equal(live.limit, null, 'a cap that is not a number becomes null, never a string');
  assert.equal(live.expiresAt, '2026-09-01T00:00:00.000Z');
  assert.equal('label' in live, false, 'the name is unreachable, so the field is not forwarded');
  assert.equal('limitReset' in live, false, 'and neither is a value nothing renders');

  // A key with no cap and no expiry, which is what declining both at the
  // authorization page produces. Both read as null rather than as absent, so the
  // dialog can tell "no cap" from "we could not ask".
  keyInfoAnswer = { status: 200, body: { data: { usage: 0, is_free_tier: true } } };
  const bare = await (await fetch(`${base}/api/oauth/status`)).json();
  assert.deepEqual(bare, {
    hasKey: true,
    usage: 0,
    limit: null,
    limitRemaining: null,
    expiresAt: null,
    isFreeTier: true,
  });

  keyInfoAnswer = { status: 401, body: { error: { message: 'no auth credentials found' } } };

  // ...and the same nonce cannot be replayed.
  assert.equal((await fetch(`${base}${okPath}?code=good-code`)).status, 400);

  // A cancelled attempt cannot be completed either: approving in the browser
  // after pressing Cancel must not quietly write a key.
  const abandoned = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const abandonedPath = new URL(new URL(abandoned.authorizeUrl).searchParams.get('callback_url')).pathname;
  await fetch(`${base}/api/oauth/pending`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}${abandonedPath}?code=good-code`)).status, 400);

  // What the app polls, end to end. Before this route existed it watched
  // /api/health for a changed key hint, which could only ever detect success -- so
  // every failure below left the app saying "waiting for OpenRouter in your
  // browser" for ten minutes about an attempt that was already dead.
  const poll = () => fetch(`${base}/api/oauth/pending`).then((r) => r.json());

  await fetch(`${base}/api/oauth/pending`, { method: 'DELETE' });
  assert.deepEqual(await poll(), { state: 'none' }, 'nothing in flight');

  const watched = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const watchedPath = new URL(new URL(watched.authorizeUrl).searchParams.get('callback_url')).pathname;
  const waiting = await poll();
  assert.equal(waiting.state, 'waiting');
  // The one function in oauth.js whose output a client reads. Neither the verifier
  // nor the key may appear in it, whatever else changes about the shape.
  const waitingRaw = JSON.stringify(waiting);
  assert.equal(/verifier/i.test(waitingRaw), false, 'no verifier reaches the client');
  assert.equal(/sk-or-/.test(waitingRaw), false, 'and no key material');
  assert.deepEqual(Object.keys(waiting).sort(), ['reason', 'state']);

  // A refused code fails the attempt, with OpenRouter's own reason, instead of
  // leaving the app to time out.
  assert.equal((await fetch(`${base}${watchedPath}?code=refused-code`)).status, 502);
  const refusedOutcome = await poll();
  assert.equal(refusedOutcome.state, 'failed');
  assert.match(refusedOutcome.reason, /invalid code/, "the upstream reason reaches the app, not just 'it failed'");

  // A callback for a nonce this process never issued must not touch the live
  // attempt -- otherwise anyone who can reach the callback can strand a flow.
  await fetch(`${base}/api/oauth/pending`, { method: 'DELETE' });
  const guarded = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const guardedPath = new URL(new URL(guarded.authorizeUrl).searchParams.get('callback_url')).pathname;
  assert.equal((await fetch(`${base}/api/oauth/callback/${'f'.repeat(32)}?code=good-code`)).status, 400);
  assert.equal((await poll()).state, 'waiting', 'a stranger cannot fail my attempt');

  // And the happy path reports done, once, even if the callback is replayed.
  assert.equal((await fetch(`${base}${guardedPath}?code=good-code`)).status, 200);
  assert.deepEqual(await poll(), { state: 'done', reason: '' });
  assert.equal((await fetch(`${base}${guardedPath}?code=good-code`)).status, 400, 'the replay is refused');
  assert.deepEqual(await poll(), { state: 'done', reason: '' }, 'and does not rewrite the outcome');

  // Removing the key cancels a live attempt too, which is the case Cancel does
  // not cover: the attempt outlives the client state that started it, so a user
  // who presses Connect, reloads, then removes the key still has an approval on
  // its way back. Without this the key returns minutes after the app said it was
  // gone -- and the renders this route just failed stay failed.
  const orphan = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const orphanPath = new URL(new URL(orphan.authorizeUrl).searchParams.get('callback_url')).pathname;
  assert.equal((await fetch(`${base}/api/key`, { method: 'DELETE' })).status, 200);
  assert.doesNotMatch(
    await fs.readFile(path.join(dataDir, '.env'), 'utf8'),
    /^OPENROUTER_API_KEY=/m,
    'the key line is gone',
  );
  assert.equal((await fetch(`${base}${orphanPath}?code=good-code`)).status, 400, 'the approval is refused');
  assert.doesNotMatch(
    await fs.readFile(path.join(dataDir, '.env'), 'utf8'),
    /^OPENROUTER_API_KEY=/m,
    'and nothing wrote it back',
  );

  // The SAME case as the orphan block above, in the ordering that block does not
  // cover: DELETE /api/key arriving AFTER the callback has claimed the verifier and
  // while the exchange is still in flight. oauthCancel() only empties the store, and
  // the store is not what the write path consults -- so before the liveness check
  // the callback wrote the key back to a .env the app had just reported empty, and
  // said "Connected to OpenRouter" while doing it. Three documents promise this
  // cannot happen (README, CHANGELOG, and CLAUDE.md), and the assertion above agreed
  // with them because it only ever tested the easy half.
  const cancelRace = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const cancelRacePath = new URL(new URL(cancelRace.authorizeUrl).searchParams.get('callback_url')).pathname;
  // Not awaited: the callback has to be mid-exchange when the delete lands.
  const inFlight = fetch(`${base}${cancelRacePath}?code=slow-code`);
  await new Promise((r) => setTimeout(r, 250)); // inside the stub's 700ms
  assert.equal((await fetch(`${base}/api/key`, { method: 'DELETE' })).status, 200);
  const lateExchange = await inFlight;
  assert.equal(lateExchange.status, 409, 'a cancelled attempt does not get to save a key');
  assert.match(await lateExchange.text(), /cancell?ed/i);
  assert.doesNotMatch(
    await fs.readFile(path.join(dataDir, '.env'), 'utf8'),
    /^OPENROUTER_API_KEY=/m,
    'and the key the user removed stays removed',
  );
  // The live process too, not just the file -- generations read the binding.
  assert.equal((await (await fetch(`${base}/api/health`)).json()).hasKey, false);

  // Saving a pasted key is the same act as removing one: it settles which
  // credential the app uses, so an approval still in flight must not overwrite it.
  // PUT /api/config had no cancel at all, so the later exchange silently won -- and
  // it always won, because a network round trip is slower than a local PUT.
  const pasted = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const pastedPath = new URL(new URL(pasted.authorizeUrl).searchParams.get('callback_url')).pathname;
  assert.equal(
    (
      await fetch(`${base}/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'sk-or-v1-thepastedonewins' }),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(`${base}${pastedPath}?code=good-code`)).status, 400, 'the approval is refused');
  assert.match(
    await fs.readFile(path.join(dataDir, '.env'), 'utf8'),
    /^OPENROUTER_API_KEY=sk-or-v1-thepastedonewins$/m,
    'the key the user typed is the key that survives',
  );

  // Finding 01: DELETE /api/oauth/pending -- what the Cancel button calls -- must
  // undo a key the callback already committed, the way DELETE /api/key does.
  // Before the fix it only emptied the store and wrote no null, so a key the user
  // cancelled stayed live on disk while the poll, seeing the emptied store, told
  // them the connection was lost. The callback runs to completion here, then the
  // cancel lands: the write's async fs I/O lets a cancel interleave after the
  // commit check, and the outcome is the same whether it lands during the write or
  // just after it -- the store carries no way to undo a committed key.
  await fetch(`${base}/api/key`, { method: 'DELETE' }); // keyless precondition
  const installStart = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const installPath = new URL(new URL(installStart.authorizeUrl).searchParams.get('callback_url')).pathname;
  assert.equal((await fetch(`${base}${installPath}?code=good-code`)).status, 200, 'the callback commits a key');
  assert.equal((await fetch(`${base}/api/oauth/pending`, { method: 'DELETE' })).status, 200);
  assert.doesNotMatch(
    await fs.readFile(path.join(dataDir, '.env'), 'utf8'),
    /^OPENROUTER_API_KEY=/m,
    'Cancel undoes the key it caused to be written, so none is left on disk',
  );
  assert.equal((await (await fetch(`${base}/api/health`)).json()).hasKey, false,
    'and the live process is not holding it either');

  // The other half of that fix must NOT over-reach: cancelling an attempt that was
  // never approved leaves a PRE-EXISTING key untouched. This is the case a blunt
  // "Cancel always clears the key" would break -- a reconnect the user abandons.
  await fetch(`${base}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'sk-or-v1-preexistingkeepme00' }),
  });
  await fetch(`${base}/api/oauth/start`, { method: 'POST' }); // waiting, never approved
  assert.equal((await fetch(`${base}/api/oauth/pending`, { method: 'DELETE' })).status, 200);
  assert.match(
    await fs.readFile(path.join(dataDir, '.env'), 'utf8'),
    /^OPENROUTER_API_KEY=sk-or-v1-preexistingkeepme00$/m,
    'cancelling an unapproved attempt does not touch the key already saved',
  );

  // Restored, because the assertions after this block expect a key to exist --
  // and sent as four CONCURRENT writes, which is the point. Every .env write is a
  // read-modify-write, so without a queue two of them racing drop one's update
  // silently: each reads the same text and the last writer wins. Four at once
  // makes that near-certain rather than occasional. The OAuth callback is what
  // brought this within reach, since it lands on browser timing rather than on a
  // click, while Save stays deliberately live during a connect.
  const settled = await Promise.all(
    [
      { key: 'sk-or-v1-restoredforlatertests' },
      { imageModel: 'stub/concurrent-image' },
      { textModel: 'stub/concurrent-text' },
      { videoModel: 'stub/concurrent-video' },
    ].map((body) =>
      fetch(`${base}/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.status),
    ),
  );
  assert.deepEqual(settled, [200, 200, 200, 200]);
  const raced = await fs.readFile(path.join(dataDir, '.env'), 'utf8');
  for (const line of [
    'OPENROUTER_API_KEY=sk-or-v1-restoredforlatertests',
    'OPENROUTER_IMAGE_MODEL=stub/concurrent-image',
    'OPENROUTER_TEXT_MODEL=stub/concurrent-text',
    'OPENROUTER_VIDEO_MODEL=stub/concurrent-video',
  ]) {
    assert.match(raced, new RegExp(`^${line.replace('/', '\\/')}$`, 'm'), `${line} survived the race`);
  }

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
  // Nothing was saved -- the page's own promise, and the point of validating
  // before writing at all.
  assert.doesNotMatch(
    await fs.readFile(path.join(dataDir, '.env'), 'utf8'),
    /not-a-key/,
  );

  // An upstream refusal is reported, not swallowed, and still as a page.
  const refusedStart = await (await fetch(`${base}/api/oauth/start`, { method: 'POST' })).json();
  const refusedPath = new URL(new URL(refusedStart.authorizeUrl).searchParams.get('callback_url')).pathname;
  const refusedCallback = await fetch(`${base}${refusedPath}?code=refused-code`);
  assert.equal(refusedCallback.status, 502);
  assert.match(refusedCallback.headers.get('content-type') || '', /text\/html/);

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

  // A terminal upstream status must end the job, whatever string the provider
  // used for it. Seed four `pending` records -- what the sweep or an earlier
  // poll would have left -- and let this route actually poll. The status stub
  // above answers in place of OpenRouter, so this exercises the real
  // classify-and-persist code in server/index.js rather than a value the test
  // invented; removing any of `expired`/`cancelled`/`failed` from
  // TERMINAL_FAILURE_STATUSES makes that status's assertions below fail while
  // the rest of the suite stays green -- which is exactly how the historical
  // gap this set exists to close (a name missing from it) went unnoticed.
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
        id: 'cancelled-job',
        project: '',
        params: { prompt: 'a job the user cancelled', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now(),
        status: 'pending',
      },
      {
        id: 'failed-job',
        project: '',
        params: { prompt: 'a job that failed outright, not by timeout or cancellation', model: 'bytedance/seedance-2.0' },
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

  // `cancelled` and `failed` are the other two names the row this set backs
  // enumerates ("fails, expires, or is cancelled") -- `expired` alone left the
  // other two unproven, and a name missing from TERMINAL_FAILURE_STATUSES is
  // exactly the shape of bug its own comment describes.
  const cancelledRes = await fetch(`${base}/api/video/cancelled-job`);
  assert.equal(cancelledRes.status, 200);
  const cancelledBody = await cancelledRes.json();
  assert.equal(cancelledBody.status, 'failed', 'a cancelled job reads as failed to the client');
  assert.equal(cancelledBody.error, 'Job was cancelled', "the provider's own message survives, not a generic one");
  const jobsAfterCancelled = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  assert.equal(
    jobsAfterCancelled.find((j) => j.id === 'cancelled-job').status,
    'failed',
    'the store is updated too, not just the response',
  );

  const failedRes = await fetch(`${base}/api/video/failed-job`);
  assert.equal(failedRes.status, 200);
  const failedBody = await failedRes.json();
  assert.equal(failedBody.status, 'failed', 'a job the provider itself calls failed reads as failed to the client');
  assert.equal(failedBody.error, 'Generation failed upstream', "the provider's own message survives, not a generic one");
  const jobsAfterFailed = JSON.parse(await fs.readFile(path.join(outDir, 'jobs.json'), 'utf8'));
  assert.equal(
    jobsAfterFailed.find((j) => j.id === 'failed-job').status,
    'failed',
    'the store is updated too, not just the response',
  );

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

  // An unreadable .env must not be silently treated as empty. writeEnv reads the
  // file, edits it and writes it back; if the read failure becomes "" the write
  // emits only this request's fields and DELETES every other line, the key
  // included, while the route answers 200. Mode 0o200 is the exact repro: the
  // owner can write (so the erasing write would succeed) but not read (so the
  // read fails for a reason that is NOT "file absent"). The key must survive
  // whichever way the route resolves.
  {
    const envPath = path.join(dataDir, '.env');
    assert.match(await fs.readFile(envPath, 'utf8'), /^OPENROUTER_API_KEY=/m, 'precondition: a key is on disk');
    await fs.chmod(envPath, 0o200); // write-only: read fails EACCES, a write would still land
    const put = await fetch(`${base}/api/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageModel: 'openai/gpt-image-2' }),
    });
    await fs.chmod(envPath, 0o600); // restore before reading, and for later tests + cleanup
    assert.equal(put.status, 500, 'a read that failed for anything but ENOENT is refused, not treated as empty');
    assert.match(
      await fs.readFile(envPath, 'utf8'),
      /^OPENROUTER_API_KEY=/m,
      'and the key the read could not see is still on disk',
    );
    // The live process still holds it too, so nothing downstream broke.
    assert.equal((await (await fetch(`${base}/api/health`)).json()).hasKey, true);
  }

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

  // The same hang, three cheaper doors. Each of these routes awaits filesystem
  // work outside any try/catch, so a disk error was a request that never
  // answered -- for the first one that is AUTOSAVE, work that looks saved and
  // is not. A directory where the file belongs is the deterministic way to make
  // each write fail (the presets.test.js / jobs.test.js trick); the timeout on
  // each fetch is the hang detector.

  // POST /api/projects/:name/ops -- the save path. A directory where graph.log belongs
  // makes the journal append fail.
  await fs.mkdir(path.join(outDir, 'wrapcheck', 'graph.log'), { recursive: true });
  const saveBlocked = await fetch(`${base}/api/projects/wrapcheck/ops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops: [{ type: 'addNode', node: { id: 'z', type: 'prompt', position: { x: 0, y: 0 }, data: {} } }], origin: { id: 't' } }),
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

  // ---- the document (2026-09-04): create, ops, events, undo/redo, files, rename ----
  // The server owns the graph; the browser sends ops and listens on an SSE stream.
  // Everything here goes through the real routes against the forked server.
  {
    const docBase = `${base}/api/projects/docproj`;
    const json = (method, url, body) =>
      fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    const dn = (id) => ({ id, type: 'prompt', position: { x: 0, y: 0 }, data: { text: id } });

    // Create with a starter graph: one system commit, version 1. A second create is a 409.
    const created = await json('POST', docBase, { nodes: [dn('a')], edges: [] });
    assert.equal(created.status, 200);
    assert.equal((await created.json()).version, 1);
    assert.equal((await json('POST', docBase, {})).status, 409, 'creating over an existing project is refused');
    const got = await (await fetch(docBase)).json();
    assert.equal(got.version, 1);
    assert.deepEqual(got.nodes.map((n) => n.id), ['a']);

    // Ops: applied and rejected reported separately; the origin's kind is forced to
    // `session` whatever the body claimed.
    const opsRes = await json('POST', `${docBase}/ops`, {
      ops: [{ type: 'addNode', node: dn('b') }, { type: 'moveNode', id: 'ghost', position: { x: 0, y: 0 } }],
      origin: { kind: 'thread', id: 'tab-1' },
    });
    const o = await opsRes.json();
    assert.equal(o.version, 2);
    assert.equal(o.applied.length, 1);
    assert.deepEqual(o.applied[0].origin, { kind: 'session', id: 'tab-1' });
    assert.equal(o.rejected.length, 1);
    assert.match(o.rejected[0].reason, /no node/);
    assert.equal((await json('POST', `${docBase}/ops`, { ops: [], origin: { id: 'x' } })).status, 400);
    assert.equal((await json('POST', `${docBase}/ops`, { ops: [{ type: 'moveNode', id: 'a', position: { x: 1, y: 1 } }] })).status, 400, 'origin is required');

    // The event stream: replay from `since`, then a version marker, then live entries.
    const streamAbort = new AbortController();
    const ev = await fetch(`${docBase}/events?since=0`, { signal: streamAbort.signal });
    assert.equal(ev.status, 200);
    assert.ok(ev.headers.get('content-type').startsWith('text/event-stream'));
    const reader = ev.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    // Reads until `until(events)` is satisfied; returns the events read by THIS call.
    const readEvents = (until) =>
      withDeadline(
        (async () => {
          const events = [];
          for (;;) {
            let sep;
            while ((sep = sseBuffer.indexOf('\n\n')) !== -1) {
              const frame = sseBuffer.slice(0, sep);
              sseBuffer = sseBuffer.slice(sep + 2);
              if (frame.startsWith(':')) continue; // heartbeat comment
              const event = /^event: (.*)$/m.exec(frame)?.[1];
              const data = /^data: (.*)$/m.exec(frame)?.[1];
              events.push({ event, data: data ? JSON.parse(data) : null });
            }
            if (until(events)) return events;
            const { value, done } = await reader.read();
            if (done) return events;
            sseBuffer += decoder.decode(value, { stream: true });
          }
        })(),
        5000,
        'the event stream did not deliver in time',
      );
    const replay = await readEvents((evs) => evs.some((e) => e.event === 'version'));
    assert.deepEqual(replay.filter((e) => e.event === 'entry').map((e) => e.data.version), [1, 2], 'replay from 0 delivers both entries');
    assert.equal(replay.at(-1).data.version, 2, 'then the live marker');
    await json('POST', `${docBase}/ops`, { ops: [{ type: 'moveNode', id: 'a', position: { x: 7, y: 7 } }], origin: { id: 'tab-2' } });
    const live = await readEvents((evs) => evs.some((e) => e.event === 'entry'));
    assert.equal(live[0].data.version, 3);
    assert.equal(live[0].data.origin.id, 'tab-2', 'a live entry names who made it');

    // Undo and redo through the routes, broadcast like anything else; 204 when idle.
    const u = await json('POST', `${docBase}/undo`, { origin: { id: 'tab-2' } });
    assert.equal(u.status, 200);
    assert.equal((await u.json()).undoes, 3);
    assert.deepEqual((await (await fetch(docBase)).json()).nodes.find((n) => n.id === 'a').position, { x: 0, y: 0 });
    assert.equal((await json('POST', `${docBase}/redo`, {})).status, 200);
    assert.equal((await json('POST', `${docBase}/redo`, {})).status, 204, 'nothing left to redo');
    const walked = await readEvents((evs) => evs.filter((e) => e.event === 'entry').length >= 2);
    assert.deepEqual(walked.map((e) => e.data.origin.kind), ['undo', 'redo']);

    // Files: raw bytes in, a named file plus sidecar out, served back by /api/file.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await fetch(`${docBase}/files?name=Hero%20Shot.png`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: png,
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(up.status, 200);
    const uploaded = await up.json();
    assert.match(uploaded.file, /^\d+-hero-shot\.png$/);
    assert.equal(uploaded.bytes, 70);
    await fs.access(path.join(outDir, 'docproj', uploaded.file));
    const sidecar = JSON.parse(await fs.readFile(path.join(outDir, 'docproj', uploaded.file.replace(/\.png$/, '.json')), 'utf8'));
    assert.equal(sidecar.source, 'upload');
    assert.equal(sidecar.fileName, 'Hero Shot.png');
    assert.equal((await fetch(`${base}/api/file/docproj/${uploaded.file}`)).status, 200);
    assert.equal((await fetch(`${docBase}/files`, { method: 'POST', body: '', signal: AbortSignal.timeout(5000) })).status, 400, 'no bytes is a 400');
    // A copy for a pasted page node: its own file, same bytes, sidecar naming the original.
    const cp = await json('POST', `${docBase}/files/copy`, { file: uploaded.file });
    assert.equal(cp.status, 200);
    const copied = (await cp.json()).file;
    assert.notEqual(copied, uploaded.file);
    assert.match(copied, /^\d+-hero-shot\.png$/);
    assert.deepEqual(await fs.readFile(path.join(outDir, 'docproj', copied)), png);
    assert.equal(JSON.parse(await fs.readFile(path.join(outDir, 'docproj', copied.replace(/\.png$/, '.json')), 'utf8')).of, uploaded.file);
    assert.equal((await json('POST', `${docBase}/files/copy`, { file: 'nope.png' })).status, 404);
    assert.equal((await json('POST', `${docBase}/files/copy`, { file: '../x.png' })).status, 400);
    assert.equal((await json('POST', `${docBase}/files/copy`, {})).status, 400);

    // Rename ends the stream (the tab reconnects under the new name) and the graph,
    // journal included, follows the folder.
    assert.equal((await json('POST', `${docBase}/rename`, { to: 'docproj-2' })).status, 200);
    const ended = await withDeadline(reader.read(), 5000, 'the stream did not end on rename');
    assert.equal(ended.done, true, 'the event stream ended when the project was renamed');
    const moved = await (await fetch(`${base}/api/projects/docproj-2`)).json();
    assert.equal(moved.version, 5, 'create, add, move, undo, redo');
    assert.deepEqual(moved.nodes.map((n) => n.id), ['a', 'b']);
    streamAbort.abort();

    // A graph saved before media left the document is rewritten on first open: the bytes
    // become a file, the node keeps the name, and the rewrite is version 1.
    const legacyDir = path.join(outDir, 'legacy-media');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, 'graph.json'),
      JSON.stringify({
        nodes: [{ id: 'img', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: `data:image/png;base64,${png.toString('base64')}`, fileName: 'old.png' } }],
        edges: [],
      }),
    );
    const legacy = await (await fetch(`${base}/api/projects/legacy-media`)).json();
    assert.equal(legacy.version, 1);
    assert.equal(legacy.nodes[0].data.dataUrl, undefined);
    assert.match(legacy.nodes[0].data.file, /-old\.png$/);
    assert.equal((await fs.readFile(path.join(legacyDir, legacy.nodes[0].data.file))).length, 70);
    assert.equal((await fs.readFile(path.join(legacyDir, 'graph.log'), 'utf8')).includes('base64'), false, 'no bytes in the journal');
  }

  // ---- local agent providers (2026-09-04): detection against the fake binaries ----
  {
    const providers = async (q = '') => (await (await fetch(`${base}/api/providers${q}`, { signal: AbortSignal.timeout(30000) })).json()).providers;
    const config = (body) =>
      fetch(`${base}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });

    let pv = await providers();
    assert.equal(pv.claude.status, 'auth_unknown', 'fake claude runs but cannot answer the SDK probe');
    assert.equal(pv.claude.installed, true);
    assert.equal(pv.claude.version, '9.9.9');
    assert.match(pv.claude.message, /could not verify/i);
    assert.equal(pv.codex.status, 'signed_out');
    assert.equal(pv.codex.version, '8.8.8');
    assert.match(pv.codex.message, /codex login/);

    // Signing in is not noticed until asked: the answer is cached for five minutes.
    await fs.writeFile(path.join(fakeBin, 'codex-status'), 'Logged in using ChatGPT\n');
    assert.equal((await providers()).codex.status, 'signed_out', 'cached');
    pv = await providers('?refresh=1');
    assert.equal(pv.codex.status, 'ready');
    assert.deepEqual(pv.codex.auth, { plan: 'ChatGPT' });
    assert.equal(pv.codex.message, undefined);

    // A configured path that does not exist: not installed. Changing the setting drops
    // the cache on its own. The setting is validated like every other, and clearing it
    // goes back to PATH.
    assert.equal((await config({ claudePath: '/nonexistent/claude' })).status, 200);
    assert.equal((await (await fetch(`${base}/api/health`)).json()).claudePath, '/nonexistent/claude');
    pv = await providers();
    assert.equal(pv.claude.status, 'not_installed');
    assert.equal(pv.claude.installed, false);
    assert.equal((await config({ claudePath: 'claude; rm -rf ~' })).status, 400, 'a shell-shaped name is refused');
    assert.equal((await config({ claudeConfigDir: 'relative/dir' })).status, 400, 'a config dir must be absolute');
    assert.equal((await config({ claudePath: '' })).status, 200, 'empty clears the override');
    assert.equal((await (await fetch(`${base}/api/health`)).json()).claudePath, '');
    assert.equal((await providers()).claude.status, 'auth_unknown', 'back on PATH');

    // A binary that is there but fails: installed, will not run.
    assert.equal((await config({ codexPath: path.join(fakeBin, 'broken') })).status, 200);
    pv = await providers();
    assert.equal(pv.codex.status, 'wont_run');
    assert.equal(pv.codex.installed, true);
    assert.match(pv.codex.message, /failed to run/);
    assert.equal((await config({ codexPath: '' })).status, 200);
    assert.equal((await providers()).codex.status, 'ready');
  }

  // ---- agent threads (2026-09-04): the record and the routes, without a real agent ----
  // The fake claude on PATH answers --version and nothing else, so a turn cannot start;
  // what is tested here is everything around the turn: creation, listing, the record,
  // the stream's replay, and that a provider that is not ready fails the turn loudly and
  // leaves the thread marked failed rather than hanging.
  {
    const tBase = `${base}/api/projects/threadproj/threads`;
    const json = (method, url, body) =>
      fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    assert.equal((await json('POST', tBase, { provider: 'grok' })).status, 400, 'unknown provider');
    const created = await (await json('POST', tBase, { provider: 'claude', model: 'claude-opus-5' })).json();
    assert.match(created.thread.id, /^t-/);
    assert.equal(created.thread.status, 'idle');
    assert.equal(created.thread.provider, 'claude');
    const list = await (await fetch(`${tBase}`)).json();
    assert.deepEqual(list.threads.map((t) => t.id), [created.thread.id]);
    assert.equal((await fetch(`${tBase}/nope`)).status, 404);
    assert.equal((await json('POST', `${tBase}/${created.thread.id}/messages`, { text: '  ' })).status, 400, 'an empty message is refused');
    // The provider is not ready (the fake cannot answer the auth probe), so the turn
    // fails before anything is spawned for real -- and says why.
    const turn = await json('POST', `${tBase}/${created.thread.id}/messages`, { text: 'hello', selection: ['1'] });
    assert.equal(turn.status, 500);
    assert.match((await turn.json()).error, /could not verify|not ready/i);
    const after = (await (await fetch(`${tBase}/${created.thread.id}`)).json()).thread;
    assert.equal(after.status, 'failed', 'a turn that could not start leaves the thread failed, not running');
    assert.equal(after.messages.length, 1, 'the user message is kept');
    assert.deepEqual(after.messages[0].selection, ['1']);
    assert.ok(after.events.some((e) => e.type === 'error'), 'and the failure is an event on the record');
    // The stream replays the record: state first, the stored events, then a live marker.
    const ev = await fetch(`${tBase}/${created.thread.id}/events?since=0`, { signal: AbortSignal.timeout(5000) });
    const text = await withDeadline(
      (async () => {
        const reader = ev.body.getReader();
        let got = '';
        while (!got.includes('event: live')) {
          const { value, done } = await reader.read();
          if (done) break;
          got += new TextDecoder().decode(value);
        }
        reader.cancel();
        return got;
      })(),
      5000,
      'the thread stream did not replay',
    );
    assert.match(text, /event: state\ndata: \{"status":"failed"/);
    assert.match(text, /event: event\ndata: \{[^\n]*"type":"error"/);
    // The composer's message shape rides along and is kept on the record.
    const composed = await (await json('POST', tBase, { provider: 'claude' })).json();
    await json('POST', `${tBase}/${composed.thread.id}/messages`, { text: 'swap the hero', selection: ['104', '100'], target: '104', with: ['100'] });
    const kept = (await (await fetch(`${tBase}/${composed.thread.id}`)).json()).thread.messages[0];
    assert.equal(kept.target, '104');
    assert.deepEqual(kept.with, ['100']);
    // A target that is not a node id is dropped, not stored.
    const odd = await (await json('POST', tBase, { provider: 'claude' })).json();
    await json('POST', `${tBase}/${odd.thread.id}/messages`, { text: 'x', target: 'not a node id!' });
    assert.equal('target' in (await (await fetch(`${tBase}/${odd.thread.id}`)).json()).thread.messages[0], false);
    // Artifact threads (slice 2): about one node, listable by it.
    assert.equal((await json('POST', tBase, { provider: 'claude', kind: 'sticky' })).status, 400, 'unknown kind');
    assert.equal((await json('POST', tBase, { provider: 'claude', kind: 'artifact', artifactId: '../x' })).status, 400, 'artifactId must be a node id');
    const art = await (await json('POST', tBase, { provider: 'claude', kind: 'artifact', artifactId: '104' })).json();
    assert.equal(art.thread.kind, 'artifact');
    assert.equal(art.thread.artifactId, '104');
    const pending = await (await json('POST', tBase, { provider: 'claude', kind: 'artifact' })).json();
    assert.equal(pending.thread.artifactId, null, 'bound later, when the agent creates the node');
    const byArtifact = await (await fetch(`${tBase}?artifact=104`)).json();
    assert.deepEqual(byArtifact.threads.map((t) => t.id), [art.thread.id]);
    assert.equal((await (await fetch(`${tBase}?artifact=999`)).json()).threads.length, 0);
    assert.ok((await (await fetch(tBase)).json()).threads.length >= 4, 'unfiltered lists everything');
    for (const t of [composed, odd, art, pending]) await fetch(`${tBase}/${t.thread.id}`, { method: 'DELETE' });
    assert.equal((await fetch(`${tBase}/${created.thread.id}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual((await (await fetch(tBase)).json()).threads, []);
  }

  // The fourth hardened call site: the poll route's terminal-failure persistJob.
  // A store write CAN be made to fail on demand -- the same
  // directory-where-a-file-belongs trick as above makes writeJobs' rename fail
  // with EISDIR -- so this branch gets the same regression test as the other
  // three instead of being review-verified only. readJobs swallows its own read
  // error and answers [], so the route still reaches the branch under test.
  const jobsFile = path.join(outDir, 'jobs.json');
  const jobsBackup = await fs.readFile(jobsFile, 'utf8').catch(() => '[]');
  await fs.rm(jobsFile, { force: true });
  await fs.mkdir(jobsFile);
  const persistBlocked = await fetch(`${base}/api/video/expired-job`, { signal: AbortSignal.timeout(5000) });
  assert.equal(persistBlocked.status, 502,
    'a terminal upstream status that cannot be recorded answers instead of hanging');
  assert.match((await persistBlocked.json()).error, /recording that failed/i,
    'and the message says recording the failure is what failed');
  await fs.rm(jobsFile, { recursive: true, force: true });
  await fs.writeFile(jobsFile, jobsBackup);

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

  // A folder change that finds the key already gone must not carry a pending render
  // into the new store and leave it there unswept. That is the state a DELETE
  // /api/key racing this move produces: the delete fails the pending records in the
  // OLD store it can see, the move copies them into the NEW store as pending, and
  // with no key the sweep never touches them -- a paid render stranded in the live
  // store while the app said it ended every render. Seeded directly here (pending
  // records + no key) rather than raced, because that is the state to guard and it
  // is deterministic; the interleavings that reach it are argued in the commit.
  await fetch(`${base}/api/key`, { method: 'DELETE' }); // key gone: API_KEY = ''
  assert.equal((await (await fetch(`${base}/api/health`)).json()).hasKey, false, 'precondition: no key');
  const strandOut = path.join(dataDir, 'strand-src');
  const strandDest = path.join(dataDir, 'strand-dst');
  await fs.mkdir(strandOut, { recursive: true });
  // Point the live store at strand-src, then seed a pending record into it.
  assert.equal((await fetch(`${base}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputDir: strandOut }),
  })).status, 200);
  await fs.writeFile(path.join(strandOut, 'jobs.json'), JSON.stringify([
    { id: 'paid-1', project: '', status: 'pending', startedAt: Date.now(), params: {} },
  ]));
  // Now move the folder while keyless. The record travels; without the fix it lands
  // pending in the new store and stays there.
  assert.equal((await fetch(`${base}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputDir: strandDest }),
  })).status, 200);
  const strandedMoved = JSON.parse(await fs.readFile(path.join(strandDest, 'jobs.json'), 'utf8')).find((j) => j.id === 'paid-1');
  assert.ok(strandedMoved, 'the record moved to the new store');
  assert.equal(strandedMoved.status, 'failed',
    'a render moved with no key to poll it is failed, not left pending where nothing sweeps it');

} finally {
  child.kill();
  await new Promise((resolve) => statusStub.close(resolve));
  await new Promise((resolve) => midBodyStub.close(resolve));
  await new Promise((resolve) => authKeyStub.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
}

// ---- sweep staleness (2026-08-17) ----
// sweepJobs takes ONE snapshot of the store per tick and used to hand that
// snapshot straight to collectVideo, instead of a fresh re-read, when a job
// turned out to be done. At the time this bug existed, collectVideo trusted
// `.project` on whatever job it was handed (`projectDir(job.project)`,
// mkdir'd with recursive:true) -- so a rename landing between the tick's
// snapshot and the call into collectVideo recreated the OLD project folder,
// exactly the ghost-project bug reassignPendingJobs exists to prevent, just
// reopened by the sweep instead of the rename route. 850666b fixed THIS
// window, by call site (see the comment below); collectVideo's own re-read,
// added 2026-08-17 (the "rename during the download window" block further
// down), closed a second, longer-lived window inside collectVideo itself and
// is now what actually decides the folder in every case this block exercises.
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

    // THE assertion this block exists for. It used to be true that this failed
    // before 850666b and passed after, because that fix was what made
    // sweepOneInner pass the freshly re-read record instead of this tick's
    // stale snapshot. It no longer discriminates between the two: since the
    // 2026-08-17 "rename during the download window" fix below, collectVideo
    // re-reads the store itself, by id, right before it writes -- so it lands
    // on "beta" whether it's handed the stale snapshot or the fresh record.
    // The guarantee this asserts has moved from sweepOneInner's call site into
    // collectVideo; this block is kept because it still exercises a real
    // rename racing a real sweep tick end to end, just no longer as the thing
    // that would catch a regression in WHICH copy sweepOneInner passes in.
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
      {
        // No unreachableSince yet -- this is a job's FIRST unanswered poll, the
        // other end of the give-up chain giveup-job above assumes already
        // started ticking. Without this case nothing ever proved the clock
        // actually gets STARTED, only that a clock already running eventually
        // fires. The stub 404s this one too (absent from branchResponses
        // below), the same shape an id OpenRouter has forgotten produces.
        id: 'stamp-job',
        project: '',
        params: { prompt: 'the clock has not started ticking yet', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now() - 5 * 60 * 1000,
        status: 'pending',
      },
    ]),
  );

  // Per-id answers: giveup-job and stamp-job are deliberately ABSENT, so the
  // stub 404s them both -- the exact shape an id OpenRouter has forgotten
  // produces.
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

    // The boot sweep resolves all four; poll the store until it has.
    let jobs;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      jobs = JSON.parse(await fs.readFile(path.join(outDir3, 'jobs.json'), 'utf8').catch(() => '[]'));
      const giveup = jobs.find((j) => j.id === 'giveup-job');
      const terminal = jobs.find((j) => j.id === 'sweep-terminal-job');
      const cleared = jobs.find((j) => j.id === 'clockclear-job');
      const stamped = jobs.find((j) => j.id === 'stamp-job');
      if (
        giveup?.status === 'failed' &&
        terminal?.status === 'failed' &&
        cleared &&
        !('unreachableSince' in cleared) &&
        stamped?.status === 'pending' &&
        Number.isFinite(stamped?.unreachableSince)
      ) {
        break;
      }
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

    // The other end of the give-up chain: giveup-job above only proves the
    // clock fires once it is already running. This proves it gets STARTED --
    // a job's first unanswered poll must stamp unreachableSince rather than
    // leaving it unset forever (in which case givenUp's `now - undefined` is
    // NaN and the job would never be given up on at all).
    const stamped = jobs.find((j) => j.id === 'stamp-job');
    assert.equal(stamped?.status, 'pending', 'a forgotten job is not failed on its first missed poll');
    assert.ok(
      Number.isFinite(stamped?.unreachableSince),
      'but the silence clock starts ticking from that first miss',
    );
    // The middle link -- that the `if (!job.unreachableSince)` guard on that
    // same line also stops a SECOND and later miss from rewriting the stamp
    // forward -- is NOT this single boot sweep's to prove; a single process
    // observing it would mean waiting out a real, unconfigurable 30s interval
    // tick, which this test does not do. It is proven separately, and for
    // real, by the "give-up chain across two independent boot sweeps" block
    // further down: a second BOOT sweep (a second forked process) is a second
    // tick, without waiting on the interval. See footnote 9 in
    // docs/video-and-sharing.md.
  } finally {
    child3.kill();
    await new Promise((resolve) => branchStub.close(resolve));
    await fs.rm(dataDir3, { recursive: true, force: true });
  }
}

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
  let parkedRes;
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
    parkedRes = res;
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
    await withDeadline(downloadArrived, 10000, 'the sweep never reached collectVideo\'s download leg within 10s');

    const renamed = await fetch(`${base4}/api/projects/alpha/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'beta' }),
    });
    assert.equal(renamed.status, 200, 'the mid-download rename itself must succeed for this test to mean anything');

    // NOW let the download finish.
    parkedRes.writeHead(200, { 'Content-Type': 'video/mp4' });
    parkedRes.end('bytes standing in for a clip');

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

// ---- poll-route collect-to-done coverage (fix round 1, 2026-08-17) ----
// Both callers of collectVideo needed updating for the fix above, but every
// video block in this file up to here drives the boot sweep -- none of them
// call GET /api/video/:id itself, so the poll route's half of the edit shipped
// with no coverage at all. That gap is exactly how a real bug got through:
// `const { savedPath, cost, project }` at that call site shadowed the
// `project` already bound higher up in the route (from req.query, for the
// whole length of the handler), and reading `project || null` a few lines
// above the shadowing declaration threw "Cannot access 'project' before
// initialization" -- but ONLY when `fresh` is falsy, i.e. only when the job
// isn't in the store yet. Every sweep-driven test seeds a store record, so
// none of them ever took that branch. Two sub-tests, sharing one forked
// server and one stub (a fresh fork per case would just be the same
// boilerplate twice): (a) drives the exact no-record branch the shadow bug
// lived in, (b) pins caller 2's actual behavioural edit -- writing the
// project collectVideo resolved instead of the pre-download `job.project`.
{
  const dataDir5 = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-poll-route-'));
  const outDir5 = path.join(dataDir5, 'out');
  // Must exist before the mid-download rename in (b), same reason as the
  // block above: fs.rename needs something on disk to rename.
  await fs.mkdir(path.join(outDir5, 'alpha'), { recursive: true });

  const noRecordJobId = 'poll-no-record-job';
  const heldJobId = 'poll-held-download-job';

  // One status/download stub for both sub-tests, disambiguated by clip path.
  // (a)'s download answers immediately; (b)'s is parked until the test has
  // landed the mid-download rename, then released -- same shape as the block
  // above, just keyed by which job's status check asked for it.
  let pollBase;
  let releasePollDownload;
  let parkedPollRes;
  const pollDownloadArrived = new Promise((resolve) => {
    releasePollDownload = resolve;
  });
  const pollStub = http.createServer((req, res) => {
    if (req.url.startsWith('/api/v1/videos/')) {
      const id = decodeURIComponent(req.url.split('/').pop());
      const clip = id === noRecordJobId ? 'clip-a.mp4' : 'clip-b.mp4';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'completed', unsigned_urls: [`${pollBase}/${clip}`] }));
      return;
    }
    if (req.url === '/clip-a.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end('bytes standing in for a clip, no store record to begin with');
      return;
    }
    // /clip-b.mp4: park it until (b) has landed its rename.
    parkedPollRes = res;
    releasePollDownload();
  });
  await new Promise((resolve) => pollStub.listen(0, '127.0.0.1', resolve));
  pollBase = `http://127.0.0.1:${pollStub.address().port}`;

  const child5 = fork(path.join(here, 'index.js'), {
    env: {
      ...process.env,
      UNFRAMED_DATA_DIR: dataDir5,
      OUTPUT_DIR: outDir5,
      PORT: '0',
      OPENROUTER_API_KEY: 'sk-or-v1-poll-route-0000000000000000000000000000000',
      UNFRAMED_TEST_VIDEOS_STATUS_BASE: `${pollBase}/api/v1/videos`,
    },
    stdio: 'ignore',
  });

  try {
    const ready5 = await waitForMessage(child5, 'ready');
    const base5 = `http://127.0.0.1:${ready5.port}`;

    // (a) No store record at all: jobs.json doesn't exist yet, so `stored` and
    // `fresh` are both undefined and the route builds its own job object from
    // query params -- the exact branch the shadowing bug threw in.
    const pollA = await fetch(`${base5}/api/video/${noRecordJobId}?project=alpha&prompt=no-record`);
    assert.equal(pollA.status, 200, 'a job with no store record collects instead of 502ing on the shadow bug');
    const bodyA = await pollA.json();
    assert.equal(bodyA.status, 'completed', 'the poll route reports the job done in the same response');
    assert.match(bodyA.savedPath, /[\\/]alpha[\\/]/, 'and the clip is written under the project the query param named');

    const jobsAfterA = JSON.parse(await fs.readFile(path.join(outDir5, 'jobs.json'), 'utf8'));
    const recordA = jobsAfterA.find((j) => j.id === noRecordJobId);
    assert.equal(recordA?.status, 'done', 'the poll route persisted a done record for a job the store never had');
    assert.equal(recordA?.project, 'alpha', "and the record's project is what the route actually used");

    // (b) A pending record, renamed mid-download, collected by THIS route --
    // not the sweep. Seeded after 'ready' (not before boot) so the one
    // boot-time sweep -- which already ran, against a store with nothing in
    // it -- can't race this request for the `collecting` lock, and the 30s
    // interval sweep has no chance to fire before this test's own request
    // resolves. That keeps the poll route the sole collector: caller 2's edit
    // is untestable if caller 1 gets there first.
    await fs.writeFile(
      path.join(outDir5, 'jobs.json'),
      JSON.stringify([
        ...jobsAfterA,
        {
          id: heldJobId,
          project: 'alpha',
          params: { prompt: 'renamed mid-download via poll route', model: 'bytedance/seedance-2.0' },
          startedAt: Date.now(),
          status: 'pending',
        },
      ]),
    );

    const pollBPromise = fetch(`${base5}/api/video/${heldJobId}`);

    // Wait until the download for THIS job has started before renaming -- the
    // rename must land inside collectVideo's fetch, not before it, or this
    // proves nothing beyond what the sweep-side block above already does.
    await withDeadline(pollDownloadArrived, 10000, 'the poll route never reached collectVideo\'s download leg within 10s');

    const renamed = await fetch(`${base5}/api/projects/alpha/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'beta' }),
    });
    assert.equal(renamed.status, 200, 'the mid-download rename itself must succeed for this test to mean anything');

    parkedPollRes.writeHead(200, { 'Content-Type': 'video/mp4' });
    parkedPollRes.end('bytes standing in for a clip, collected by the poll route');

    const pollB = await pollBPromise;
    assert.equal(pollB.status, 200, 'the poll route request itself succeeds despite the rename racing it');
    const bodyB = await pollB.json();
    assert.match(bodyB.savedPath, /[\\/]beta[\\/]/, 'the poll route saves under the RENAMED project too');

    const jobsAfterB = JSON.parse(await fs.readFile(path.join(outDir5, 'jobs.json'), 'utf8'));
    const recordB = jobsAfterB.find((j) => j.id === heldJobId);
    assert.equal(recordB?.status, 'done', 'the poll route persisted the held job as done');
    assert.equal(
      recordB?.project,
      'beta',
      "and its project names the folder its savedPath is actually in -- not job.project from the pre-download read",
    );
    const ghostAlpha = await fs.access(path.join(outDir5, 'alpha')).then(() => true, () => false);
    assert.equal(ghostAlpha, false, 'and the pre-rename folder was not recreated as a ghost by this route either');
  } finally {
    child5.kill();
    await new Promise((resolve) => pollStub.close(resolve));
    await fs.rm(dataDir5, { recursive: true, force: true });
  }
}

// ---- the give-up chain across two independent boot sweeps (fix round 2, 2026-08-17) ----
// The sweep-branches block above proves the clock STARTS (stamp-job) and that
// it eventually FIRES (giveup-job), but neither proves the link between them:
// that `if (!job.unreachableSince)` -- the same line that writes the stamp --
// also stops a SECOND and later miss from rewriting it. That link is not a
// nicety, it is load-bearing: `givenUp(job)` is checked BEFORE this write (a
// few lines up: `if (givenUp(job)) { ... }` runs first), so if the guard were
// gone the stamp becomes `Date.now()` on every tick and `now - unreachableSince`
// would never reach 24 hours -- the job would not be given up on LATE, it
// would never be given up on AT ALL, silently, forever `pending`. That is
// exactly the outcome this row's "yes" claims does not happen.
//
// A single process can't observe a second tick without this suite waiting out
// a real 30s interval -- but a second BOOT sweep IS a second tick: footnotes 1
// and 11 on this same row already argue that sweepJobs() at boot is the
// identical function the interval calls, and that a fresh process finding a
// pending job behaves indistinguishably from a restarted one finding it. So:
// fork the real server twice in sequence against the SAME store and compare
// the stamp across the two boot sweeps, rather than one process across two
// ticks.
{
  const dataDir6 = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-give-up-chain-'));
  const outDir6 = path.join(dataDir6, 'out');
  await fs.mkdir(outDir6, { recursive: true });

  const targetId = 'twotick-target-job';
  await fs.writeFile(
    path.join(outDir6, 'jobs.json'),
    JSON.stringify([
      {
        // No unreachableSince yet. Absent from chainResponses below, so every
        // poll -- in EITHER fork -- 404s it, the same shape an id OpenRouter
        // has forgotten produces.
        id: targetId,
        project: '',
        params: { prompt: 'silence across two separate boot sweeps', model: 'bytedance/seedance-2.0' },
        startedAt: Date.now(),
        status: 'pending',
      },
    ]),
  );

  // One stub server, reused by both forks -- chainResponses is mutated between
  // them to add the sentinel's answer (see below), which is fine: it's a plain
  // object this closure reads fresh on every request, not a snapshot taken once.
  const chainResponses = {};
  const chainStub = http.createServer((req, res) => {
    const id = decodeURIComponent(req.url.split('/').pop());
    const body = chainResponses[id];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body || { error: `no stub for ${id}` }));
  });
  await new Promise((resolve) => chainStub.listen(0, '127.0.0.1', resolve));
  const chainStubBase = `http://127.0.0.1:${chainStub.address().port}/api/v1/videos`;

  const forkAgainstChainStore = () =>
    fork(path.join(here, 'index.js'), {
      env: {
        ...process.env,
        UNFRAMED_DATA_DIR: dataDir6,
        OUTPUT_DIR: outDir6,
        PORT: '0',
        OPENROUTER_API_KEY: 'sk-or-v1-give-up-chain-000000000000000000000000000',
        UNFRAMED_TEST_VIDEOS_STATUS_BASE: chainStubBase,
      },
      stdio: 'ignore',
    });

  let stampAfterTick1;
  try {
    // ---- tick 1: the first boot sweep stamps the first missed poll ----
    const child6a = forkAgainstChainStore();
    try {
      await waitForMessage(child6a, 'ready');
      const deadline1 = Date.now() + 10000;
      let jobsAfterTick1;
      while (Date.now() < deadline1) {
        jobsAfterTick1 = JSON.parse(await fs.readFile(path.join(outDir6, 'jobs.json'), 'utf8').catch(() => '[]'));
        const target = jobsAfterTick1.find((j) => j.id === targetId);
        if (Number.isFinite(target?.unreachableSince)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const targetAfterTick1 = jobsAfterTick1.find((j) => j.id === targetId);
      assert.ok(
        Number.isFinite(targetAfterTick1?.unreachableSince),
        'setup: the first boot sweep must stamp the first missed poll before this test can mean anything',
      );
      stampAfterTick1 = targetAfterTick1.unreachableSince;
    } finally {
      // Killed before its own 30s interval could ever fire, so this fork's
      // entire contribution to jobs.json is exactly ONE boot-time sweep tick --
      // never a second, in-process one that would confound tick 2 below.
      child6a.kill();
    }

    // Add the sentinel strictly BETWEEN the two forks: tick 1's snapshot was
    // taken before this write exists on disk, so tick 1 could not have touched
    // it under any timing, and it is not yet answered by the stub either (added
    // to chainResponses in the same step). Its only route to `failed` is a
    // sweep tick that reads the store fresh and polls it -- which is exactly
    // what tick 2, and only tick 2, can do.
    const sentinelId = 'twotick-sentinel-job';
    chainResponses[sentinelId] = { status: 'expired', error: 'Job exceeded maximum time to live' };
    const jobsBeforeTick2 = JSON.parse(await fs.readFile(path.join(outDir6, 'jobs.json'), 'utf8'));
    await fs.writeFile(
      path.join(outDir6, 'jobs.json'),
      JSON.stringify([
        ...jobsBeforeTick2,
        {
          id: sentinelId,
          project: '',
          params: { prompt: 'exists only to prove the second boot sweep actually ran', model: 'bytedance/seedance-2.0' },
          startedAt: Date.now(),
          status: 'pending',
        },
      ]),
    );

    // ---- tick 2: a SECOND, independent boot sweep against the SAME store ----
    const child6b = forkAgainstChainStore();
    try {
      await waitForMessage(child6b, 'ready');
      const deadline2 = Date.now() + 10000;
      let jobsAfterTick2;
      while (Date.now() < deadline2) {
        jobsAfterTick2 = JSON.parse(await fs.readFile(path.join(outDir6, 'jobs.json'), 'utf8').catch(() => '[]'));
        const sentinel = jobsAfterTick2.find((j) => j.id === sentinelId);
        if (sentinel?.status === 'failed') break;
        await new Promise((r) => setTimeout(r, 100));
      }

      // The one way this whole block could lie: "the stamp is unchanged"
      // is exactly what a NO-OP second tick would also produce. This is the
      // positive evidence that tick 2 actually read the store and polled it --
      // proof independent of, and unconnected to, the assertion below.
      const sentinelAfterTick2 = jobsAfterTick2.find((j) => j.id === sentinelId);
      assert.equal(
        sentinelAfterTick2?.status,
        'failed',
        'the sentinel resolving is what proves the second boot sweep actually ran -- not an assumption',
      );

      // THE assertion this block exists for. Same job, same store, two
      // completely separate processes' boot sweeps apart: if the guard on
      // server/index.js's `if (!job.unreachableSince) await persistJob(...)`
      // line is doing its job, nothing in tick 2 ever touches this record at
      // all (the condition is false, so persistJob is never even called for
      // it) and the value carries over byte-for-byte. If the guard is gone,
      // this is where that shows up: a later, DIFFERENT timestamp, and a job
      // whose 24h clock would then never reach 24 hours no matter how long
      // this ran for real.
      const targetAfterTick2 = jobsAfterTick2.find((j) => j.id === targetId);
      assert.equal(
        targetAfterTick2?.unreachableSince,
        stampAfterTick1,
        'a second miss must not move the stamp forward -- only the FIRST one may ever write it',
      );
    } finally {
      child6b.kill();
    }
  } finally {
    await new Promise((resolve) => chainStub.close(resolve));
    await fs.rm(dataDir6, { recursive: true, force: true });
  }
}

// ---- reveal standalone: an IPC channel is not proof of the shell (2026-08-17) ----
// `npm run server` is `node --watch`, and watch mode runs the app in a child of
// its own WITH an IPC channel, so `process.send` is a function in ordinary
// development. Gating the hosted branch on `process.send` alone therefore fired
// the reveal message at Node's file watcher -- which drops messages it doesn't
// know -- while the route still answered 200, so the client had no error to
// report and Finder simply never opened. Every other hosted behaviour is gated
// on an env var unset in a clone (docs/releases.md's first invariant); this one
// was gated on ambient plumbing instead, and that is the whole bug.
//
// So this fork is the dev setup: the channel, without the marker the shell sets
// (`UNFRAMED_CLIENT_DIST`). It keeps UNFRAMED_DATA_DIR, because that is what
// points `.env` at a temp dir -- a fork without it reads the REAL .env, whose
// `override: true` would hand this test the real output folder, the real key and
// port 8787. Which is also why the hosted gate cannot be UNFRAMED_DATA_DIR: no
// test could then take the standalone branch safely at all.
//
// The platform's opener is shimmed onto PATH so the assertion can see which
// branch ran without a real Finder window opening mid-suite. Skipped on Windows,
// where the branch spawns `explorer` and a POSIX shim would not stand in for it.
if (process.platform !== 'win32') {
  const revealHome = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-reveal-'));
  const outDir7 = path.join(revealHome, 'out');
  const binDir = path.join(revealHome, 'bin');
  const marker = path.join(revealHome, 'spawned.txt');
  await fs.mkdir(outDir7);
  await fs.mkdir(binDir);
  await fs.writeFile(path.join(outDir7, 'shot.png'), 'x');

  const opener = process.platform === 'darwin' ? 'osascript' : 'xdg-open';
  await fs.writeFile(
    path.join(binDir, opener),
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(marker)}\n`,
    { mode: 0o755 },
  );

  // Deleted rather than merely left out of the spread: `fork` inherits this
  // shell's environment, so on a machine that happens to export the marker this
  // block would take the hosted branch and quietly assert nothing.
  const standaloneEnv = {
    ...process.env,
    UNFRAMED_DATA_DIR: revealHome,
    OUTPUT_DIR: outDir7,
    PORT: '0',
    PATH: `${binDir}:${process.env.PATH}`,
    OPENROUTER_API_KEY: 'sk-or-v1-1111111111111111111111111111111111111111111111111111',
  };
  delete standaloneEnv.UNFRAMED_CLIENT_DIST;

  const child7 = fork(path.join(here, 'index.js'), { env: standaloneEnv, stdio: 'ignore' });

  try {
    const ready7 = await waitForMessage(child7, 'ready');
    let hostedMessage = null;
    child7.on('message', (m) => {
      if (m?.type === 'reveal') hostedMessage = m;
    });

    const res7 = await fetch(`http://127.0.0.1:${ready7.port}/api/reveal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'shot.png' }),
    });
    assert.equal(res7.status, 200, 'the route answers either way -- which is why this failed silently');

    // The spawn is detached and fire-and-forget, so the shim's marker file is
    // the only evidence it ran. Polled with a deadline rather than slept on:
    // bounded, so a regression fails loudly instead of hanging `npm test`.
    const deadline7 = Date.now() + 5000;
    let spawned = '';
    while (Date.now() < deadline7) {
      spawned = await fs.readFile(marker, 'utf8').catch(() => '');
      if (spawned) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    // What "revealed" MEANS is per-platform, and index.js says so: only Finder can
    // select a file, so the Linux branch opens the containing folder by design.
    // Asserting shot.png everywhere made this pass on a maintainer's Mac and fail
    // on any Linux clone -- the assertion was the bug, not the route.
    const revealTarget = process.platform === 'darwin' ? 'shot.png' : outDir7;
    assert.ok(
      spawned.includes(revealTarget),
      `with no shell marker, reveal must drive ${opener} on ${revealTarget} -- not post a message nobody reads (got ${JSON.stringify(spawned)})`,
    );
    assert.equal(
      hostedMessage,
      null,
      'and it must not take the hosted branch: node --watch hands every developer that same channel',
    );
  } finally {
    child7.kill();
    await fs.rm(revealHome, { recursive: true, force: true });
  }
}

console.log('host.test.js: ok');
