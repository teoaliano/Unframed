import crypto from 'node:crypto';

// OpenRouter's browser flow, which is NOT RFC 6749: the parameter is
// `callback_url` rather than `redirect_uri`, and there is no `state`. The nonce
// below substitutes for state -- the callback is a top-level browser navigation,
// which CORS does not protect, so an unguessable single-use value is what makes a
// hostile local page's navigation pointless.
//
// The `code_verifier` never leaves this process, and OpenRouter really does refuse
// an exchange without it (probed 2026-08-20, recorded in
// docs/research/2026-08-19-openrouter-oauth.md). That is what lets the code travel
// back through a public web page: a code in that host's logs cannot be redeemed.
//
// It does NOT make the bounce page harmless. A page that learns the CHALLENGE can
// approve it against its OWN OpenRouter account and hand this engine a code that
// redeems correctly, leaving the user's .env holding someone else's key -- and the
// nonce cannot stop that, since the bounce page knows the nonce by design and always
// navigates first. What prevents it is the challenge never reaching the bounce
// origin, which rests on the browser's default referrer policy on OpenRouter's
// redirect. Anything that would put the challenge in the bounce page's reach --
// forwarding it, logging it there, third-party script on that page -- breaks this.
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

// The states an attempt moves through: 'waiting' until the callback commits to
// writing the key, 'committed' for the brief window while that write is in flight,
// then the terminal 'done' or 'failed'. 'committed' exists for exactly one reader,
// cancel(): it has to undo a key the callback already began writing, and must NOT
// touch a pre-existing key when the attempt never got that far.
const WAITING = 'waiting';
const COMMITTED = 'committed';
const DONE = 'done';
const FAILED = 'failed';
const terminal = (s) => s === DONE || s === FAILED;

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
// and a no-op once terminal, so a replayed callback cannot rewrite a success into a
// failure. Transitions from 'waiting' (the pre-commit failure branches) or from
// 'committed' (after the write succeeds or fails).
export function resolve(nonce, state, reason = '') {
  if (!current(nonce) || terminal(attempt.state)) return;
  attempt.state = state;
  attempt.reason = reason;
  attempt.verifier = null;
}

// What the app polls. Deliberately returns the state and a sentence and NOTHING
// else: the verifier and the key must never leave this process, and this is the
// one function whose output is shaped for a client to read. null means there is
// nothing in flight and nothing to report.
export function peek(now = Date.now()) {
  if (!attempt) return null;
  if (attempt.state === WAITING && attempt.expiresAt <= now) {
    return { state: FAILED, reason: 'Nothing came back from OpenRouter. Try connecting again.' };
  }
  // 'committed' is the in-flight write; to the client that is still waiting, and it
  // becomes 'done' or 'failed' the moment the write settles.
  const state = attempt.state === COMMITTED ? WAITING : attempt.state;
  return { state, reason: attempt.reason };
}

// The gate between claiming the verifier and writing the key. Returns true only if
// this nonce is still the live attempt AND it has not expired while the exchange
// was out on the network -- the expiry check the old `isCurrent` lacked, which let
// a write land for an attempt `peek` had already reported expired. Marks the
// attempt 'committed' in the same synchronous call, so a cancel arriving afterwards
// can tell a key write is in flight and undo it. Must be called synchronously
// before writeEnv, with no await between the answer and the write.
export function commit(nonce, now = Date.now()) {
  if (!current(nonce) || attempt.state !== WAITING) return false;
  if (attempt.expiresAt <= now) {
    attempt.state = FAILED;
    attempt.reason = 'That took too long \u2014 the approval expired. Try connecting again.';
    return false;
  }
  attempt.state = COMMITTED;
  return true;
}

// Drops the attempt, and reports whether a key write for it had already committed.
// A committed or done attempt means the callback has put, or is putting, a key on
// disk -- so DELETE /api/oauth/pending has to null it, the way DELETE /api/key
// does, or Cancel leaves a live key the app reports as absent. A 'waiting' attempt
// wrote nothing, so cancelling it must NOT touch a pre-existing key.
export function cancel() {
  const undoNeeded = Boolean(attempt) && (attempt.state === COMMITTED || attempt.state === DONE);
  attempt = null;
  return undoNeeded;
}
