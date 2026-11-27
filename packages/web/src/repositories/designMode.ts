import { atom, type Atom } from "tldraw";
import type { SourceEdit } from "@unframed/contracts";
import type { DraftChange } from "@unframed/domain";
import type { SessionStep } from "../artifacts/editor/editSession.ts";
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

export interface KeptDrafts {
  readonly steps: readonly SessionStep[];
  readonly drafts: ReadonlyMap<SourceEdit, DraftChange>;
  readonly count: number;
}

const kept = new Map<string, Atom<ReadonlyMap<string, KeptDrafts>>>();

export const keptDraftsOf = (project: string): Atom<ReadonlyMap<string, KeptDrafts>> => {
  let found = kept.get(project);
  if (found === undefined) {
    found = atom(`kept design drafts ${project}`, new Map());
    kept.set(project, found);
  }
  return found;
};

export const keepDrafts = (project: string, screen: string, drafts: KeptDrafts | undefined): void => {
  const store = keptDraftsOf(project);
  const current = store.get();
  if (drafts === undefined && !current.has(screen)) return;
  const next = new Map(current);
  if (drafts === undefined || drafts.steps.length === 0) next.delete(screen);
  else next.set(screen, drafts);
  store.set(next);
};
