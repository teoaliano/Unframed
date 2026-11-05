import { presetFromSelection, type Box, type PresetContent } from "@unframed/domain";
import { atom, type Atom, type Editor, type TLShapeId } from "tldraw";

export interface Captured {
  readonly project: string;
  readonly content: PresetContent;
  readonly bounds: Readonly<Record<string, Box>>;
  readonly members: number;
  readonly recipe: boolean;
  readonly flow?: { readonly ids: ReadonlyArray<string>; readonly nodes: number } | undefined;
}

interface LibraryUi {
  readonly open: boolean;
  readonly saving?: Captured | undefined;
  readonly type?: "kit" | undefined;
}

const states = new WeakMap<Editor, Atom<LibraryUi>>();

export const libraryUi = (editor: Editor): Atom<LibraryUi> => {
  let state = states.get(editor);
  if (!state) {
    state = atom<LibraryUi>("library", { open: false });
    states.set(editor, state);
  }
  return state;
};

export const captureSelection = (editor: Editor, project: string): Captured | undefined => {
  const ids = editor.getSelectedShapeIds();
  const content = editor.getContentFromCurrentPage(ids) as unknown as PresetContent | undefined;
  if (!content) return undefined;
  const bounds: Record<string, Box> = {};
  for (const id of content.rootShapeIds) {
    const box = editor.getShapePageBounds(id as TLShapeId);
    if (box) bounds[id] = { x: box.x, y: box.y, w: box.w, h: box.h };
  }
  const captured = { project, content: structuredClone(content), bounds };
  const made = presetFromSelection(captured, { name: "" });
  if (!made.ok) return undefined;
  const nodes = content.shapes.filter((shape) => shape.type === "node").length;
  return { ...captured, members: made.members, recipe: made.kind === "recipe", ...(nodes > 0 ? { flow: { ids: [...ids], nodes } } : {}) };
};
