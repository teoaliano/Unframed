/** What a Free batch tells the person about how its list was read: in the run report and in the final prompt dialog. */
import type { FreeBatch } from "./freeBatch.ts";
import { RUNS_CAP } from "./runsValue.ts";

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** The note the repair call leaves: how many sections it found, or that it found none. */
export const repairNote = (sections: number): string =>
  sections > 1 ? `re-split into ${sections} sections` : "no sections found, running as a single generation";

/** The distinct image numbers no run could send, ascending. */
const droppedNote = (batch: FreeBatch): string | undefined => {
  const dropped = [...new Set(batch.runs.flatMap((run) => run.dropped))].sort((a, b) => a - b);
  if (dropped.length === 0) return undefined;
  return `no ${plural(dropped.length, "image", "images")} ${dropped.join(", ")} selected`;
};

/** The batch's notes, repair notes first, joined with ` · `; empty when there is nothing to say. */
export const freeNotes = (batch: FreeBatch, repairNotes: ReadonlyArray<string> = []): string => {
  const kept = batch.runs.length + batch.empty;
  const notes = [...repairNotes];
  if (batch.truncated > 0) notes.push(`list had ${kept + batch.truncated} items, running the first ${kept}`);
  if (batch.empty > 0) notes.push(`skipped ${batch.empty} ${plural(batch.empty, "section", "sections")} with no prompt text`);
  const dropped = droppedNote(batch);
  if (dropped !== undefined) notes.push(dropped);
  return notes.join(" · ");
};

/** The final prompt dialog's live warnings for the text as it stands. */
export const finalPromptWarnings = (batch: FreeBatch): string[] => {
  const warnings: string[] = [];
  if (batch.truncated > 0) {
    warnings.push(`${batch.truncated} more ${plural(batch.truncated, "section", "sections")} beyond the ${RUNS_CAP}-run cap will not run.`);
  }
  if (batch.empty > 0) warnings.push(`${batch.empty} ${plural(batch.empty, "section", "sections")} with no prompt text will not run.`);
  const dropped = droppedNote(batch);
  if (dropped !== undefined) warnings.push(dropped);
  return warnings;
};
