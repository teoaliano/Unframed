import { describe, expect, it } from "vitest";
import { expiryNote, keyStatusCopy } from "../src/index.ts";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe("the expiry note", () => {
  it("says nothing without a date, or with one it cannot read", () => {
    expect(expiryNote(null, NOW)).toBeUndefined();
    expect(expiryNote(undefined, NOW)).toBeUndefined();
    expect(expiryNote("next tuesday", NOW)).toBeUndefined();
  });

  it("says the key has expired at exactly 0 hours and after", () => {
    expect(expiryNote(at(0), NOW)).toBe("This key has expired at OpenRouter. Reconnect to keep generating.");
    expect(expiryNote(at(-3 * HOUR), NOW)).toBe("This key has expired at OpenRouter. Reconnect to keep generating.");
  });

  it("rounds up to at least one hour, singular only for one", () => {
    expect(expiryNote(at(40 * 60 * 1000), NOW)).toBe("This key expires in 1 hour, and nothing renews it. Reconnect before then.");
    expect(expiryNote(at(1), NOW)).toBe("This key expires in 1 hour, and nothing renews it. Reconnect before then.");
    expect(expiryNote(at(HOUR + 1), NOW)).toBe("This key expires in 2 hours, and nothing renews it. Reconnect before then.");
    expect(expiryNote(at(47.5 * HOUR), NOW)).toBe("This key expires in 48 hours, and nothing renews it. Reconnect before then.");
  });

  it("counts whole days, rounded down, from exactly 48 hours to 14 days", () => {
    expect(expiryNote(at(48 * HOUR), NOW)).toBe("This key expires in 2 days, and nothing renews it.");
    expect(expiryNote(at(71 * HOUR), NOW)).toBe("This key expires in 2 days, and nothing renews it.");
    expect(expiryNote(at(14 * 24 * HOUR), NOW)).toBe("This key expires in 14 days, and nothing renews it.");
    expect(expiryNote(at(14 * 24 * HOUR + HOUR), NOW)).toBe("This key expires in 14 days, and nothing renews it.");
  });

  it("says nothing from 15 days on", () => {
    expect(expiryNote(at(15 * 24 * HOUR), NOW)).toBeUndefined();
    expect(expiryNote(at(90 * 24 * HOUR), NOW)).toBeUndefined();
  });
});

const live = (overrides: Partial<{ usage: number; limit: number | null; limitRemaining: number | null; expiresAt: string | null; isFreeTier: boolean }> = {}) => ({
  hasKey: true as const,
  usage: 7.4412,
  limit: null,
  limitRemaining: null,
  expiresAt: null,
  isFreeTier: false,
  ...overrides,
});

/** The line as the dialog reads it, links marked as [text](href). */
const text = (copy: ReturnType<typeof keyStatusCopy>) => copy.line.map((part) => (typeof part === "string" ? part : `[${part.text}](${part.href})`)).join("");

describe("the key status copy", () => {
  it("says a revoked key no longer works and offers reconnecting", () => {
    const copy = keyStatusCopy({ hasKey: true, keyHint: "abcd", status: { hasKey: true, revoked: true }, now: NOW });
    expect(text(copy)).toBe("This key no longer works at OpenRouter. It may have been deleted or disabled there.");
    expect(copy.reconnect).toBe(true);
    expect(copy.expiry).toBeUndefined();
  });

  it("says the free tier will fail with a link to Credits, in place of the spend line", () => {
    const copy = keyStatusCopy({ hasKey: true, keyHint: "abcd", status: live({ isFreeTier: true, usage: 3, limit: 10, limitRemaining: 7 }), now: NOW });
    expect(text(copy)).toBe("You have not bought any credit yet, so generating will fail. Add some under [Credits](https://openrouter.ai/credits).");
    expect(text(copy)).not.toContain("spent");
    expect(copy.reconnect).toBe(false);
  });

  it("says the spend alone, to two decimals, without a cap", () => {
    expect(text(keyStatusCopy({ hasKey: true, keyHint: "abcd", status: live(), now: NOW }))).toBe("Connected to OpenRouter. $7.44 spent with this key.");
    expect(text(keyStatusCopy({ hasKey: true, keyHint: "abcd", status: live({ usage: 0 }), now: NOW }))).toBe("Connected to OpenRouter. $0.00 spent with this key.");
  });

  it("adds the cap when the key has one", () => {
    expect(text(keyStatusCopy({ hasKey: true, keyHint: "abcd", status: live({ limit: 10 }), now: NOW }))).toBe("Connected to OpenRouter. $7.44 spent with this key, of a $10.00 cap.");
  });

  it("adds what remains when both the cap and the remainder are known", () => {
    expect(text(keyStatusCopy({ hasKey: true, keyHint: "abcd", status: live({ limit: 10, limitRemaining: 9.912 }), now: NOW }))).toBe(
      "Connected to OpenRouter. $7.44 spent with this key, of a $10.00 cap, $9.91 still available.",
    );
    expect(text(keyStatusCopy({ hasKey: true, keyHint: "abcd", status: live({ limit: null, limitRemaining: 5 }), now: NOW }))).toBe(
      "Connected to OpenRouter. $7.44 spent with this key.",
    );
  });

  it("puts the expiry note under the spend or free-tier line", () => {
    expect(keyStatusCopy({ hasKey: true, keyHint: "abcd", status: live({ expiresAt: at(30 * HOUR) }), now: NOW }).expiry).toBe(
      "This key expires in 30 hours, and nothing renews it. Reconnect before then.",
    );
    expect(keyStatusCopy({ hasKey: true, keyHint: "abcd", status: live({ isFreeTier: true, expiresAt: at(0) }), now: NOW }).expiry).toBe(
      "This key has expired at OpenRouter. Reconnect to keep generating.",
    );
  });

  it("says a key is saved, with its hint, when the status was not fetched or failed", () => {
    expect(text(keyStatusCopy({ hasKey: true, keyHint: "abcd", status: undefined, now: NOW }))).toBe("A key is already saved (…abcd). Entering a new one replaces it.");
    expect(text(keyStatusCopy({ hasKey: true, keyHint: "", status: undefined, now: NOW }))).toBe("A key is already saved. Entering a new one replaces it.");
  });

  it("tells a person with no key where to make one", () => {
    const copy = keyStatusCopy({ hasKey: false, keyHint: "", status: undefined, now: NOW });
    expect(text(copy)).toBe("Make a key at [openrouter.ai/keys](https://openrouter.ai/keys) and paste it here. It starts with sk-or-.");
    expect(copy.reconnect).toBe(false);
    expect(text(keyStatusCopy({ hasKey: false, keyHint: "", status: { hasKey: false }, now: NOW }))).toBe(text(copy));
  });
});
