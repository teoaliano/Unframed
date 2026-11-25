import { useContext } from "react";
import { useMaybeEditor, type Editor, type TLAsset, type TLAssetId, type TLParentId, type TLShape, type TLShapeId } from "tldraw";
import { CanvasDocContext, type CanvasDoc } from "./doc.ts";

export type CanvasReader = Pick<Editor, "getShape" | "getAsset" | "getSelectedShapeIds" | "getSelectedShapes" | "getSortedChildIdsForParent" | "getCurrentPageShapesSorted">;

const readers = new WeakMap<CanvasDoc, CanvasReader>();

const idOf = <T extends string>(value: T | { readonly id: T }): T => (typeof value === "string" ? value : value.id);

export const canvasReaderOf = (doc: CanvasDoc): CanvasReader => {
  let reader = readers.get(doc);
  if (!reader) {
    reader = {
      getShape: ((id: TLShapeId | TLShape) => doc.store.get(idOf(id))) as CanvasReader["getShape"],
      getAsset: ((id: TLAssetId | TLAsset) => doc.store.get(idOf(id))) as CanvasReader["getAsset"],
      getSelectedShapeIds: () => doc.selectedShapeIds(),
      getSelectedShapes: () => doc.selectedShapeIds().flatMap((id) => doc.store.get(id) ?? []),
      getSortedChildIdsForParent: ((parent: TLParentId | TLShape) => doc.childrenOf(idOf(parent)).map((shape) => shape.id)) as CanvasReader["getSortedChildIdsForParent"],
      getCurrentPageShapesSorted: () => doc.pageShapes(),
    };
    readers.set(doc, reader);
  }
  return reader;
};

export const useCanvasReader = (): CanvasReader | null => {
  const editor = useMaybeEditor();
  const doc = useContext(CanvasDocContext);
  return editor ?? (doc ? canvasReaderOf(doc) : null);
};
