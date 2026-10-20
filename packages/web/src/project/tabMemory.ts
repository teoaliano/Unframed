import type { ChatDraft } from "../agent/store.ts";

/**
 * What a project tab keeps in memory while it is in the background: the camera the
 * canvas was at, and the unsent chat drafts. Lost on reload, like the rest of the tab store.
 */
const cameras = new Map<string, { readonly x: number; readonly y: number; readonly z: number }>();
const drafts = new Map<string, ReadonlyArray<readonly [string, ChatDraft]>>();

export const rememberCamera = (project: string, camera: { readonly x: number; readonly y: number; readonly z: number }): void => {
  cameras.set(project, { x: camera.x, y: camera.y, z: camera.z });
};

/** The camera the project's canvas was last at, or undefined when opening it for the first time since a reload. */
export const recalledCamera = (project: string): { readonly x: number; readonly y: number; readonly z: number } | undefined => cameras.get(project);

export const rememberDrafts = (project: string, entries: ReadonlyArray<readonly [string, ChatDraft]>): void => {
  if (entries.length === 0) drafts.delete(project);
  else drafts.set(project, entries);
};

/** Takes the drafts a project's chat client gave up, once: the next client of the project starts with them. */
export const takeDrafts = (project: string): ReadonlyArray<readonly [string, ChatDraft]> => {
  const kept = drafts.get(project) ?? [];
  drafts.delete(project);
  return kept;
};
