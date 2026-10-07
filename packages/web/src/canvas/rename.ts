/**
 * Naming a shape (spec 02 and 06): the one shape whose label is a name field right now, the
 * F2 binding and the double-click on a label that open it, and the commit, which renames
 * the shape and rewrites every prompt that references it in one undo step. Any shape with
 * an `@id` can be named. The naming rules are the domain's.
 */
import { planRename, readRef, rewriteRichTextTokens } from "@unframed/domain";
import { atom, type Atom, type Editor, type TLShape, type TLShapeId, type TLShapePartial, type TLTextShape } from "tldraw";
import { canvasShapes } from "../generate/facts.ts";

const renaming = new WeakMap<Editor, Atom<TLShapeId | undefined>>();

/** The shape whose name field is open, if any. One per canvas. */
export const renamingShape = (editor: Editor): Atom<TLShapeId | undefined> => {
  let value = renaming.get(editor);
  if (!value) {
    value = atom<TLShapeId | undefined>("renaming shape", undefined);
    renaming.set(editor, value);
  }
  return value;
};

export const canRename = (shape: TLShape | undefined): shape is TLShape => shape !== undefined && readRef(shape) !== undefined;

export const startRename = (editor: Editor, id: TLShapeId): void => {
  if (!canRename(editor.getShape(id))) return;
  editor.select(id);
  renamingShape(editor).set(id);
};

/** Closes the name field and gives the keyboard back to the canvas. */
export const stopRename = (editor: Editor): void => {
  renamingShape(editor).set(undefined);
  editor.focus();
};

/**
 * Renames shape `id` to the slug of `typed`, suffixed while another `@id` holds it, and
 * rewrites the prompts that reference it, as one undo step. Nothing changes for an empty
 * slug or the current name.
 */
export const renameShape = (editor: Editor, id: TLShapeId, typed: string): boolean => {
  const shape = editor.getShape(id);
  const plan = shape ? planRename(canvasShapes(editor), id, typed) : undefined;
  if (!shape || !plan) return false;
  const ids = { [plan.from]: plan.to };
  editor.markHistoryStoppingPoint("rename");
  editor.run(() => {
    if (shape.type === "frame") editor.updateShape({ id, type: "frame", props: { name: plan.to } });
    else
      editor.updateShape({
        id,
        type: shape.type,
        meta: { ...shape.meta, ref: plan.to },
        ...(plan.title === undefined ? {} : { props: { title: plan.title } }),
      } as TLShapePartial);
    for (const rewrite of plan.rewrites) {
      const prompt = editor.getShape<TLTextShape>(rewrite.id as TLShapeId);
      if (prompt?.type !== "text") continue;
      editor.updateShape<TLTextShape>({ id: prompt.id, type: "text", props: { richText: rewriteRichTextTokens(prompt.props.richText, ids) } });
    }
  });
  return true;
};

const pressed = new WeakMap<Editor, { readonly id: TLShapeId; readonly button: number; readonly at: number }>();

/**
 * A press on a shape's label. Answers whether it is the second left press on the same label
 * within tldraw's double-click time: a double-click on a label is a rename. The label
 * decides this itself, because tldraw hit-tests a double-click again at the pointer, and a
 * label outside its shape's bounds is not part of any shape there.
 */
export const pressLabel = (editor: Editor, id: TLShapeId, button: number): boolean => {
  const last = pressed.get(editor);
  const now = performance.now();
  const second = button === 0 && last?.id === id && last.button === 0 && now - last.at < editor.options.doubleClickDurationMs;
  pressed.set(editor, second ? { id, button: -1, at: now } : { id, button, at: now });
  return second;
};

/** The shape whose label took the latest right press, if that was a moment ago: what the context menu opened on. */
export const labelJustRightClicked = (editor: Editor): TLShapeId | undefined => {
  const last = pressed.get(editor);
  return last?.button === 2 && performance.now() - last.at < editor.options.doubleClickDurationMs ? last.id : undefined;
};

const typingSomewhere = (): boolean => {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.closest("input, textarea, select, [contenteditable='true']") !== null;
};

/** F2 opens the name field while exactly one shape with an `@id` is selected. Cmd-R would reload the page. */
export const installRename = (editor: Editor): (() => void) => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "F2" || event.metaKey || event.ctrlKey || event.altKey || typingSomewhere()) return;
    if (editor.getEditingShapeId() !== null || !editor.isIn("select.idle")) return;
    const only = editor.getOnlySelectedShape();
    if (!canRename(only ?? undefined)) return;
    event.preventDefault();
    startRename(editor, only!.id);
  };
  window.addEventListener("keydown", onKeyDown);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    renamingShape(editor).set(undefined);
  };
};
