/** The markdown window's state on one canvas: the style shape it shows, if any. */
import { atom, type Atom, type Editor, type TLShapeId } from "tldraw";

const windows = new WeakMap<Editor, Atom<TLShapeId | undefined>>();

export const styleWindow = (editor: Editor): Atom<TLShapeId | undefined> => {
  let state = windows.get(editor);
  if (!state) {
    state = atom<TLShapeId | undefined>("style window", undefined);
    windows.set(editor, state);
  }
  return state;
};

/** Opens the markdown window on a style shape, selected alone. */
export const openStyleWindow = (editor: Editor, shapeId: TLShapeId): void => {
  if (editor.getShape(shapeId)?.type !== "style") return;
  editor.select(shapeId);
  styleWindow(editor).set(shapeId);
};
