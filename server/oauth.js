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
