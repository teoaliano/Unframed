import type { TLUiActionItem, TLUiOverrides } from "tldraw";
import { ungroup, wrapSelection } from "./groups.ts";

/**
 * Unframed's changes to tldraw's actions and tools: extra redo keys, and Unframed's group
 * in place of tldraw's. Every tldraw action that would group or frame the selection wraps
 * it in an Unframed group instead, and every one that would ungroup or remove a frame
 * ungroups, so tldraw's own group shape is never made.
 */
export const overrides: TLUiOverrides = {
  actions(editor, actions) {
    const redo = actions.redo;
    if (redo) redo.kbd = "cmd+shift+z,ctrl+shift+z,cmd+y,ctrl+y";
    const replace = (id: string, onSelect: TLUiActionItem["onSelect"]) => {
      const action = actions[id];
      if (action) actions[id] = { ...action, onSelect };
    };
    const group = () => {
      if (editor.getEditingShapeId() || !editor.isIn("select")) return;
      wrapSelection(editor);
    };
    const ungroupSelection = () => {
      if (editor.getEditingShapeId() || !editor.isIn("select")) return;
      ungroup(editor, editor.getSelectedShapeIds());
    };
    replace("group", group);
    replace("frame-selection", group);
    replace("ungroup", ungroupSelection);
    replace("remove-frame", ungroupSelection);
    return actions;
  },
};
