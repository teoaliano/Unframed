/**
 * The OpenRouter connect flow's pure half (spec 10): PKCE ids and challenge, the authorize
 * and callback URL builders, and the one pending attempt. Time and randomness come in as
 * parameters, so the engine owns the clock and the random source.
 */

/** Answers `size` random bytes. */
export type RandomBytes = (size: number) => Uint8Array;

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const base64url = (bytes: Uint8Array): string => {
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at]!;
    const b = bytes[at + 1];
    const c = bytes[at + 2];
    out += BASE64URL[a >> 2]!;
    out += BASE64URL[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += BASE64URL[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += BASE64URL[c & 63]!;
  }
  return out;
};

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 (FIPS 180-4). The domain has no I/O and no crypto module, so it carries its own. */
const sha256 = (message: Uint8Array): Uint8Array => {
  const bitLength = message.length * 8;
  const padded = new Uint8Array((((message.length + 9 + 63) >> 6) << 6));
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const hash = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < padded.length; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(block + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as unknown as [number, number, number, number, number, number, number, number];
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t]! + w[t]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  hash.forEach((word, index) => outView.setUint32(index * 4, word));
  return out;
};

/** A fresh verifier (32 random bytes, unpadded base64url, 43 characters) and nonce (16 random bytes, lowercase hex). */
export const pkceIds = (random: RandomBytes): { readonly verifier: string; readonly nonce: string } => {
  const verifier = base64url(random(32));
  const nonce = hex(random(16));
  return { verifier, nonce };
};

/** The S256 challenge: unpadded base64url of the SHA-256 of the verifier. */
export const pkceChallenge = (verifier: string): string => base64url(sha256(new TextEncoder().encode(verifier)));

/**
 * OpenRouter's consent page. Not RFC 6749: the parameter is `callback_url`, there is no
 * `state`, and the method must be echoed on the exchange or it answers 400.
 */
export const authorizeUrl = (origin: string, callback: string, challenge: string): string =>
  `${origin}/auth?${new URLSearchParams({ callback_url: callback, code_challenge: challenge, code_challenge_method: "S256" }).toString()}`;

/** OpenRouter's codes live ten minutes; an attempt lives as long. */
export const OAUTH_ATTEMPT_MS = 10 * 60_000;
export const OAUTH_TOOK_TOO_LONG = "That took too long. The approval expired. Try connecting again.";
export const OAUTH_NOTHING_CAME_BACK = "Nothing came back from OpenRouter. Try connecting again.";

export type OAuthAttemptState = "waiting" | "done" | "failed";

/** What the web may learn about the attempt: never its nonce, verifier or key. */
export interface OAuthAttemptView {
  readonly state: OAuthAttemptState;
  /** `''` unless failed. */
  readonly reason: string;
}

/**
 * The one pending connection attempt, held in memory only. A restart mid-flow is a flow
 * the person retries.
 */
export interface OAuthAttempts {
  /** Replaces any attempt, so two clicks leave one live. */
  readonly start: (now: number) => { readonly nonce: string; readonly challenge: string };
  /** The verifier, exactly once, for the current unexpired attempt only; otherwise null. */
  readonly claim: (nonce: string, now: number) => string | null;
  /**
   * True only for the current unexpired `waiting` attempt, which becomes `committed`. The
   * caller must start its key write with no asynchronous step after this answers, or a
   * cancel could land in between and still see a waiting attempt.
   */
  readonly commit: (nonce: string, now: number) => boolean;
  /** Records the outcome. A no-op for a nonce that is not current and once the outcome is recorded. */
  readonly resolve: (nonce: string, state: "done" | "failed", reason?: string) => void;
  readonly peek: (now: number) => OAuthAttemptView | null;
  /** Clears the slot. True when a key write for the attempt is in flight or landed. */
  readonly cancel: () => boolean;
}

interface Attempt {
  readonly nonce: string;
  verifier: string | null;
  readonly expiresAt: number;
  state: "waiting" | "committed" | "done" | "failed";
  reason: string;
}

export const createOAuthAttempts = (random: RandomBytes): OAuthAttempts => {
  let slot: Attempt | undefined;

  const current = (nonce: string) => (slot !== undefined && slot.nonce === nonce ? slot : undefined);

  const expire = (attempt: Attempt) => {
    attempt.state = "failed";
    attempt.reason = OAUTH_TOOK_TOO_LONG;
    attempt.verifier = null;
  };

  return {
    start: (now) => {
      const { verifier, nonce } = pkceIds(random);
      slot = { nonce, verifier, expiresAt: now + OAUTH_ATTEMPT_MS, state: "waiting", reason: "" };
      return { nonce, challenge: pkceChallenge(verifier) };
    },
    claim: (nonce, now) => {
      const attempt = current(nonce);
      if (attempt === undefined || attempt.state !== "waiting") return null;
      if (now >= attempt.expiresAt) {
        expire(attempt);
        return null;
      }
      const verifier = attempt.verifier;
      attempt.verifier = null;
      return verifier;
    },
    commit: (nonce, now) => {
      const attempt = current(nonce);
      if (attempt === undefined || attempt.state !== "waiting") return false;
      if (now >= attempt.expiresAt) {
        expire(attempt);
        return false;
      }
      attempt.state = "committed";
      return true;
    },
    resolve: (nonce, state, reason = "") => {
      const attempt = current(nonce);
      if (attempt === undefined || attempt.state === "done" || attempt.state === "failed") return;
      attempt.state = state;
      attempt.reason = state === "failed" ? reason : "";
      attempt.verifier = null;
    },
    peek: (now) => {
      if (slot === undefined) return null;
      if (slot.state === "waiting" && now >= slot.expiresAt) return { state: "failed", reason: OAUTH_NOTHING_CAME_BACK };
      if (slot.state === "committed") return { state: "waiting", reason: "" };
      return { state: slot.state, reason: slot.state === "failed" ? slot.reason : "" };
    },
    cancel: () => {
      const wrote = slot?.state === "committed" || slot?.state === "done";
      slot = undefined;
      return wrote;
    },
  };
};

/**
 * Where OpenRouter sends the person back. Through a bounce page, the port and nonce travel
 * in the path, because OpenRouter appends `?code=` and may not keep a query it was given.
 */
export const callbackUrl = (options: { readonly port: number; readonly nonce: string; readonly bounce?: string | undefined }): string =>
  options.bounce === undefined
    ? `http://127.0.0.1:${options.port}/api/oauth/callback/${options.nonce}`
    : `${options.bounce.replace(/\/+$/, "")}/${options.port}-${options.nonce}`;
