import { atom, type Atom } from "tldraw";
import type { ScreenEditHooks } from "./ScreenView.tsx";

export interface DesignEntry {
  readonly screen: string;
  readonly at: { readonly x: number; readonly y: number } | undefined;
}

export interface DesignHooks {
  readonly screen: string;
  readonly edit: ScreenEditHooks;
}

const entries = new Map<string, Atom<DesignEntry | undefined>>();
const hooks = new Map<string, Atom<DesignHooks | undefined>>();
const drafts = new Map<string, Atom<number>>();

export const designDraftsOf = (project: string): Atom<number> => {
  let found = drafts.get(project);
  if (found === undefined) {
    found = atom(`design drafts ${project}`, 0);
    drafts.set(project, found);
  }
  return found;
};

export const designOf = (project: string): Atom<DesignEntry | undefined> => {
  let found = entries.get(project);
  if (found === undefined) {
    found = atom(`design mode ${project}`, undefined);
    entries.set(project, found);
  }
  return found;
};

export const designHooksOf = (project: string): Atom<DesignHooks | undefined> => {
  let found = hooks.get(project);
  if (found === undefined) {
    found = atom(`design hooks ${project}`, undefined);
    hooks.set(project, found);
  }
  return found;
};

export const enterDesign = (project: string, screen: string, at?: { readonly x: number; readonly y: number }): void => {
  const current = designOf(project).get();
  if (current?.screen === screen) return;
  designOf(project).set({ screen, at });
};

export const leaveDesign = (project: string): void => {
  if (designOf(project).get() !== undefined) designOf(project).set(undefined);
};

export const designScreen = (project: string): string | undefined => designOf(project).get()?.screen;
