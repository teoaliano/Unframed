/**
 * The off-token note (spec 19): what a page or motion write answers when its file has literal
 * values close to a kit token. It never refuses a write. The notes are capped and repeats are
 * counted, so a long page answers a short list.
 */
import type { OffTokenValue } from "./offTokens.ts";

/** The most notes one write answers before the rest are counted in the last note. */
export const OFF_TOKEN_NOTE_LIMIT = 10;

/** The sentence after the notes: a literal can be intended, so the agent decides. */
export const OFF_TOKEN_ADVICE = "These values sit close to kit tokens. Use the token unless the difference is intended.";

export interface OffTokenNote {
  /** Every off-token value in the file, repeats included. */
  readonly count: number;
  readonly notes: string[];
  readonly advice: string;
}

/** The write result's `offToken`, or `undefined` when the file has no off-token value. */
export const offTokenNote = (values: ReadonlyArray<OffTokenValue>): OffTokenNote | undefined => {
  if (values.length === 0) return undefined;
  const groups = new Map<string, { value: OffTokenValue; repeats: number }>();
  for (const value of values) {
    const key = `${value.value}\u0000${value.css}\u0000${value.exact ? "exact" : "near"}`;
    const known = groups.get(key);
    if (known) known.repeats++;
    else groups.set(key, { value, repeats: 1 });
  }
  const lines = [...groups.values()].map(({ value, repeats }) => {
    const wording = value.exact ? `${value.value} is ${value.css}` : `${value.value} is near ${value.css} (${value.tokenValue})`;
    return repeats > 1 ? `${wording} (×${repeats})` : wording;
  });
  const notes = lines.slice(0, OFF_TOKEN_NOTE_LIMIT);
  if (lines.length > OFF_TOKEN_NOTE_LIMIT) notes.push(`and ${lines.length - OFF_TOKEN_NOTE_LIMIT} more`);
  return { count: values.length, notes, advice: OFF_TOKEN_ADVICE };
};
