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
