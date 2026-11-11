export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

export const PAIRING_MAX_WRONG = 5;

export const PAIRING_LOCKED = "This code is locked. Start pairing again on your Mac.";
export const PAIRING_EXPIRED = "This code has expired. Start pairing again on your Mac.";
export const PAIRING_WRONG = "That code is not right.";

export interface PendingCode {
  readonly code: string;
  readonly expiresAt: number;
  readonly wrong: number;
  readonly locked: boolean;
}

export type PairingOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "wrong" | "expired" | "locked"; readonly message: string };

export const startPairingCode = (code: string, now: number): PendingCode => ({
  code,
  expiresAt: now + PAIRING_CODE_TTL_MS,
  wrong: 0,
  locked: false,
});

const refuse = (reason: "wrong" | "expired" | "locked"): PairingOutcome => ({
  ok: false,
  reason,
  message: reason === "locked" ? PAIRING_LOCKED : reason === "expired" ? PAIRING_EXPIRED : PAIRING_WRONG,
});

export const pairingAttempt = (
  state: PendingCode | undefined,
  code: string,
  now: number,
): { readonly state: PendingCode | undefined; readonly outcome: PairingOutcome } => {
  if (state === undefined) return { state, outcome: refuse("wrong") };
  if (state.locked) return { state, outcome: refuse("locked") };
  if (now >= state.expiresAt) return { state, outcome: refuse("expired") };
  if (code.trim() === state.code) return { state: undefined, outcome: { ok: true } };
  const wrong = state.wrong + 1;
  const locked = wrong >= PAIRING_MAX_WRONG;
  return { state: { ...state, wrong, locked }, outcome: refuse(locked ? "locked" : "wrong") };
};
