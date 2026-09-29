/**
 * The library's state on one canvas: whether the Library dialog is open, and the selection
 * "Add to library" captured when it was clicked, so edits made while its dialog is open
 * are not saved.
 */
import { presetFromSelection, type Box, type PresetContent } from "@unframed/domain";
import { atom, type Atom, type Editor, type TLShapeId } from "tldraw";

export interface Captured {
  readonly project: string;
  /** tldraw's own copy of the selection, roots in page space. */
  readonly content: PresetContent;
  /** The page bounds of each root, for the wrap rule. */
  readonly bounds: Readonly<Record<string, Box>>;
  /** How many shapes the preset holds, and whether its recipe goes with it: the save dialog's subtitle. */
  readonly members: number;
  readonly recipe: boolean;
}

export interface LibraryUi {
  readonly open: boolean;
  readonly saving?: Captured | undefined;
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

/** The selection as a preset would hold it, captured now. Undefined when it cannot become one group. */
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
  return { ...captured, members: made.members, recipe: made.kind === "recipe" };
};
