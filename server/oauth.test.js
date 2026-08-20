// node server/oauth.test.js  (also runs as part of `npm test`)
import assert from 'node:assert/strict';
import {
  challengeFrom,
  authorizeUrl,
  callbackUrl,
  start,
  claim,
  resolve,
  peek,
  cancel,
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

// The round trip, which is the half nothing else can check: the bounce page that
// parses `<port>-<nonce>` lives in another repo and has not been written, so this
// producer currently has no consumer to catch a mismatch. Doing here what that
// page must do -- parse the segment, rebuild the loopback URL from a template,
// never from anything in the path -- pins the format on this side, so the two
// ends cannot drift apart before the page exists.
{
  const bounced = callbackUrl({ port: 51423, nonce: 'a'.repeat(32), bounce: 'https://example.com/connect' });
  const segment = new URL(bounced).pathname.split('/').pop();
  // The page's own validation: digits in the ephemeral range, then a fixed-length
  // hex nonce. Anything else it must refuse rather than redirect, or it is an open
  // redirect on the domain that serves the installers.
  const parsed = /^(\d{4,5})-([0-9a-f]{32})$/.exec(segment);
  assert.ok(parsed, 'the segment is parseable by a plain character class');
  const [, port, nonce] = parsed;
  assert.ok(Number(port) >= 1024 && Number(port) <= 65535, 'the port is in range');
  assert.equal(
    `http://127.0.0.1:${port}/api/oauth/callback/${nonce}`,
    callbackUrl({ port: Number(port), nonce }),
    'rebuilding from the template reaches the same URL direct loopback would',
  );
}

// The nonce is 128 bits and alphanumeric, so the bounce page can validate it
// with a plain character class.
cancel();
const first = start();
assert.match(first.nonce, /^[0-9a-f]{32}$/);
assert.equal(typeof first.challenge, 'string');

// Starting again supersedes: two clicks on Connect leave exactly one live
// attempt, and the abandoned one cannot be completed.
// Superseding is structural now -- `attempt` is a single binding, so two live
// attempts cannot exist to be counted. What still needs asserting is the half that
// is not free: the abandoned nonce must be refused rather than merely forgotten.
const second = start();
assert.equal(claim(first.nonce), null, 'the superseded attempt is dead');

// claim succeeds exactly once. A nonce that can be claimed twice is a
// replayable callback, and nothing about that is visible from outside.
const verifier = claim(second.nonce);
assert.equal(typeof verifier, 'string');
assert.equal(challengeFrom(verifier), second.challenge, 'the stored verifier matches the challenge sent');
assert.equal(claim(second.nonce), null, 'the second claim fails');
// The record SURVIVES the claim now -- only the verifier is dropped. It used to be
// deleted outright, and this assertion pinned that; the record is what lets the
// app be told how the attempt ended, rather than only ever detecting success.
assert.notEqual(peek(), null, 'the record outlives the claim');

// An unknown nonce is refused rather than throwing.
assert.equal(claim('deadbeef'), null);

// Expiry, driven by an injected clock -- OpenRouter's codes live 10 minutes, and
// an attempt must not outlive the code it is waiting for.
const third = start();
assert.equal(claim(third.nonce, Date.now() + PENDING_TTL_MS + 1), null, 'expired');
// Left behind deliberately, as a failed record rather than as a live attempt: the
// app has to be able to learn that the code expired instead of waiting out the
// full ten minutes for one that is already dead. start() and cancel() clear it.
assert.notEqual(peek(), null, 'kept, but not as something claimable');
assert.equal(claim(third.nonce), null, 'and it stays unclaimable');

// Cancel drops the attempt, so an approval that arrives after the user pressed
// Cancel is refused instead of silently writing a key.
const fourth = start();
cancel();
assert.equal(claim(fourth.nonce), null);

// --- the outcome record ---------------------------------------------------
// The app polls `peek` instead of watching /api/health for a changed key hint,
// which only ever detected success. Everything below is about the failures it
// could not see, and about `peek` never handing out anything it must not.

cancel();
assert.equal(peek(), null, 'nothing in flight, nothing to report');

// A live attempt reads as waiting, and carries no key material of any kind.
const live = start();
assert.deepEqual(peek(), { state: 'waiting', reason: '' });
assert.equal(JSON.stringify(peek()).includes(claim(live.nonce)), false, 'the verifier is not in what a client reads');

// claim() took the verifier just above, so a replay gets nothing -- but the
// record survives, which is the change that makes an outcome reportable.
assert.equal(claim(live.nonce), null, 'the verifier is handed out exactly once');
assert.notEqual(peek(), null, 'and the record is still there to hold the outcome');

assert.equal(resolve(live.nonce, 'done'), true, 'recording an outcome reports success');
assert.deepEqual(peek(), { state: 'done', reason: '' });

// The first outcome wins. A replayed callback must not rewrite a success into a
// failure, or approving twice would report the flow as broken.
assert.equal(resolve(live.nonce, 'failed', 'a later attempt'), false, 'a second outcome is refused');
assert.deepEqual(peek(), { state: 'done', reason: '' }, 'and does not overwrite the first');

// A nonce this process never issued cannot touch anything, so a stranger dialling
// the callback with a guess cannot fail an attempt the user is waiting on.
cancel();
const mine = start();
assert.equal(resolve('f'.repeat(32), 'failed', 'not yours'), false, 'a stranger records nothing');
assert.deepEqual(peek(), { state: 'waiting', reason: '' }, 'an unknown nonce resolves nothing');

// A failure is reported with its reason rather than leaving the app waiting.
resolve(mine.nonce, 'failed', 'OpenRouter refused the code.');
assert.deepEqual(peek(), { state: 'failed', reason: 'OpenRouter refused the code.' });

// An expired attempt fails on its own, both ways in. Through claim, because that
// is the callback arriving too late; through peek, because that is the app asking
// while no callback ever came. Neither may sit at 'waiting' forever.
cancel();
const stale = start();
const afterTtl = Date.now() + PENDING_TTL_MS + 1;
assert.match(peek(afterTtl).reason, /Nothing came back/);
assert.equal(peek(afterTtl).state, 'failed');
assert.equal(claim(stale.nonce, afterTtl), null, 'and the code cannot be exchanged');
assert.match(peek().reason, /took too long/, 'claim records why, not just that');

// Cancel still wipes everything, including a recorded outcome, so Remove key and
// Cancel both leave nothing for a later poll to find.
cancel();
assert.equal(peek(), null);

console.log('oauth.test.js: ok');
