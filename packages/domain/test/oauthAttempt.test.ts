import { describe, expect, it } from "vitest";
import { authorizeUrl, callbackUrl, createOAuthAttempts, pkceChallenge, pkceIds } from "../src/index.ts";

/** RFC 7636, appendix B: the 32 octets, the verifier they encode to and its S256 challenge. */
const RFC_OCTETS = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121];
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

/** Random bytes that hand out the RFC's octets first, then counting bytes. */
const scripted = (...chunks: number[][]) => {
  const queue = [...chunks];
  return (size: number) => {
    const next = queue.shift();
    return Uint8Array.from(next ?? Array.from({ length: size }, (_, index) => index));
  };
};

describe("PKCE", () => {
  it("encodes 32 random bytes as the 43-character unpadded base64url verifier and 16 as a 32-character hex nonce", () => {
    const ids = pkceIds(scripted(RFC_OCTETS, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 255]));
    expect(ids.verifier).toBe(RFC_VERIFIER);
    expect(ids.verifier).toHaveLength(43);
    expect(ids.nonce).toBe("000102030405060708090a0b0c0d0eff");
    expect(ids.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("asks for exactly 32 bytes for the verifier and 16 for the nonce", () => {
    const sizes: number[] = [];
    pkceIds((size) => {
      sizes.push(size);
      return new Uint8Array(size);
    });
    expect(sizes).toEqual([32, 16]);
  });

  it("derives the challenge as unpadded base64url of the verifier's SHA-256, matching RFC 7636", () => {
    expect(pkceChallenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it("hashes inputs longer than one SHA-256 block", () => {
    // SHA-256 of 1000 "a"s, as node:crypto computes it.
    expect(pkceChallenge("a".repeat(1000))).toBe("Qe3s5C1j6Nm_UVqbppMuHCDLyfWl0TRkWttdsblzfqM");
    expect(pkceChallenge("")).toBe("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
  });
});

describe("the authorize URL", () => {
  it("carries callback_url, code_challenge and code_challenge_method=S256 on openrouter.ai, encoded", () => {
    const url = authorizeUrl("https://openrouter.ai", "http://127.0.0.1:5123/api/oauth/callback/abc", RFC_CHALLENGE);
    expect(url).toBe(
      `https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A5123%2Fapi%2Foauth%2Fcallback%2Fabc&code_challenge=${RFC_CHALLENGE}&code_challenge_method=S256`,
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("callback_url")).toBe("http://127.0.0.1:5123/api/oauth/callback/abc");
    expect(parsed.searchParams.has("state")).toBe(false);
    expect(parsed.searchParams.has("redirect_uri")).toBe(false);
  });

  it("uses the test origin when one is given", () => {
    const url = new URL(authorizeUrl("http://127.0.0.1:9", "https://unframed.example/oauth/1-2?x=y", "c h&a"));
    expect(url.origin).toBe("http://127.0.0.1:9");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("callback_url")).toBe("https://unframed.example/oauth/1-2?x=y");
    expect(url.searchParams.get("code_challenge")).toBe("c h&a");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("the callback URL", () => {
  const nonce = "0123456789abcdef0123456789abcdef";

  it("points straight at the engine's loopback route without a bounce", () => {
    expect(callbackUrl({ port: 5123, nonce })).toBe(`http://127.0.0.1:5123/api/oauth/callback/${nonce}`);
    expect(callbackUrl({ port: 5123, nonce, bounce: undefined })).toBe(`http://127.0.0.1:5123/api/oauth/callback/${nonce}`);
  });

  it("puts the port and nonce in the bounce page's path, with its trailing slashes removed", () => {
    expect(callbackUrl({ port: 5123, nonce, bounce: "https://unframed.example/connect" })).toBe(`https://unframed.example/connect/5123-${nonce}`);
    expect(callbackUrl({ port: 5123, nonce, bounce: "https://unframed.example/connect///" })).toBe(`https://unframed.example/connect/5123-${nonce}`);
  });
});

const MINUTE = 60_000;
const TOOK_TOO_LONG = "That took too long. The approval expired. Try connecting again.";
const NOTHING_CAME_BACK = "Nothing came back from OpenRouter. Try connecting again.";

/** An attempt store whose random bytes count up, so each attempt's ids differ and are known. */
const attempts = () => {
  let seed = 0;
  return createOAuthAttempts((size) => {
    seed++;
    return Uint8Array.from({ length: size }, (_, index) => (seed * 31 + index) % 256);
  });
};

describe("the attempt store: start and claim", () => {
  it("starts an attempt with a fresh nonce and the challenge of the verifier that claim later hands out", () => {
    const store = attempts();
    const { nonce, challenge } = store.start(0);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    const verifier = store.claim(nonce, 1);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceChallenge(verifier!)).toBe(challenge);
  });

  it("hands out the verifier once: a replay gets null", () => {
    const store = attempts();
    const { nonce } = store.start(0);
    expect(store.claim(nonce, 1)).not.toBeNull();
    expect(store.claim(nonce, 2)).toBeNull();
  });

  it("gives a nonce nobody was issued null", () => {
    const store = attempts();
    store.start(0);
    expect(store.claim("0123456789abcdef0123456789abcdef", 1)).toBeNull();
    expect(attempts().claim("0123456789abcdef0123456789abcdef", 1)).toBeNull();
  });

  it("supersedes the previous attempt, so only the latest nonce can be claimed", () => {
    const store = attempts();
    const first = store.start(0);
    const second = store.start(1);
    expect(second.nonce).not.toBe(first.nonce);
    expect(store.claim(first.nonce, 2)).toBeNull();
    expect(store.claim(second.nonce, 2)).not.toBeNull();
  });

  it("fails an expired attempt at claim with the took-too-long reason", () => {
    const store = attempts();
    const { nonce } = store.start(0);
    expect(store.claim(nonce, 10 * MINUTE)).toBeNull();
    expect(store.peek(10 * MINUTE)).toEqual({ state: "failed", reason: TOOK_TOO_LONG });
    expect(store.claim(nonce, 10 * MINUTE + 1)).toBeNull();
  });

  it("still claims one millisecond before the ten minutes are up", () => {
    const store = attempts();
    const { nonce } = store.start(0);
    expect(store.claim(nonce, 10 * MINUTE - 1)).not.toBeNull();
  });
});

describe("the attempt store: peek", () => {
  it("answers null with no attempt", () => {
    expect(attempts().peek(0)).toBeNull();
  });

  it("reads a fresh attempt as waiting with no reason", () => {
    const store = attempts();
    store.start(0);
    expect(store.peek(5 * MINUTE)).toEqual({ state: "waiting", reason: "" });
  });

  it("reads a waiting attempt past its expiry as failed with nothing came back", () => {
    const store = attempts();
    store.start(0);
    expect(store.peek(10 * MINUTE)).toEqual({ state: "failed", reason: NOTHING_CAME_BACK });
  });

  it("reads a committed attempt as waiting, even past its expiry", () => {
    const store = attempts();
    const { nonce } = store.start(0);
    store.claim(nonce, 1);
    expect(store.commit(nonce, 2)).toBe(true);
    expect(store.peek(3)).toEqual({ state: "waiting", reason: "" });
    expect(store.peek(11 * MINUTE)).toEqual({ state: "waiting", reason: "" });
  });

  it("reads done and failed with their reasons, and never exposes the verifier or nonce", () => {
    const store = attempts();
    const { nonce, challenge } = store.start(0);
    const verifier = store.claim(nonce, 1)!;
    store.resolve(nonce, "failed", "OpenRouter did not send a code");
    const failed = store.peek(2);
    expect(failed).toEqual({ state: "failed", reason: "OpenRouter did not send a code" });
    expect(JSON.stringify(failed)).not.toContain(verifier);
    expect(JSON.stringify(failed)).not.toContain(nonce);
    expect(JSON.stringify(failed)).not.toContain(challenge);

    const again = store.start(3);
    store.claim(again.nonce, 4);
    store.commit(again.nonce, 5);
    store.resolve(again.nonce, "done");
    expect(store.peek(6)).toEqual({ state: "done", reason: "" });
    expect(Object.keys(store.peek(6)!).sort()).toEqual(["reason", "state"]);
  });
});

describe("the attempt store: commit, resolve and cancel", () => {
  it("commits only the current, unexpired, waiting attempt, once", () => {
    const store = attempts();
    const first = store.start(0);
    const second = store.start(1);
    expect(store.commit(first.nonce, 2)).toBe(false);
    expect(store.commit("0123456789abcdef0123456789abcdef", 2)).toBe(false);
    expect(store.commit(second.nonce, 2)).toBe(true);
    expect(store.commit(second.nonce, 3)).toBe(false);
  });

  it("fails an expired attempt at commit with the took-too-long reason", () => {
    const store = attempts();
    const { nonce } = store.start(0);
    store.claim(nonce, 1);
    expect(store.commit(nonce, 10 * MINUTE)).toBe(false);
    expect(store.peek(10 * MINUTE)).toEqual({ state: "failed", reason: TOOK_TOO_LONG });
  });

  it("does not commit an attempt that has already failed or is done", () => {
    const store = attempts();
    const { nonce } = store.start(0);
    store.claim(nonce, 1);
    store.resolve(nonce, "failed", "refused");
    expect(store.commit(nonce, 2)).toBe(false);
    expect(store.peek(2)).toEqual({ state: "failed", reason: "refused" });
  });

  it("ignores a resolve for a nonce that is not current, so a stranger cannot fail a real attempt", () => {
    const store = attempts();
    const old = store.start(0);
    const live = store.start(1);
    store.resolve("0123456789abcdef0123456789abcdef", "failed", "guessed");
    store.resolve(old.nonce, "failed", "superseded");
    expect(store.peek(2)).toEqual({ state: "waiting", reason: "" });
    expect(store.claim(live.nonce, 2)).not.toBeNull();
  });

  it("ignores a resolve once the outcome is recorded, so a replay cannot rewrite a success", () => {
    const store = attempts();
    const { nonce } = store.start(0);
    store.claim(nonce, 1);
    store.commit(nonce, 2);
    store.resolve(nonce, "done");
    store.resolve(nonce, "failed", "replayed");
    expect(store.peek(3)).toEqual({ state: "done", reason: "" });

    const other = store.start(4);
    store.resolve(other.nonce, "failed", "first");
    store.resolve(other.nonce, "done");
    expect(store.peek(5)).toEqual({ state: "failed", reason: "first" });
  });

  it("forgets the verifier on resolve, so a failed attempt can never be claimed", () => {
    const store = attempts();
    const { nonce } = store.start(0);
    store.resolve(nonce, "failed", "gone");
    expect(store.claim(nonce, 1)).toBeNull();
  });

  it("cancels: true for a committed or done attempt, false for a waiting, failed or missing one, and clears the slot", () => {
    const store = attempts();
    expect(store.cancel()).toBe(false);

    store.start(0);
    expect(store.cancel()).toBe(false);
    expect(store.peek(1)).toBeNull();

    const committed = store.start(2);
    store.claim(committed.nonce, 3);
    store.commit(committed.nonce, 3);
    expect(store.cancel()).toBe(true);
    expect(store.peek(4)).toBeNull();

    const done = store.start(5);
    store.claim(done.nonce, 6);
    store.commit(done.nonce, 6);
    store.resolve(done.nonce, "done");
    expect(store.cancel()).toBe(true);

    const failed = store.start(7);
    store.resolve(failed.nonce, "failed", "no");
    expect(store.cancel()).toBe(false);
  });

  it("refuses the cancelled attempt's commit afterwards", () => {
    const store = attempts();
    const { nonce } = store.start(0);
    store.claim(nonce, 1);
    store.cancel();
    expect(store.commit(nonce, 2)).toBe(false);
  });
});
