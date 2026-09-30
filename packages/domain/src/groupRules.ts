/**
 * Group naming (spec 06): the rename slug, the suffix rule and the prompt rewrites a rename
 * needs. Spec 07's canvas rename calls these too, so each stands on its own.
 */
import type { CanvasShape } from "./canvasShapes.ts";
import { REF_TOKEN } from "./refs.ts";
import { projectSlug } from "./slug.ts";

/** A typed group name as an `@id`: spec 01's slug rule. */
export const slugName = (typed: string): string => projectSlug(typed);

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

export interface GroupRename {
  readonly groupId: string;
  readonly from: string;
  readonly to: string;
  readonly rewrites: ReadonlyArray<PromptRewrite>;
}

/**
 * What renaming group `groupId` to `typed` does: the slug, suffixed while any ref on the
 * canvas holds it, and the prompt rewrites. `undefined` when nothing changes: an empty
 * slug, the current name, or no such group. Every ref counts as taken, not only the
 * referenceable ones, because refs are unique across the canvas.
 */
export const planGroupRename = (shapes: ReadonlyArray<CanvasShape>, groupId: string, typed: string): GroupRename | undefined => {
  const group = shapes.find((shape) => shape.id === groupId);
  if (group?.kind !== "group" || group.ref === undefined) return undefined;
  const slug = slugName(typed);
  if (slug === "" || slug === group.ref) return undefined;
  const taken = shapes.flatMap((shape) => (shape.id !== groupId && shape.ref !== undefined ? [shape.ref] : []));
  const to = uniqueName(slug, taken);
  return { groupId, from: group.ref, to, rewrites: renamePlan(shapes, group.ref, to) };
};
