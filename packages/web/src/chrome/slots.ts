import { useSyncExternalStore, type ComponentType } from "react";
import type { Editor, TLShapeId } from "tldraw";

/** What the composer shell hands the Agent tray when the composer opens from Agent. */
export interface AgentTrayProps {
  readonly project: string;
  /** Collapses the composer back to the selection toolbar. */
  readonly close: () => void;
  /** Whether a menu of the tray is open, so the shell leaves Esc and the send key to it. */
  readonly onMenuOpen?: (key: string, open: boolean) => void;
}

/**
 * Named places in the chrome that other features fill: the Agent button, the
 * Settings button, the Library button and the Add to library handler,
 * the artifact empty state, the composer's Agent tray and the
 * toolbar's Editor action. Empty until a feature registers into them.
 */
export interface ChromeSlots {
  agentButton?: ComponentType;
  settingsButton?: ComponentType;
  libraryButton?: ComponentType;
  /** The end of the bottom bar, after tldraw's tools: the canvas registers the Library and Add. */
  toolbarEnd?: ComponentType;
  addToLibrary?: (editor: Editor) => void;
  /** The composer's Agent tray. The toolbar shows Agent only once one is registered. */
  agentTray?: ComponentType<AgentTrayProps>;
  /** The toolbar's Agent button itself, when the Agent tray draws it. */
  agentToolbarButton?: ComponentType<{ readonly onOpen: () => void }>;
  /** What Editor on a filled page or motion does. */
  openArtifact?: (editor: Editor, shapeId: TLShapeId) => void;
  /** Render for a selected motion, beside Editor. */
  renderButton?: ComponentType<{ shapeId: TLShapeId }>;
  /** Parameters for a selected page or motion, after Render. */
  parametersButton?: ComponentType<{ shapeId: TLShapeId }>;
  /** Set while the chat rail holds the right edge: the top-right card steps aside. */
  leftCardDocked?: boolean;
  /** Set while the full-screen artifact editor is open: the top-left card stays under it, docked or not. */
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
