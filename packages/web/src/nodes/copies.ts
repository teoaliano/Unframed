import { createBindingId, createShapeId, type Editor, type TLContent, type TLShape, type TLShapeId } from "tldraw";
import { featureOn } from "../features.ts";
import { isWireShape, type WireShape } from "./facts.ts";

const wiresBetween = (editor: Editor, ids: ReadonlySet<string>): WireShape[] =>
  editor.getCurrentPageShapes().filter((shape): shape is WireShape => isWireShape(shape) && !ids.has(shape.id) && ids.has(shape.props.from) && ids.has(shape.props.to));

const sameCopy = (a: TLShape, b: TLShape) => a.type === b.type && JSON.stringify(a.props) === JSON.stringify(b.props);

const NODE_KINDS = new Set(["node", "wire"]);

const withoutNodes = (content: TLContent): TLContent => {
  const gone = new Set(content.shapes.filter((shape) => NODE_KINDS.has(shape.type)).map((shape) => shape.id as string));
  if (gone.size === 0) return content;
  return {
    ...content,
    shapes: content.shapes.filter((shape) => !gone.has(shape.id)),
    rootShapeIds: content.rootShapeIds.filter((id) => !gone.has(id)),
    bindings: (content.bindings ?? []).filter((binding) => !gone.has(binding.fromId) && !gone.has(binding.toId)),
  };
};

export const installWireCopies = (editor: Editor): (() => void) => {
  const getContent = editor.getContentFromCurrentPage.bind(editor);
  const putContent = editor.putContentOntoCurrentPage.bind(editor);
  const duplicate = editor.duplicateShapes.bind(editor);

  editor.getContentFromCurrentPage = ((ids: Parameters<Editor["getContentFromCurrentPage"]>[0]) => {
    const content = getContent(ids);
    if (!content) return content;
    const wires = wiresBetween(editor, new Set(content.shapes.map((shape) => shape.id)));
    if (wires.length === 0) return content;
    return { ...content, shapes: [...content.shapes, ...wires], rootShapeIds: [...content.rootShapeIds, ...wires.map((wire) => wire.id)] };
  }) as Editor["getContentFromCurrentPage"];

  editor.putContentOntoCurrentPage = ((given: TLContent, options: Parameters<Editor["putContentOntoCurrentPage"]>[1] = {}) => {
    const content = featureOn("nodes") ? given : withoutNodes(given);
    if (options.preserveIds === true || !content.shapes.some((shape) => shape.type === "wire")) return putContent(content, options);
    const ids = new Map<string, TLShapeId>(content.shapes.map((shape) => [shape.id, createShapeId()]));
    const kept = content.shapes.filter((shape) => !isWireShape(shape) || (ids.has(shape.props.from) && ids.has(shape.props.to) && !content.shapes.some((other) => other.id === shape.props.from && isWireShape(other))));
    const shapes = kept.map((shape) => {
      const moved = { ...shape, id: ids.get(shape.id)!, parentId: (ids.get(shape.parentId) ?? shape.parentId) as TLShape["parentId"] } as TLShape;
      return isWireShape(shape) ? ({ ...moved, props: { ...shape.props, from: ids.get(shape.props.from)!, to: ids.get(shape.props.to)! } } as TLShape) : moved;
    });
    const keptIds = new Set(kept.map((shape) => shape.id));
    const bindings = (content.bindings ?? [])
      .filter((binding) => keptIds.has(binding.fromId) && keptIds.has(binding.toId))
      .map((binding) => ({ ...binding, id: createBindingId(), fromId: ids.get(binding.fromId)!, toId: ids.get(binding.toId)! }));
    const rootShapeIds = content.rootShapeIds.filter((id) => keptIds.has(id)).map((id) => ids.get(id)!);
    return putContent({ ...content, shapes, bindings, rootShapeIds }, { ...options, preserveIds: true });
  }) as Editor["putContentOntoCurrentPage"];

  editor.duplicateShapes = ((given: Parameters<Editor["duplicateShapes"]>[0], offset?: Parameters<Editor["duplicateShapes"]>[1]) => {
    const all = (given as ReadonlyArray<TLShapeId | TLShape>).map((each) => (typeof each === "string" ? editor.getShape(each) : each)).filter((each): each is TLShape => each !== undefined);
    const originals = featureOn("nodes") ? all : all.filter((shape) => !NODE_KINDS.has(shape.type));
    const shapes = (featureOn("nodes") ? given : originals) as Parameters<Editor["duplicateShapes"]>[0];
    if (originals.length === 0) return editor;
    const before = new Set(editor.getCurrentPageShapeIds());
    const result = duplicate(shapes, offset);
    const made = editor.getCurrentPageShapes().filter((shape) => !before.has(shape.id));
    const copies = new Map<string, TLShapeId>();
    const used = new Set<string>();
    for (const original of originals) {
      const copy = made.find((shape) => !used.has(shape.id) && sameCopy(shape, original));
      if (!copy) continue;
      used.add(copy.id);
      copies.set(original.id, copy.id);
    }
    const wires = wiresBetween(editor, new Set(copies.keys()));
    if (wires.length > 0) {
      editor.createShapes(wires.map((wire) => ({ id: createShapeId(), type: "wire", parentId: editor.getCurrentPageId(), x: 0, y: 0, props: { ...wire.props, from: copies.get(wire.props.from)!, to: copies.get(wire.props.to)! }, meta: wire.meta })));
    }
    return result;
  }) as Editor["duplicateShapes"];

  return () => {
    editor.getContentFromCurrentPage = getContent as Editor["getContentFromCurrentPage"];
    editor.putContentOntoCurrentPage = putContent as Editor["putContentOntoCurrentPage"];
    editor.duplicateShapes = duplicate as Editor["duplicateShapes"];
  };
};
