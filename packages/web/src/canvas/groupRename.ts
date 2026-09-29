/**
 * Renaming a group (spec 06): the one group whose label is a name field right now, the F2
 * binding that opens it, and the commit, which renames the group and rewrites every prompt
 * that references it in one undo step. The naming rules are the domain's.
 */
import { planGroupRename, rewriteRichTextTokens } from "@unframed/domain";
import { atom, type Atom, type Editor, type TLShapeId, type TLTextShape } from "tldraw";
import { canvasShapes } from "../generate/facts.ts";

const renaming = new WeakMap<Editor, Atom<TLShapeId | undefined>>();

/** The group whose name field is open, if any. One per canvas. */
export const renamingGroup = (editor: Editor): Atom<TLShapeId | undefined> => {
  let value = renaming.get(editor);
  if (!value) {
    value = atom<TLShapeId | undefined>("renaming group", undefined);
    renaming.set(editor, value);
  }
  return value;
};

export const startRename = (editor: Editor, id: TLShapeId): void => {
  if (editor.getShape(id)?.type !== "frame") return;
  editor.select(id);
  renamingGroup(editor).set(id);
};

/** Closes the name field and gives the keyboard back to the canvas. */
export const stopRename = (editor: Editor): void => {
  renamingGroup(editor).set(undefined);
  editor.focus();
};

/**
 * Renames group `id` to the slug of `typed`, suffixed while another `@id` holds it, and
 * rewrites the prompts that reference it, as one undo step. Nothing changes for an empty
 * slug or the current name.
 */
export const renameGroup = (editor: Editor, id: TLShapeId, typed: string): boolean => {
  const plan = planGroupRename(canvasShapes(editor), id, typed);
  if (!plan) return false;
  const ids = { [plan.from]: plan.to };
  editor.markHistoryStoppingPoint("rename group");
  editor.run(() => {
    editor.updateShape({ id, type: "frame", props: { name: plan.to } });
    for (const rewrite of plan.rewrites) {
      const prompt = editor.getShape<TLTextShape>(rewrite.id as TLShapeId);
      if (prompt?.type !== "text") continue;
      editor.updateShape<TLTextShape>({ id: prompt.id, type: "text", props: { richText: rewriteRichTextTokens(prompt.props.richText, ids) } });
    }
  });
  return true;
};

const typingSomewhere = (): boolean => {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.closest("input, textarea, select, [contenteditable='true']") !== null;
};

/** F2 opens the name field while exactly one group is selected. Cmd-R would reload the page. */
export const installGroupRename = (editor: Editor): (() => void) => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "F2" || event.metaKey || event.ctrlKey || event.altKey || typingSomewhere()) return;
    if (editor.getEditingShapeId() !== null || !editor.isIn("select.idle")) return;
    const only = editor.getOnlySelectedShape();
    if (only?.type !== "frame") return;
    event.preventDefault();
    startRename(editor, only.id);
  };
  window.addEventListener("keydown", onKeyDown);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    renamingGroup(editor).set(undefined);
  };
};
