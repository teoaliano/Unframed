/** Spec 15's `ElevenLabsStatus`, as `elevenlabs.status` answers it. */
export type ElevenLabsStatusValue =
  | { readonly hasKey: false }
  | { readonly hasKey: true; readonly revoked: true }
  | { readonly hasKey: true; readonly usageHidden: true }
  | {
      readonly hasKey: true;
      readonly tier: string | null;
      readonly creditsUsed: number;
      readonly creditLimit: number | null;
      readonly resetsAt: string | null;
    };

/**
 * The line under the ElevenLabs key field. `status` is `undefined` when it was not fetched
 * or the fetch failed. The usage is the account's, never the key's.
 */
export const elevenLabsStatusCopy = (input: {
  readonly hasKey: boolean;
  readonly keyHint: string;
  readonly status: ElevenLabsStatusValue | undefined;
  readonly locale?: string | undefined;
}): string => {
  if (!input.hasKey) return "Make a key at elevenlabs.io (Developers, API keys) and paste it here. Audio generation is billed to that account in credits.";
  const status = input.status;
  if (status === undefined || !status.hasKey) return `A key is already saved${input.keyHint === "" ? "" : ` (…${input.keyHint})`}. Entering a new one replaces it.`;
  if ("revoked" in status) return "This key no longer works at ElevenLabs. It may have been deleted or disabled there.";
  if ("usageHidden" in status) return "This key cannot read the account's usage, so it is not shown here. Generating works if the key may use text to speech.";
  const number = new Intl.NumberFormat(input.locale);
  const used = status.creditLimit === null ? `${number.format(status.creditsUsed)} credits used` : `${number.format(status.creditsUsed)} of ${number.format(status.creditLimit)} credits used`;
  const at = status.resetsAt === null ? Number.NaN : Date.parse(status.resetsAt);
  const resets = Number.isFinite(at) ? ` Resets on ${new Date(at).toLocaleDateString(input.locale, { year: "numeric", month: "short", day: "numeric" })}.` : "";
  return `${used} on this ElevenLabs account this period.${resets}`;
};
