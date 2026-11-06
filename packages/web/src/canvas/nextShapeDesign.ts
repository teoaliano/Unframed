import { designPatched, isDesignableType, shapeDesignOf, type DesignableType, type DesignPatch, type ShapeDesign } from "@unframed/domain";
import { atom, type Atom, type Editor, type TLShape } from "tldraw";

const pending = new WeakMap<Editor, Atom<ShapeDesign>>();

export const TOOL_TYPES: Readonly<Record<string, DesignableType>> = {
  text: "text",
  geo: "geo",
  note: "note",
  arrow: "arrow",
  draw: "draw",
  line: "line",
  highlight: "highlight",
};

const pendingOf = (editor: Editor): Atom<ShapeDesign> => {
  let held = pending.get(editor);
  if (held === undefined) {
    held = atom("next shape design", {});
    pending.set(editor, held);
  }
  return held;
};

export const nextShapeDesign = (editor: Editor): ShapeDesign => pendingOf(editor).get();

export const patchNextShapeDesign = (editor: Editor, patch: DesignPatch): void => {
  const held = pendingOf(editor);
  held.set(designPatched(held.get(), patch));
};

export const metaWithDesign = (meta: TLShape["meta"], design: ShapeDesign): TLShape["meta"] => {
  const { unframed, ...rest } = meta as Record<string, unknown>;
  const { design: _old, ...kept } = (typeof unframed === "object" && unframed !== null ? unframed : {}) as Record<string, unknown>;
  const next = Object.keys(design).length === 0 ? kept : { ...kept, design };
  return (Object.keys(next).length === 0 ? rest : { ...rest, unframed: next }) as TLShape["meta"];
};

export const installNextShapeDesign = (editor: Editor): (() => void) =>
  editor.sideEffects.registerBeforeCreateHandler("shape", (shape) => {
    const design = nextShapeDesign(editor);
    if (Object.keys(design).length === 0 || !isDesignableType(shape.type) || TOOL_TYPES[editor.getCurrentToolId()] !== shape.type) return shape;
    return { ...shape, meta: metaWithDesign(shape.meta, { ...design, ...shapeDesignOf(shape.meta) }) };
  });
