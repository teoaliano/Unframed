/** Whether the Kit dialog is open on one canvas (spec 19). */
import type { KitPreset } from "@unframed/domain";
import { atom, type Atom, type Editor } from "tldraw";

export interface KitUi {
  readonly open: boolean;
  /** The library kit a project is updating from, while the Update from kit dialog is up (spec 19). */
  readonly merging?: KitPreset | undefined;
}

const states = new WeakMap<Editor, Atom<KitUi>>();

export const kitUi = (editor: Editor): Atom<KitUi> => {
  let state = states.get(editor);
  if (!state) {
    state = atom<KitUi>("kit", { open: false });
    states.set(editor, state);
  }
  return state;
};
