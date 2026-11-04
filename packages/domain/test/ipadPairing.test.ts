import { describe, expect, it } from "vitest";
import { PAIRING_CODE_TTL_MS, pairingAttempt, startPairingCode, type PendingCode } from "../src/index.ts";

const NOW = Date.parse("2026-11-04T10:00:00Z");
const CODE = "314159";
const pending = (over: Partial<PendingCode> = {}): PendingCode => ({ ...startPairingCode(CODE, NOW), ...over });

const LOCKED = { ok: false, reason: "locked", message: "This code is locked. Start pairing again on your Mac." };
const EXPIRED = { ok: false, reason: "expired", message: "This code has expired. Start pairing again on your Mac." };
const WRONG = { ok: false, reason: "wrong", message: "That code is not right." };

describe("pairingAttempt", () => {
  it("pairs on the right code and leaves no pending code behind", () => {
    const result = pairingAttempt(pending(), CODE, NOW + 1000);
    expect(result.outcome).toEqual({ ok: true });
    expect(result.state).toBeUndefined();
  });

  it("ignores space around a typed code", () => {
    expect(pairingAttempt(pending(), ` ${CODE} `, NOW).outcome).toEqual({ ok: true });
  });

  it("refuses the same code a second time, because pairing used it up", () => {
    const { state } = pairingAttempt(pending(), CODE, NOW);
    expect(pairingAttempt(state, CODE, NOW).outcome).toEqual(WRONG);
  });

  it("refuses every code when none is pending", () => {
    expect(pairingAttempt(undefined, CODE, NOW).outcome).toEqual(WRONG);
  });

  it("expires five minutes after it was started", () => {
    expect(pairingAttempt(pending(), CODE, NOW + PAIRING_CODE_TTL_MS - 1).outcome).toEqual({ ok: true });
    expect(pairingAttempt(pending(), CODE, NOW + PAIRING_CODE_TTL_MS).outcome).toEqual(EXPIRED);
  });

  it("says expired rather than wrong once the time is up", () => {
    expect(pairingAttempt(pending(), "000000", NOW + PAIRING_CODE_TTL_MS).outcome).toEqual(EXPIRED);
  });

  it("counts wrong tries and locks on the fifth, whoever sends them", () => {
    let state: PendingCode | undefined = pending();
    for (const attempt of [1, 2, 3, 4]) {
      const result = pairingAttempt(state, `00000${attempt}`, NOW);
      expect(result.outcome).toEqual(WRONG);
      state = result.state;
    }
    const fifth = pairingAttempt(state, "000005", NOW);
    expect(fifth.outcome).toEqual(LOCKED);
    expect(fifth.state).toEqual(expect.objectContaining({ locked: true }));
  });

  it("stays locked, even for the right code", () => {
    const locked = pending({ locked: true });
    expect(pairingAttempt(locked, CODE, NOW).outcome).toEqual(LOCKED);
    expect(pairingAttempt(locked, "000000", NOW).outcome).toEqual(LOCKED);
  });

  it("starts again clean when the person replaces the code, and the old one is wrong", () => {
    const replaced = startPairingCode("271828", NOW + 1000);
    expect(replaced.wrong).toBe(0);
    expect(replaced.locked).toBe(false);
    expect(pairingAttempt(replaced, CODE, NOW + 1000).outcome).toEqual(WRONG);
    expect(pairingAttempt(replaced, "271828", NOW + 1000).outcome).toEqual({ ok: true });
  });

  it("gives a six-digit code five minutes", () => {
    const started = startPairingCode(CODE, NOW);
    expect(started.expiresAt).toBe(NOW + PAIRING_CODE_TTL_MS);
  });
});
