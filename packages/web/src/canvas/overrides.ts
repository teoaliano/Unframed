import type { TLUiActionItem, TLUiOverrides, TLUiToolItem } from "tldraw";
import { addShape, type AddKind } from "./addShapes.ts";
import { ungroup, wrapSelection } from "./groups.ts";

/** Unframed's add-at-pointer keys, as tldraw spells them. */
const ADD_KEYS: ReadonlyArray<readonly [AddKind, string]> = [
  ["image", "i"],
  ["video", "u"],
  ["page", "shift+p"],
  ["motion", "shift+m"],
];

/** Every single binding in a tldraw kbd string, normalised: `!` is tldraw's old spelling of shift. */
const bindings = (kbd: string | undefined): string[] =>
  (kbd ?? "")
    .split(",")
    .map((binding) => binding.trim().toLowerCase().replace(/^!/, "shift+"))
    .filter((binding) => binding !== "");

/**
 * A key tldraw already uses stays tldraw's; Unframed's binding moves to Shift plus the same
 * letter, or goes unbound when tldraw holds that too.
 */
const unframedBinding = (wanted: string, taken: ReadonlySet<string>): string | undefined => {
  if (!taken.has(wanted)) return wanted;
  const shifted = `shift+${wanted.replace(/^shift\+/, "")}`;
  return taken.has(shifted) ? undefined : shifted;
};

let actionKeys = new Set<string>();

/**
 * Unframed's changes to tldraw's actions and tools: extra redo keys, the add-at-pointer
 * keys, and Unframed's group in place of tldraw's. Every tldraw action that would group or
 * frame the selection wraps it in an Unframed group instead, and every one that would
 * ungroup or remove a frame ungroups, so tldraw's own group shape is never made.
 */
export const overrides: TLUiOverrides = {
  // tldraw's text is Unframed's prompt and its frame is Unframed's group, everywhere they are named.
  translations: { en: { "tool.text": "Prompt", "tool.frame": "Group" } },
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
    actionKeys = new Set(Object.values(actions).flatMap((action) => bindings(action.kbd)));
    return actions;
  },
  // tldraw works out its actions before its tools, so both sets of keys are known here.
  tools(editor, tools) {
    // No Media tool (and no Cmd+U): Image and Video from Add, drop and paste bring files in.
    delete tools.asset;
    const taken = new Set([...actionKeys, ...Object.values(tools).flatMap((tool) => bindings(tool.kbd))]);
    for (const [kind, key] of ADD_KEYS) {
      const id = `unframed-add-${kind}`;
      const kbd = unframedBinding(key, taken);
      if (kbd === undefined) continue;
      const item: TLUiToolItem = {
        id,
        label: id,
        icon: "plus",
        kbd,
        onSelect: () => {
          if (editor.getEditingShapeId()) return;
          addShape(editor, kind, { at: editor.inputs.getCurrentPagePoint() });
        },
      };
      tools[id] = item;
    }
    return tools;
  },
};
