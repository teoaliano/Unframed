/** Whether the Kit dialog is open on one canvas (spec 19). */
import { atom, type Atom, type Editor } from "tldraw";

export interface KitUi {
  readonly open: boolean;
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
