import { useSyncExternalStore, type ComponentType } from "react";
import type { Editor } from "tldraw";

/**
 * Named places in the chrome that later specs fill: the Agent button (spec 08), the
 * Settings button (spec 10), the Library button and the Add to library handler (spec 06),
 * and the artifact empty state (spec 09). Empty until a spec registers into them.
 */
export interface ChromeSlots {
  agentButton?: ComponentType;
  settingsButton?: ComponentType;
  libraryButton?: ComponentType;
  addToLibrary?: (editor: Editor) => void;
  artifactEmptyState?: ComponentType<{ shapeId: string }>;
}

let slots: ChromeSlots = {};
const listeners = new Set<() => void>();

export const registerSlot = <K extends keyof ChromeSlots>(name: K, value: ChromeSlots[K]): (() => void) => {
  slots = { ...slots, [name]: value };
  for (const listener of listeners) listener();
  return () => {
    const { [name]: _removed, ...rest } = slots;
    slots = rest;
    for (const listener of listeners) listener();
  };
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const currentSlots = (): ChromeSlots => slots;

export const useSlots = (): ChromeSlots => useSyncExternalStore(subscribe, currentSlots);
