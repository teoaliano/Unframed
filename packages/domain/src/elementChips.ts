import type { ElementChip } from "@unframed/contracts";
import type { ArtifactKind } from "./artifacts/artifactRules.ts";

export interface ChipElement {
  readonly elementId: string | null;
  readonly liveSelector: string;
  readonly tag: string;
  readonly label: string;
  readonly startTag: string;
  readonly text: string;
  readonly hasChildren: boolean;
  readonly excerpt?: string;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

const EXCERPT_TEXT_MAX = 80;
const EXCERPT_MAX = 240;

export const elementChip = (element: ChipElement, shape: { readonly shapeId: string }): ElementChip => {
  const selector = element.elementId === null ? element.liveSelector : `[data-hf-id="${element.elementId}"]`;
  const endTag = VOID.has(element.tag.toLowerCase()) ? "" : `</${element.tag}>`;
  const children = element.hasChildren ? "…" : "";
  const markup = `${element.startTag}${element.text.slice(0, EXCERPT_TEXT_MAX)}${children}${endTag}`;
  const excerpt = (element.excerpt ?? markup).slice(0, EXCERPT_MAX);
  return { shapeId: shape.shapeId, elementId: element.elementId, selector, tag: element.tag, label: element.label, excerpt };
};

export const ELEMENT_CONTEXT_INTRO =
  "These are the elements the person pointed at in this message. Each line names one of them by its selector, which finds it in that artifact's current file, and gives an excerpt of its HTML.";
export const ELEMENT_CONTEXT_ARTIFACT = '{Kind} "{label}" (shape {id}):';
export const ELEMENT_CONTEXT_CHIP = "- {selector}: {excerpt}";

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

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
