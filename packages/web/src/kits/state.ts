import type { KitPreset } from "@unframed/domain";
import { atom, type Atom, type TLStore } from "tldraw";

interface KitUi {
  readonly open: boolean;
  readonly merging?: KitPreset | undefined;
}

const states = new WeakMap<TLStore, Atom<KitUi>>();

export const kitUi = (owner: { readonly store: TLStore }): Atom<KitUi> => {
  let state = states.get(owner.store);
  if (!state) {
    state = atom<KitUi>("kit", { open: false });
    states.set(owner.store, state);
  }
  return state;
};
