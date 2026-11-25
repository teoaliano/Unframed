import type { KitPreset } from "@unframed/domain";
import { atom, type Atom, type TLStore } from "tldraw";
import type { StoreOwner } from "../canvas/doc.ts";

interface KitUi {
  readonly open: boolean;
  readonly merging?: KitPreset | undefined;
}

const states = new WeakMap<TLStore, Atom<KitUi>>();

export const kitUi = (owner: StoreOwner): Atom<KitUi> => {
  let state = states.get(owner.store);
  if (!state) {
    state = atom<KitUi>("kit", { open: false });
    states.set(owner.store, state);
  }
  return state;
};
