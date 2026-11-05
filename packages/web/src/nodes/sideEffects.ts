import { getIndexAbove, getIndicesAbove, type Editor, type IndexKey, type TLPageId, type TLShape, type TLShapeId } from "tldraw";
import {isNodeShape, isWireShape, type NodeShape, type WireShape } from "./facts.ts";

const RUN_OWNED = ["versions", "run"] as const;
const SETTINGS = ["medium", "model", "params", "runs", "instruction"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const installNodeSideEffects = (editor: Editor): (() => void) => {
  const pageId = (): TLPageId => editor.getCurrentPageId();
  let issued: IndexKey | undefined;
  const raising: TLShapeId[] = [];
  const raise = (id: TLShapeId) => {
    raising.push(id);
    if (raising.length > 1) return;
    queueMicrotask(() => {
      const page = pageId();
      const wires = raising.splice(0).flatMap((each) => {
        const wire = editor.getShape(each);
        return wire ? [wire] : [];
      });
      const others = editor.getSortedChildIdsForParent(page).filter((each) => !wires.some((wire) => wire.id === each));
      const highest = others.length === 0 ? null : editor.getShape(others.at(-1)!)!.index;
      if (wires.every((wire) => highest === null || wire.index > highest)) return;
      const indices = getIndicesAbove(highest, wires.length);
      const ordered = [...wires].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
      editor.run(() => editor.updateShapes(ordered.map((wire, at) => ({ id: wire.id, type: "wire", index: indices[at]! }))), { history: "ignore" });
    });
  };
  const topIndex = (page: TLPageId): IndexKey => {
    const highest = editor.getHighestIndexForParent(page);
    const next = issued !== undefined && issued >= highest ? getIndexAbove(issued) : highest;
    issued = next;
    queueMicrotask(() => (issued = undefined));
    return next;
  };
  const stops = [
    editor.sideEffects.registerBeforeChangeHandler("shape", (previous: TLShape, next: TLShape, source) => {
      if (isWireShape(next)) {
        const page = pageId();
        if (next.parentId === page && next.x === 0 && next.y === 0 && next.rotation === 0) return next;
        return { ...next, parentId: page, x: 0, y: 0, rotation: 0 } as WireShape;
      }
      if (source !== "user" || !isNodeShape(next) || !isNodeShape(previous)) return next;
      let props = next.props;
      for (const key of RUN_OWNED) {
        if (!same(previous.props[key], props[key])) {
          const { [key]: _dropped, ...rest } = props;
          props = (previous.props[key] === undefined ? rest : { ...rest, [key]: previous.props[key] }) as NodeShape["props"];
        }
      }
      if (props.error !== undefined && SETTINGS.some((key) => !same(previous.props[key], props[key]))) {
        const { error: _error, ...rest } = props;
        props = rest as NodeShape["props"];
      }
      return props === next.props ? next : ({ ...next, props } as NodeShape);
    }),
    editor.sideEffects.registerBeforeCreateHandler("shape", (shape: TLShape) => {
      if (!isWireShape(shape)) return shape;
      const page = pageId();
      if (shape.parentId === page && shape.x === 0 && shape.y === 0) return shape;
      return { ...shape, parentId: page, x: 0, y: 0, rotation: 0, index: topIndex(page) } as WireShape;
    }),
    editor.sideEffects.registerAfterCreateHandler("shape", (shape: TLShape, source) => {
      if (source !== "user" || !isWireShape(shape)) return;
      raise(shape.id);
      const { from, to } = shape.props;
      const ends = editor.getShape(from as TLShapeId) !== undefined && isNodeShape(editor.getShape(to as TLShapeId));
      const twin = editor.getCurrentPageShapes().some((other) => other.id !== shape.id && isWireShape(other) && other.props.from === from && other.props.to === to);
      if (!ends || twin) queueMicrotask(() => editor.getShape(shape.id) && editor.deleteShapes([shape.id]));
    }),
    editor.sideEffects.registerAfterDeleteHandler("shape", (shape: TLShape, source) => {
      if (source !== "user" || isWireShape(shape)) return;
      const wires = editor
        .getCurrentPageShapes()
        .filter((other): other is WireShape => isWireShape(other) && (other.props.from === shape.id || other.props.to === shape.id))
        .map((wire) => wire.id);
      if (wires.length > 0) editor.deleteShapes(wires);
    }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
};
