import { describe, expect, it } from "vitest";
import { finalPromptWarnings, freeNotes, repairNote, type FreeBatch, type FreeRun } from "../src/index.ts";

const run = (dropped: number[] = []): FreeRun => ({ prompt: "p", selectionPrompt: "p", references: [], picks: dropped.length > 0 ? dropped : null, used: null, dropped });
const batch = (runs: FreeRun[], truncated = 0, empty = 0): FreeBatch => ({ runs, truncated, empty, shared: "", instruction: "" });

describe("the Free notes", () => {
  it.each<[string, FreeBatch, string[], string]>([
    ["nothing to say", batch([run(), run()]), [], ""],
    ["a truncated list", batch(Array.from({ length: 10 }, () => run()), 3), [], "list had 13 items, running the first 10"],
    ["truncation counts skipped sections among the first", batch(Array.from({ length: 9 }, () => run()), 2, 1), [], "list had 12 items, running the first 10 · skipped 1 section with no prompt text"],
    ["one skipped section", batch([run()], 0, 1), [], "skipped 1 section with no prompt text"],
    ["several skipped sections", batch([run()], 0, 3), [], "skipped 3 sections with no prompt text"],
    ["one dropped image", batch([run([5]), run()]), [], "no image 5 selected"],
    ["dropped images, distinct and ascending across runs", batch([run([5, 2]), run([2, 9])]), [], "no images 2, 5, 9 selected"],
    ["repair notes first", batch([run([4])], 0, 1), ["re-split into 2 sections"], "re-split into 2 sections · skipped 1 section with no prompt text · no image 4 selected"],
    ["a repair note alone", batch([run()]), ["no sections found, running as a single generation"], "no sections found, running as a single generation"],
  ])("%s", (_case, value, repair, notes) => {
    expect(freeNotes(value, repair)).toBe(notes);
  });

  it.each([
    [5, "re-split into 5 sections"],
    [2, "re-split into 2 sections"],
    [1, "no sections found, running as a single generation"],
    [0, "no sections found, running as a single generation"],
  ])("names a repair that found %i sections", (sections, note) => {
    expect(repairNote(sections)).toBe(note);
  });
});

describe("the final prompt dialog's warnings", () => {
  it.each<[string, FreeBatch, string[]]>([
    ["none", batch([run()]), []],
    ["one more section past the cap", batch([run()], 1), ["1 more section beyond the 10-run cap will not run."]],
    ["several past the cap", batch([run()], 3), ["3 more sections beyond the 10-run cap will not run."]],
    ["one empty section", batch([run()], 0, 1), ["1 section with no prompt text will not run."]],
    ["several empty sections", batch([run()], 0, 2), ["2 sections with no prompt text will not run."]],
    [
      "all three",
      batch([run([3, 1])], 2, 1),
      ["2 more sections beyond the 10-run cap will not run.", "1 section with no prompt text will not run.", "no images 1, 3 selected"],
    ],
  ])("%s", (_case, value, warnings) => {
    expect(finalPromptWarnings(value)).toEqual(warnings);
  });
});
