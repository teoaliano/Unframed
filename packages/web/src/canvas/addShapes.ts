import type { AddAction } from "@unframed/domain";
import { createShapeId, startEditingShapeWithRichText, type Editor, type TLShapeId, type VecLike } from "tldraw";

export type AddKind = "prompt" | "image" | "video" | "group" | "page" | "motion";

const SHAPE_TYPE: Record<AddKind, "text" | "image" | "video" | "frame" | "page" | "motion"> = {
  prompt: "text",
  image: "image",
  video: "video",
  group: "frame",
  page: "page",
  motion: "motion",
};

export const kindOfAddAction = (action: AddAction): AddKind => action.slice("add-".length) as AddKind;

/** Where a new shape goes: centred on a page point, or with its top-left corner at one. */
export type Placement = { readonly centre: VecLike } | { readonly at: VecLike };

/**
 * Adds an empty shape of `kind` at its default size, selected, as one undo step. A new
 * prompt starts editing. A point inside a group puts a shape that may be a member into it.
 */
export const addShape = (editor: Editor, kind: AddKind, placement: Placement): TLShapeId => {
  const id = createShapeId();
  const type = SHAPE_TYPE[kind];
  const point = "at" in placement ? placement.at : placement.centre;
  editor.markHistoryStoppingPoint(`add ${kind}`);
  editor.run(() => {
    editor.createShape({ id, type, x: point.x, y: point.y });
    const bounds = "centre" in placement ? editor.getShapePageBounds(id) : undefined;
    if (bounds) {
      const shape = editor.getShape(id)!;
      editor.updateShape({ id, type, x: shape.x - bounds.w / 2, y: shape.y - bounds.h / 2 });
    }
    editor.setCurrentTool("select");
    editor.select(id);
  });
  if (kind === "prompt") startEditingShapeWithRichText(editor, id);
  return id;
};

/** The centre of what is on screen, in page space. */
export const viewportCentre = (editor: Editor): VecLike => editor.getViewportPageBounds().center;
