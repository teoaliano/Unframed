import type { CanvasShape } from "./canvasShapes.ts";
import { selectionOrder } from "./composition.ts";
import { resolveReferences, type Resolved } from "./references.ts";

/** The selection a Free run reads its list from: the canvas description and what is selected. */
export interface FreeSourceInput {
  readonly shapes: ReadonlyArray<CanvasShape>;
  readonly selected: ReadonlyArray<string>;
}

export interface FreeSource {
  /** The shape the list comes from; absent when the selection holds no prompt or text result. */
  readonly source?: CanvasShape | undefined;
  /** The source's own text, as it is on the canvas. */
  readonly text: string;
  /** The text the list is split from: a text result's verbatim, a prompt's with its `@id` references resolved. */
  readonly listText: string;
  /** A circular reference, a reference back to the source included. */
  readonly error?: string;
}

/**
 * A list text as the source's kind reads it: a text result's literally, never re-scanned;
 * a prompt's with its references resolved, where a reference back to the source is a cycle.
 */
export const resolveListText = (shapes: ReadonlyArray<CanvasShape>, source: CanvasShape, text: string): Resolved =>
  source.textResult ? { ok: true, text } : resolveReferences(text, shapes, source.ref);

/**
 * Where a Free run's list comes from: the first text result in the selection's one order
 * (groups expanded in place), else the first prompt. A text result wins so that a context
 * prompt above the list never silently becomes the list. A group is never the source.
 */
export const freeSource = (input: FreeSourceInput): FreeSource => {
  const prompts = selectionOrder(input.shapes, input.selected).filter((shape) => shape.kind === "prompt");
  const source = prompts.find((shape) => shape.textResult) ?? prompts[0];
  if (source === undefined) return { text: "", listText: "" };
  const text = source.text ?? "";
  const resolved = resolveListText(input.shapes, source, text);
  return resolved.ok ? { source, text, listText: resolved.text } : { source, text, listText: "", error: resolved.error };
};
