import type { CanvasShape, ShapeKind } from "./canvasShapes.ts";
import { isMintedRef, REF_TOKEN } from "./refs.ts";
import { projectSlug } from "./slug.ts";

export const slugName = (typed: string): string => projectSlug(typed.normalize("NFD").replace(/\p{M}+/gu, ""));

export const NAME_NEEDS_A_LETTER = "A name needs a letter.";

export const nameRefusal = (typed: string, current: string): string | undefined => {
  const slug = slugName(typed);
  return slug !== "" && slug !== current && isMintedRef(slug) ? NAME_NEEDS_A_LETTER : undefined;
};

export const uniqueName = (wanted: string, taken: Iterable<string>): string => {
  const used = new Set(taken);
  if (!used.has(wanted)) return wanted;
  let n = 2;
  while (used.has(`${wanted}-${n}`)) n++;
  return `${wanted}-${n}`;
};

const rewriteToken = (text: string, from: string, to: string): string =>
  text.replace(REF_TOKEN, (token, id: string) => (id === from ? `@${to}` : token));

interface PromptRewrite {
  readonly id: string;
  readonly text: string;
}

export const renamePlan = (shapes: ReadonlyArray<CanvasShape>, from: string, to: string): PromptRewrite[] =>
  shapes.flatMap((shape) => {
    if (shape.kind !== "prompt" || shape.textResult || shape.text === undefined) return [];
    const text = rewriteToken(shape.text, from, to);
    return text === shape.text ? [] : [{ id: shape.id, text }];
  });

export interface Rename {
  readonly id: string;
  readonly kind: ShapeKind;
  readonly from: string;
  readonly to: string;
  readonly rewrites: ReadonlyArray<PromptRewrite>;
  readonly title?: string;
}

export const planRename = (shapes: ReadonlyArray<CanvasShape>, id: string, typed: string): Rename | undefined => {
  const shape = shapes.find((candidate) => candidate.id === id);
  if (shape?.ref === undefined) return undefined;
  const slug = slugName(typed);
  if (slug === "" || slug === shape.ref || isMintedRef(slug)) return undefined;
  const taken = shapes.flatMap((other) => (other.id !== id && other.ref !== undefined ? [other.ref] : []));
  const to = uniqueName(slug, taken);
  return {
    id,
    kind: shape.kind,
    from: shape.ref,
    to,
    rewrites: renamePlan(shapes, shape.ref, to),
    ...(shape.kind === "page" || shape.kind === "motion" || shape.kind === "component" ? { title: to } : {}),
  };
};

export const refOnPaste = (ref: string | undefined, taken: ReadonlySet<string>, mint: () => string): string =>
  ref === undefined || ref === "" || isMintedRef(ref) ? mint() : uniqueName(ref, taken);
