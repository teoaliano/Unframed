import { promptText, readRef, type CanvasRecordLike } from "./refs.ts";

const QUERY = /@([\w-]*)$/;

/** The characters typed after an `@` that ends the text before the caret, or `undefined` when there is none. */
export const mentionQuery = (textBeforeCaret: string): string | undefined => QUERY.exec(textBeforeCaret)?.[1];

export const MENTION_PREVIEW_LENGTH = 24;

/** One row of the mention menu. A group has no preview. */
export interface MentionCandidate {
  readonly ref: string;
  readonly preview?: string;
}

const preview = (text: string): string => {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MENTION_PREVIEW_LENGTH ? `${collapsed.slice(0, MENTION_PREVIEW_LENGTH)}…` : collapsed;
};

const NUMERIC = /^\d+$/;

const byRef = (a: MentionCandidate, b: MentionCandidate): number => {
  const aNumber = NUMERIC.test(a.ref);
  const bNumber = NUMERIC.test(b.ref);
  if (aNumber && bNumber) return a.ref.length - b.ref.length || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
  if (aNumber !== bNumber) return aNumber ? -1 : 1;
  return a.ref.localeCompare(b.ref);
};

/**
 * Every referenceable shape (a prompt or a group) other than `selfRef` whose ref starts
 * with `query`, compared case-insensitively. Numbered refs come first in number order,
 * then names alphabetically.
 */
export const mentionCandidates = (
  shapes: Iterable<CanvasRecordLike>,
  selfRef: string | undefined,
  query: string,
): MentionCandidate[] => {
  const wanted = query.toLowerCase();
  const rows: MentionCandidate[] = [];
  for (const shape of shapes) {
    if (shape.type !== "text" && shape.type !== "frame") continue;
    const ref = readRef(shape);
    if (ref === undefined || ref === selfRef || !ref.toLowerCase().startsWith(wanted)) continue;
    const text = promptText(shape);
    rows.push(text === undefined ? { ref } : { ref, preview: preview(text) });
  }
  return rows.sort(byRef);
};
