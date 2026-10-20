/**
 * `page_edit` and `motion_edit`: an ordered list of exact string replacements
 * applied to an in-memory copy of an artifact's current file. Any edit that does not match
 * exactly once refuses the whole list, so a failed call writes nothing.
 */
import type { ArtifactKind } from "./artifactRules.ts";

export const ARTIFACT_EDITS_MAX = 20;

const NOTHING = "Nothing was written.";

/** How many times `needle` occurs in `text`, overlapping occurrences counted. */
const occurrences = (text: string, needle: string): number => {
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) count++;
  return count;
};

/** The edited text, or the refusal naming the first edit that failed. */
export const applyArtifactEdits = (text: string, edits: unknown, kind: ArtifactKind): { html: string } | { error: string } => {
  if (!Array.isArray(edits) || edits.length === 0) return { error: `edits must be a list of 1 to ${ARTIFACT_EDITS_MAX} { old_string, new_string } changes. ${NOTHING}` };
  if (edits.length > ARTIFACT_EDITS_MAX) return { error: `${edits.length} edits is too many; one call takes 1 to ${ARTIFACT_EDITS_MAX}. ${NOTHING}` };
  let html = text;
  for (const [index, edit] of edits.entries()) {
    const number = index + 1;
    const { old_string: from, new_string: to } = (typeof edit === "object" && edit !== null ? edit : {}) as Record<string, unknown>;
    if (typeof from !== "string" || typeof to !== "string") return { error: `edit ${number}: old_string and new_string must both be strings. ${NOTHING}` };
    if (from === "") return { error: `edit ${number}: old_string is empty; it must quote text that is in the ${kind} now. ${NOTHING}` };
    const count = occurrences(html, from);
    if (count === 0) return { error: `edit ${number}: old_string matched 0 times; it must match exactly once. ${NOTHING} Read the current text with ${kind}_read and quote it exactly.` };
    if (count > 1) return { error: `edit ${number}: old_string matched ${count} times; it must match exactly once. ${NOTHING} Include more of the surrounding text so it is unique.` };
    // Sliced rather than String.replace, which would read `$&` and friends in the new text.
    const at = html.indexOf(from);
    html = `${html.slice(0, at)}${to}${html.slice(at + from.length)}`;
  }
  return { html };
};
