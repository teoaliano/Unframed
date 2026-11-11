import type { ComponentPin } from "@unframed/contracts";
import { atom, type Atom } from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";

const stores = new Map<string, Atom<ReadonlyMap<string, ReadonlyArray<ComponentPin>>>>();

export const pinsOf = (project: string): Atom<ReadonlyMap<string, ReadonlyArray<ComponentPin>>> => {
  let found = stores.get(project);
  if (!found) {
    found = atom(`component pins ${project}`, new Map());
    stores.set(project, found);
  }
  return found;
};

export const watchComponentPins = (engine: EngineConnection, project: string): (() => void) => {
  const store = pinsOf(project);
  return engine.subscribe("component.pins", { project }, (item) => {
    const next = new Map(store.get());
    next.set(item.file, item.pins);
    store.set(next);
  });
};

export const countUsing = (project: string, tag: string, files: ReadonlyArray<string>): number => {
  const pins = pinsOf(project).get();
  return files.filter((file) => (pins.get(file) ?? []).some((pin) => pin.tag === tag)).length;
};
