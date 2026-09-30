import { mayBeGroupMember, wrapBox } from "@unframed/domain";
import { createShapeId, getIndexBetween, type Editor, type IndexKey, type TLShape, type TLShapeId } from "tldraw";

const compact = <T>(values: ReadonlyArray<T | undefined | null>): T[] => values.filter((value): value is T => value != null);

const isGroup = (shape: TLShape | undefined): shape is TLShape<"frame"> => shape?.type === "frame";

/** The page-level shape a shape sits under: itself on the page, else its group. */
const pageLevel = (editor: Editor, shape: TLShape): TLShape => {
  let current = shape;
  for (let parent = editor.getShape(current.parentId as TLShapeId); parent; parent = editor.getShape(parent.parentId as TLShapeId)) current = parent;
  return current;
};

/** An index directly below `shape` among its page siblings. */
const indexBelow = (editor: Editor, shape: TLShape): IndexKey => {
  const siblings = editor.getSortedChildIdsForParent(shape.parentId);
  const below = siblings[siblings.indexOf(shape.id) - 1];
  return getIndexBetween(below ? editor.getShape(below)?.index : undefined, shape.index);
};

/**
 * Wraps the selected shapes that may be members in a new group around them, named with the
 * next ref, and selects it alone. Members keep their place on screen; members of another
 * group move into the new one. Does nothing when no selected shape may be a member.
 */
export const wrapSelection = (editor: Editor): TLShapeId | undefined => {
  const members = editor.getSelectedShapes().filter((shape) => mayBeGroupMember(shape.type));
  const box = wrapBox(compact(members.map((shape) => editor.getShapePageBounds(shape))));
  if (!box) return undefined;
  const lowest = members.map((shape) => pageLevel(editor, shape)).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))[0]!;
  const id = createShapeId();
  editor.markHistoryStoppingPoint("group");
  editor.run(() => {
    editor.createShape({ id, type: "frame", parentId: editor.getCurrentPageId(), index: indexBelow(editor, lowest), x: box.x, y: box.y, props: { w: box.w, h: box.h, name: "" } });
    editor.reparentShapes(members, id);
    editor.select(id);
  });
  return id;
};

/**
 * Removes groups and leaves their members where they are on screen, in the group's place in
 * the stacking order, selected.
 */
export const ungroup = (editor: Editor, ids: ReadonlyArray<TLShapeId>): void => {
  const groups = compact(ids.map((id) => editor.getShape(id))).filter(isGroup);
  if (groups.length === 0) return;
  editor.markHistoryStoppingPoint("ungroup");
  editor.run(() => {
    const freed: TLShapeId[] = [];
    for (const group of groups) {
      const children = editor.getSortedChildIdsForParent(group.id);
      editor.reparentShapes(children, group.parentId, group.index);
      freed.push(...children);
    }
    editor.deleteShapes(groups.map((group) => group.id));
    editor.select(...freed);
  });
};
