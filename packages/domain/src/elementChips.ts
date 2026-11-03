/**
 * Element chips (spec 18, Point and tell): the pointed-at elements a message carries, and the
 * preamble part the agent reads for them. Pure, so the web builds chips and the engine builds the
 * preamble from the same rules.
 */
import type { ElementChip } from "@unframed/contracts";
import type { ArtifactKind } from "./artifacts/artifactRules.ts";

/** An element the person picked, as the editor reads it: enough to build its chip. */
export interface ChipElement {
  /** The element id, or null for a runtime element. */
  readonly elementId: string | null;
  /** A runtime element's live selector. Unused when the element has an id. */
  readonly liveSelector: string;
  readonly tag: string;
  /** The layer name the person sees. */
  readonly label: string;
  /** The start tag as written in the source (as live, for a runtime element). */
  readonly startTag: string;
  /** The element's own text. */
  readonly text: string;
  /** True when it has element children; the excerpt marks them with an ellipsis. */
  readonly hasChildren: boolean;
  /** A chip's excerpt in place of the element's markup: a motion tween's call as written (spec 21). */
  readonly excerpt?: string;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

const EXCERPT_TEXT_MAX = 80;
const EXCERPT_MAX = 240;

/** The chip for one pointed-at element of an artifact. */
export const elementChip = (element: ChipElement, shape: { readonly shapeId: string }): ElementChip => {
  const selector = element.elementId === null ? element.liveSelector : `[data-hf-id="${element.elementId}"]`;
  const endTag = VOID.has(element.tag.toLowerCase()) ? "" : `</${element.tag}>`;
  const children = element.hasChildren ? "…" : "";
  const markup = `${element.startTag}${element.text.slice(0, EXCERPT_TEXT_MAX)}${children}${endTag}`;
  const excerpt = (element.excerpt ?? markup).slice(0, EXCERPT_MAX);
  return { shapeId: shape.shapeId, elementId: element.elementId, selector, tag: element.tag, label: element.label, excerpt };
};

/** The preamble's elements part, wording from `assets/prompts/element-context.md`. Empty when no chip's artifact is listed. */
export const ELEMENT_CONTEXT_INTRO =
  "These are the elements the person pointed at in this message. Each line names one of them by its selector, which finds it in that artifact's current file, and gives an excerpt of its HTML.";
export const ELEMENT_CONTEXT_ARTIFACT = '{Kind} "{label}" (shape {id}):';
export const ELEMENT_CONTEXT_CHIP = "- {selector}: {excerpt}";

/** Fills each {key} in one pass, so a value that itself holds braces is written as it is. */
const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

/**
 * The elements part of the preamble: one block per listed artifact that has chips, in the order
 * of `shapes`, each with its chips' selectors and excerpts. A chip whose shape is not listed is
 * left out.
 */
export const elementContext = (
  chips: readonly ElementChip[],
  shapes: readonly { readonly shapeId: string; readonly kind: ArtifactKind; readonly label: string }[],
): string => {
  const blocks = shapes.flatMap((shape) => {
    const mine = chips.filter((chip) => chip.shapeId === shape.shapeId);
    if (mine.length === 0) return [];
    const kind = shape.kind.charAt(0).toUpperCase() + shape.kind.slice(1);
    const header = fill(ELEMENT_CONTEXT_ARTIFACT, { Kind: kind, label: shape.label, id: shape.shapeId });
    const lines = mine.map((chip) => fill(ELEMENT_CONTEXT_CHIP, { selector: chip.selector, excerpt: chip.excerpt }));
    return [[header, ...lines].join("\n")];
  });
  return blocks.length === 0 ? "" : [ELEMENT_CONTEXT_INTRO, ...blocks].join("\n\n");
};
