import { useSyncExternalStore, type ComponentType } from "react";
import type { Editor, TLShapeId } from "tldraw";

export interface AgentTrayProps {
  readonly project: string;
  readonly close: () => void;
  readonly onMenuOpen?: (key: string, open: boolean) => void;
}

interface ChromeSlots {
  agentButton?: ComponentType;
  settingsButton?: ComponentType;
  libraryButton?: ComponentType;
  kitButton?: ComponentType;
  toolbarEnd?: ComponentType;
  addToLibrary?: (editor: Editor) => void;
  agentTray?: ComponentType<AgentTrayProps>;
  agentToolbarButton?: ComponentType<{ readonly onOpen: () => void }>;
  openArtifact?: (editor: Editor, shapeId: TLShapeId) => void;
  renderButton?: ComponentType<{ shapeId: TLShapeId }>;
  parametersButton?: ComponentType<{ shapeId: TLShapeId }>;
  kitModeButton?: ComponentType<{ shapeId: TLShapeId }>;
  leftCardDocked?: boolean;
  artifactEditorOpen?: boolean;
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
