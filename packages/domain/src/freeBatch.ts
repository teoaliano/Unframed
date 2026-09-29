/**
 * Free batch: the one path from a list text to the outputs a Free run sends. The preview
 * dialog derives its rows from the same call, so what is previewed is what is sent.
 */
import type { CanvasShape } from "./canvasShapes.ts";
import { composeSelection, joinPromptParts, selectionOrder, type Slot } from "./composition.ts";
import { resolveListText } from "./freeSource.ts";
import { RUNS_CAP } from "./runsValue.ts";

export const SOURCE_GONE_MESSAGE = "The list source is no longer selected.";

/** The sections of a list, the first `RUNS_CAP` of them, and how many more there were. */
export interface SplitList {
  readonly sections: ReadonlyArray<string>;
  readonly truncated: number;
}

const SEPARATOR = "---";

/**
 * Splits a list on lines that hold only `---` (spaces around it allowed), so `---` inside
 * prose is left alone. Each section is trimmed and empty ones are dropped.
 */
export const splitList = (text: string): SplitList => {
  const sections: string[] = [];
  let current: string[] = [];
  const close = () => {
    const section = current.join("\n").trim();
    if (section !== "") sections.push(section);
    current = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === SEPARATOR) close();
    else current.push(line);
  }
  close();
  return { sections: sections.slice(0, RUNS_CAP), truncated: Math.max(0, sections.length - RUNS_CAP) };
};

/** A section's text once its directive is read, and the image numbers it picks (`null` for every image). */
export interface ParsedSection {
  readonly text: string;
  readonly picks: ReadonlyArray<number> | null;
}

/**
 * `[1]` becomes `image 1`: a section numbers the images it receives from 1, and a model
 * told to renumber "image 3" copies it straight through, so the repair writes brackets.
 */
const expandSlots = (text: string): string => text.replace(/\[(\d+)\]/g, "image $1");

/** `images:` or `image:`, then integers separated by commas or spaces, and nothing else on the line. */
const DIRECTIVE = /^images?\s*:\s*-?\d+(?:[\s,]+-?\d+)*$/i;

/**
 * Reads a section's `images: 2, 5` line. Only the first non-empty line is examined, and
 * only a whole-line match is a directive, so a caption like `Image: 3 women in a row`
 * stays: deleting a real caption would pay for an image of nothing anyone asked for.
 */
export const parsePicks = (section: string): ParsedSection => {
  const lines = section.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== "");
  const line = first < 0 ? "" : lines[first]!.trim();
  const whole = { text: expandSlots(section.trim()), picks: null };
  if (!DIRECTIVE.test(line)) return whole;
  const picks = [...new Set([...line.matchAll(/-?\d+/g)].map((match) => Number(match[0])).filter((number) => number > 0))];
  // The line goes only once it yields a usable number: a stray bookkeeping line is noise, a deleted caption is a paid mistake.
  if (picks.length === 0) return whole;
  return { text: expandSlots(lines.slice(first + 1).join("\n").trim()), picks };
};

/** What one run receives: its reference slots, the picks that named an image (`null` for all), and the ones that did not. */
export interface RunReferences {
  readonly references: ReadonlyArray<Slot>;
  readonly used: ReadonlyArray<number> | null;
  readonly dropped: ReadonlyArray<number>;
}

/**
 * A section's references. Without picks it gets every slot. A pick `n` names the `n`th
 * image slot (composites and the sketch count); the named images go in listed order, then
 * every video unchanged. When no pick names an image, every slot is sent, so a garbled
 * directive costs a fix, not a run with no reference.
 */
export const runReferences = (slots: ReadonlyArray<Slot>, picks: ReadonlyArray<number> | null): RunReferences => {
  if (picks === null) return { references: slots, used: null, dropped: [] };
  const images = slots.filter((slot) => slot.kind === "image");
  const used = picks.filter((pick) => pick <= images.length);
  const dropped = picks.filter((pick) => pick > images.length);
  if (used.length === 0) return { references: slots, used: null, dropped };
  return { references: [...used.map((pick) => images[pick - 1]!), ...slots.filter((slot) => slot.kind === "video")], used, dropped };
};

export interface FreeBatchInput {
  /** Every shape on the canvas, as selection to request reads it. */
  readonly shapes: ReadonlyArray<CanvasShape>;
  readonly selected: ReadonlyArray<string>;
  readonly instruction: string;
  readonly sourceId: string;
  /** The list, as the source has it or as the repair rewrote it. */
  readonly listText: string;
  /**
   * The list is the repair's answer. It is model output, so it is read literally even from
   * a prompt source: its `@` tokens never pull in other prompts.
   */
  readonly repaired?: boolean | undefined;
}

/** One output of a Free batch: exactly what it sends and how its directive was read. */
export interface FreeRun {
  readonly prompt: string;
  /** The shared context and the section, joined: what the output's recipe records. */
  readonly selectionPrompt: string;
  readonly references: ReadonlyArray<Slot>;
  /** The numbers the section's `images:` line listed, or `null` without one. */
  readonly picks: ReadonlyArray<number> | null;
  /** The picks that named an image, or `null` when the run gets every image. */
  readonly used: ReadonlyArray<number> | null;
  readonly dropped: ReadonlyArray<number>;
}

export interface FreeBatch {
  readonly runs: ReadonlyArray<FreeRun>;
  readonly truncated: number;
  /** Sections within the cap left with no text once their directive was read. */
  readonly empty: number;
  /** The selection's prompt parts with the source blanked, joined. */
  readonly shared: string;
  /** The instruction, resolved with the source blanked. */
  readonly instruction: string;
  /** A circular reference, or the source gone from the selection. There are no runs with an error. */
  readonly error?: string;
}

/**
 * The one path from a list text to what a Free run sends: split, directive parse, slot
 * expansion, prompt assembly and per-run references. The preview and the send both call
 * it. The source is blanked in the shared context, so neither it nor a reference to it
 * brings the whole list into every run. It never throws.
 */
export const freeBatch = (input: FreeBatchInput): FreeBatch => {
  const blanked = input.shapes.map((shape) => (shape.id === input.sourceId ? { ...shape, text: "" } : shape));
  const composition = composeSelection({ shapes: blanked, selected: input.selected, instruction: input.instruction, medium: "image" });
  const shared = composition.promptParts.join("\n\n");
  const base = { shared, instruction: composition.instruction, truncated: 0, empty: 0, runs: [] };
  const source = selectionOrder(input.shapes, input.selected).find((shape) => shape.id === input.sourceId);
  if (source === undefined) return { ...base, error: SOURCE_GONE_MESSAGE };
  const list = input.repaired ? { ok: true as const, text: input.listText } : resolveListText(input.shapes, source, input.listText);
  if (!list.ok) return { ...base, error: list.error };
  if (composition.error !== undefined) return { ...base, error: composition.error };

  const { sections, truncated } = splitList(list.text);
  const runs: FreeRun[] = [];
  let empty = 0;
  for (const section of sections) {
    const parsed = parsePicks(section);
    if (parsed.text === "") {
      empty++;
      continue;
    }
    const { references, used, dropped } = runReferences(composition.references, parsed.picks);
    runs.push({
      prompt: joinPromptParts(shared, parsed.text, composition.instruction),
      selectionPrompt: joinPromptParts(shared, parsed.text),
      references,
      picks: parsed.picks,
      used,
      dropped,
    });
  }
  return { ...base, runs, truncated, empty };
};
