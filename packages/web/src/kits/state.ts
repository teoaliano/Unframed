import type { KitPreset } from "@unframed/domain";
import { atom, type Atom, type Editor } from "tldraw";

export interface KitUi {
  readonly open: boolean;
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
