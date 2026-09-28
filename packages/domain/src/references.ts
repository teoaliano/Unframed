import { membersOf, type CanvasShape } from "./canvasShapes.ts";
import { REF_TOKEN } from "./refs.ts";

export type Resolved = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };

class Cycle extends Error {}

export interface ReferenceResolver {
  /**
   * `text` with every `@id` it holds resolved. `self` is the ref whose own text this is,
   * so a reference back to it is a cycle.
   */
  resolve(text: string, self?: string): Resolved;
}

/**
 * `@id` resolution against every prompt, text result and group on the canvas. A prompt
 * resolves to its own text, recursively; a text result to its text, literally and never
 * re-scanned; a group to its prompt and text-result members' text in box order, never
 * their media. An unknown token stays as typed. A loop fails with the ids along it.
 */
export const createResolver = (shapes: ReadonlyArray<CanvasShape>): ReferenceResolver => {
  const byRef = new Map<string, CanvasShape>();
  for (const shape of shapes) {
    if (shape.ref === undefined) continue;
    if (shape.kind !== "prompt" && shape.kind !== "group") continue;
    if (!byRef.has(shape.ref)) byRef.set(shape.ref, shape);
  }

  const expand = (text: string, stack: ReadonlyArray<string>): string =>
    text.replace(REF_TOKEN, (token, id: string) => {
      const target = byRef.get(id);
      if (target === undefined) return token;
      if (target.kind === "prompt" && target.textResult) return target.text ?? "";
      if (stack.includes(id)) throw new Cycle([...stack.slice(stack.indexOf(id)), id].join(" -> "));
      if (target.kind === "prompt") return expand(target.text ?? "", [...stack, id]);
      return groupText(target, [...stack, id]);
    });

  const groupText = (group: CanvasShape, stack: ReadonlyArray<string>): string =>
    membersOf(shapes, group.id)
      .filter((member) => member.kind === "prompt")
      .map((member) => {
        if (member.textResult) return member.text ?? "";
        const inner = member.ref === undefined ? stack : [...stack, member.ref];
        return expand(member.text ?? "", inner);
      })
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join("\n\n");

  return {
    resolve(text, self) {
      try {
        return { ok: true, text: expand(text, self === undefined ? [] : [self]) };
      } catch (error) {
        if (error instanceof Cycle) return { ok: false, error: `Circular reference: ${error.message}` };
        throw error;
      }
    },
  };
};

/** One resolution, for callers that resolve a single text. */
export const resolveReferences = (text: string, shapes: ReadonlyArray<CanvasShape>, self?: string): Resolved =>
  createResolver(shapes).resolve(text, self);
