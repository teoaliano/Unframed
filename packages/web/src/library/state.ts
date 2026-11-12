import { presetFromSelection, type Box, type PresetContent } from "@unframed/domain";
import { atom, type Atom, type Editor, type TLShapeId } from "tldraw";
import { featureOn } from "../features.ts";

const withoutNodes = (content: PresetContent): PresetContent => {
  const gone = new Set(content.shapes.filter((shape) => shape.type === "node" || shape.type === "wire").map((shape) => shape.id));
  if (gone.size === 0) return content;
  return { ...content, shapes: content.shapes.filter((shape) => !gone.has(shape.id)), rootShapeIds: content.rootShapeIds.filter((id) => !gone.has(id)) };
};

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
  const copied = editor.getContentFromCurrentPage(ids) as unknown as PresetContent | undefined;
  if (!copied) return undefined;
  const nodesOn = featureOn("nodes");
  const content = nodesOn ? copied : withoutNodes(copied);
  const bounds: Record<string, Box> = {};
  for (const id of content.rootShapeIds) {
    const box = editor.getShapePageBounds(id as TLShapeId);
    if (box) bounds[id] = { x: box.x, y: box.y, w: box.w, h: box.h };
  }
  const captured = { project, content: structuredClone(content), bounds };
  const made = presetFromSelection(captured, { name: "" });
  if (!made.ok) return undefined;
  const nodes = nodesOn ? content.shapes.filter((shape) => shape.type === "node").length : 0;
  return { ...captured, members: made.members, recipe: made.kind === "recipe", ...(nodes > 0 ? { flow: { ids: [...ids], nodes } } : {}) };
};
