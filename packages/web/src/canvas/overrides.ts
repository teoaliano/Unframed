import type { TLUiOverrides } from "tldraw";

/**
 * Unframed's changes to tldraw's actions and tools: extra redo keys, and the actions this
 * spec replaces.
 */
export const overrides: TLUiOverrides = {
  actions(_editor, actions) {
    const redo = actions.redo;
    if (redo) redo.kbd = "cmd+shift+z,ctrl+shift+z,cmd+y,ctrl+y";
    return actions;
  },
};
