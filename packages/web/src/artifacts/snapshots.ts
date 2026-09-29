/**
 * The snapshots the engine keeps of a project's artifacts (spec 09): the newest one of each
 * artifact file, from the engine's `artifact.snapshots` stream. A snapshot is a still that
 * runs nothing, which is what an artifact that is not live shows.
 */
import type { ArtifactSnapshot } from "@unframed/contracts";
import { atom, type Atom } from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";

const stores = new Map<string, Atom<ReadonlyMap<string, ArtifactSnapshot>>>();

export const snapshotsOf = (project: string): Atom<ReadonlyMap<string, ArtifactSnapshot>> => {
  let found = stores.get(project);
  if (!found) {
    found = atom(`snapshots ${project}`, new Map());
    stores.set(project, found);
  }
  return found;
};

/** Follows the project's snapshots for as long as its canvas is open. */
export const watchSnapshots = (engine: EngineConnection, project: string): (() => void) => {
  const store = snapshotsOf(project);
  return engine.subscribe("artifact.snapshots", { project }, (snapshot) => {
    const known = store.get().get(snapshot.file);
    if (known && known.at >= snapshot.at) return;
    const next = new Map(store.get());
    next.set(snapshot.file, snapshot);
    store.set(next);
  });
};

const lastStills = new Map<string, string>();

/**
 * The still a shape shows: its file's newest snapshot, else the last one it showed. Kept here
 * rather than in the component, because the still unmounts whenever the shape goes live.
 */
export const stillOf = (project: string, shapeId: string, current: string | undefined): string | undefined => {
  const key = `${project}\n${shapeId}`;
  if (current !== undefined) lastStills.set(key, current);
  return current ?? lastStills.get(key);
};

/** A snapshot's picture, served from the project's cache folder by the app's file route. */
export const snapshotUrl = (project: string, snapshot: ArtifactSnapshot): string =>
  `/api/file/${encodeURIComponent(project)}/${encodeURIComponent(snapshot.file)}?snapshot=${Math.round(snapshot.w)}x${Math.round(snapshot.h)}&v=${snapshot.at}`;
