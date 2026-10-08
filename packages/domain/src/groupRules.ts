/**
 * Naming (spec 02 and 06): the rename slug, the suffix rule and the prompt rewrites a rename
 * needs, for a group and for every other shape with an `@id`. Spec 07's canvas rename calls
 * these too, so each stands on its own.
 */
import type { CanvasShape, ShapeKind } from "./canvasShapes.ts";
import { isMintedRef, REF_TOKEN } from "./refs.ts";
import { projectSlug } from "./slug.ts";

/**
 * A typed name as an `@id`: spec 01's slug rule, after accented letters lose their accents,
 * so "città" is `citta` and not `citt`. Only names do this: project and file names keep
 * spec 01's rule unchanged, because an existing project folder is found by its slug.
 */
export const slugName = (typed: string): string => projectSlug(typed.normalize("NFD").replace(/\p{M}+/gu, ""));

/** Why a name of digits only is refused: it would read as a number the canvas minted. */
export const NAME_NEEDS_A_LETTER = "A name needs a letter.";

/** Why `typed` cannot become a shape's name, or `undefined` when it can (or changes nothing). */
export const nameRefusal = (typed: string, current: string): string | undefined => {
  const slug = slugName(typed);
  return slug !== "" && slug !== current && isMintedRef(slug) ? NAME_NEEDS_A_LETTER : undefined;
};

/** `wanted`, or `wanted-2`, `wanted-3` and so on, whichever is first free of `taken`. */
export const uniqueName = (wanted: string, taken: Iterable<string>): string => {
  const used = new Set(taken);
  if (!used.has(wanted)) return wanted;
  let n = 2;
  while (used.has(`${wanted}-${n}`)) n++;
  return `${wanted}-${n}`;
};

/** `text` with every whole `@from` token as `@to`: a token is `@` and the longest run of word characters and hyphens. */
export const rewriteToken = (text: string, from: string, to: string): string =>
  text.replace(REF_TOKEN, (token, id: string) => (id === from ? `@${to}` : token));

export interface PromptRewrite {
  readonly id: string;
  /** The prompt's plain text after the rewrite. */
  readonly text: string;
}

/**
 * Every prompt whose text holds the whole token `@from`, with it rewritten to `@to`. A text
 * result is a model's answer, used literally, so it is never rewritten.
 */
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
  /** A page's or motion's new title: its name, so every place that lists it shows what the person typed. */
  readonly title?: string;
}

/**
 * What renaming shape `id` to `typed` does: the slug, suffixed while any ref on the canvas
 * holds it, and the prompt rewrites. Any shape with an `@id` can be renamed. `undefined`
 * when nothing changes: an empty slug, the current name, or no such shape. Every ref
 * counts as taken, not only the referenceable ones, because refs are unique across the
 * canvas.
 */
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
    ...(shape.kind === "page" || shape.kind === "motion" ? { title: to } : {}),
  };
};

/**
 * The ref a pasted or inserted shape takes: a name is kept, suffixed while `taken` holds it;
 * a minted ref, or none, is minted afresh, so a copy never captures a reference to the
 * original.
 */
export const refOnPaste = (ref: string | undefined, taken: ReadonlySet<string>, mint: () => string): string =>
  ref === undefined || ref === "" || isMintedRef(ref) ? mint() : uniqueName(ref, taken);
