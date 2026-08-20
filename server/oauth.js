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

// At most one attempt, and the variable says so rather than a comment: a Map
// keyed by nonce had exactly one entry by construction -- `start` cleared it
// first and `peek` returned inside its first iteration -- so "exactly one live
// attempt" was a runtime invariant three functions had to keep. A single binding
// makes it unbreakable instead of asserted. The nonce moves into the record,
// which is what still refuses a callback for an attempt that is no longer the
// current one.
//
// In memory, not on disk. A restart mid-flow is a flow the user retries, and
// unlike jobs.json there is no paid work in flight -- so persisting a
// code_verifier would solve a problem nobody has.
//
// The record OUTLIVES the exchange, which it did not use to. The callback lands
// in a browser tab, so every one of its outcomes -- success, an unknown nonce, a
// refused code, a key we could not save -- is reported to a tab the user may well
// have stopped looking at, while the app itself had no way to learn any of it. It
// watched /api/health for a changed key hint, which only ever detects success, so
// a failed attempt left the app claiming to be waiting for a flow that was
// already dead. Keeping the record is what lets `peek` answer "what happened".
let attempt = null; // { nonce, verifier, expiresAt, state, reason }

// What `peek` reports. 'waiting' is the only non-terminal one, and the first
// terminal outcome to arrive is the one that sticks.
const WAITING = 'waiting';

// True only for the attempt currently in flight. Every entry point takes a nonce
// and asks this first, so a callback or a poll naming a superseded, cancelled or
// never-issued attempt is refused by the same test rather than by three.
const current = (nonce) => Boolean(attempt) && attempt.nonce === nonce;

export function start(now = Date.now()) {
  const verifier = b64url(crypto.randomBytes(32)); // 43 chars, PKCE's range
  const nonce = crypto.randomBytes(16).toString('hex'); // 128-bit, alphanumeric
  // Assignment, not insertion: two clicks on Connect cannot leave two live.
  attempt = { nonce, verifier, expiresAt: now + PENDING_TTL_MS, state: WAITING, reason: '' };
  return { nonce, challenge: challengeFrom(verifier) };
}

// Hands the verifier out exactly ONCE, which is the invariant this module exists
// for: a nonce claimable twice is a replayable callback, and nothing about that is
// visible from outside. The verifier is dropped here rather than the whole record,
// so a replay finds nothing to exchange while the outcome of the first attempt
// survives for `peek`. An expired attempt is failed rather than merely refused --
// otherwise the app waits out the full ten minutes for a code that is already
// dead.
export function claim(nonce, now = Date.now()) {
  if (!current(nonce) || attempt.verifier === null) return null;
  const { verifier } = attempt;
  attempt.verifier = null;
  if (attempt.expiresAt <= now) {
    attempt.state = 'failed';
    attempt.reason = 'That took too long \u2014 the approval expired. Try connecting again.';
    return null;
  }
  return verifier;
}

// Records how an attempt ended. A no-op for a nonce that is not the current
// attempt, so a stranger guessing at the callback cannot fail a legitimate one,
// and a no-op once an outcome is already recorded, so a replayed callback cannot
// rewrite a success into a failure. Returns whether it actually recorded, because
// the callback needs to know: it is the one caller that must not persist a key for
// an attempt someone cancelled while the exchange was in flight.
export function resolve(nonce, state, reason = '') {
  if (!current(nonce) || attempt.state !== WAITING) return false;
  attempt.state = state;
  attempt.reason = reason;
  attempt.verifier = null;
  return true;
}

// What the app polls. Deliberately returns the state and a sentence and NOTHING
// else: the verifier and the key must never leave this process, and this is the
// one function whose output is shaped for a client to read. null means there is
// nothing in flight and nothing to report.
export function peek(now = Date.now()) {
  if (!attempt) return null;
  if (attempt.state === WAITING && attempt.expiresAt <= now) {
    return { state: 'failed', reason: 'Nothing came back from OpenRouter. Try connecting again.' };
  }
  return { state: attempt.state, reason: attempt.reason };
}

// Whether `nonce` still names the attempt in flight, and it has not already
// ended. The callback asks between claiming the verifier and writing the key,
// which is the one window `cancel` cannot reach on its own: cancelling empties
// this module, and this module is not what the write path reads. It has to be
// asked SYNCHRONOUSLY, with no await between the answer and the act, or the
// answer is stale by the time anything uses it.
export const isCurrent = (nonce) => current(nonce) && attempt.state === WAITING;

export function cancel() {
  attempt = null;
}
