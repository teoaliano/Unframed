/**
 * What the settings dialog says about the saved OpenRouter key (spec 10): the status line
 * from a `KeyStatus`, and the expiry note under it.
 */

/** Spec 10's `KeyStatus`, as `oauth.status` answers it. */
export type KeyStatusValue =
  | { readonly hasKey: false }
  | { readonly hasKey: true; readonly revoked: true }
  | {
      readonly hasKey: true;
      readonly usage: number;
      readonly limit: number | null;
      readonly limitRemaining: number | null;
      readonly expiresAt: string | null;
      readonly isFreeTier: boolean;
    };

const HOUR_MS = 60 * 60 * 1000;

/** A piece of a line: plain text, or a link. */
export type CopyPart = string | { readonly text: string; readonly href: string };

export interface KeyStatusCopy {
  readonly line: ReadonlyArray<CopyPart>;
  /** A separate line under the spend or free-tier line. */
  readonly expiry: string | undefined;
  /** Whether to offer "Reconnect OpenRouter": re-authorising mints a new key, so only for a dead one. */
  readonly reconnect: boolean;
}

const money = (value: number) => `$${value.toFixed(2)}`;

/**
 * The key section's status copy. `status` is `undefined` when it was not fetched or the
 * fetch failed; `hasKey` and `keyHint` are the settings' own.
 */
export const keyStatusCopy = (input: {
  readonly hasKey: boolean;
  readonly keyHint: string;
  readonly status: KeyStatusValue | undefined;
  readonly now: number;
}): KeyStatusCopy => {
  const plain = (line: ReadonlyArray<CopyPart>): KeyStatusCopy => ({ line, expiry: undefined, reconnect: false });
  if (!input.hasKey) {
    return plain(["Make a key at ", { text: "openrouter.ai/keys", href: "https://openrouter.ai/keys" }, " and paste it here. It starts with sk-or-."]);
  }
  const status = input.status;
  if (status === undefined || !status.hasKey) {
    return plain([`A key is already saved${input.keyHint === "" ? "" : ` (…${input.keyHint})`}. Entering a new one replaces it.`]);
  }
  if ("revoked" in status) {
    return { line: ["This key no longer works at OpenRouter. It may have been deleted or disabled there."], expiry: undefined, reconnect: true };
  }
  const expiry = expiryNote(status.expiresAt, input.now);
  if (status.isFreeTier) {
    return {
      line: ["You have not bought any credit yet, so generating will fail. Add some under ", { text: "Credits", href: "https://openrouter.ai/credits" }, "."],
      expiry,
      reconnect: false,
    };
  }
  let spend = `Connected to OpenRouter. ${money(status.usage)} spent with this key`;
  if (status.limit !== null) {
    spend += `, of a ${money(status.limit)} cap`;
    if (status.limitRemaining !== null) spend += `, ${money(status.limitRemaining)} still available`;
  }
  return { line: [`${spend}.`], expiry, reconnect: false };
};

/** A warning nobody can act on yet is noise, so nothing is said past a fortnight. */
export const expiryNote = (expiresAt: string | null | undefined, now: number): string | undefined => {
  if (typeof expiresAt !== "string") return undefined;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return undefined;
  const hours = (at - now) / HOUR_MS;
  if (hours <= 0) return "This key has expired at OpenRouter. Reconnect to keep generating.";
  if (hours < 48) {
    const whole = Math.max(1, Math.ceil(hours));
    return `This key expires in ${whole} hour${whole === 1 ? "" : "s"}, and nothing renews it. Reconnect before then.`;
  }
  const days = Math.floor(hours / 24);
  return days <= 14 ? `This key expires in ${days} days, and nothing renews it.` : undefined;
};
