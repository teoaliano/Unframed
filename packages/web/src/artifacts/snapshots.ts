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

export const stillOf = (project: string, shapeId: string, current: string | undefined): string | undefined => {
  const key = `${project}\n${shapeId}`;
  if (current !== undefined) lastStills.set(key, current);
  return current ?? lastStills.get(key);
};

export const snapshotUrl = (project: string, snapshot: ArtifactSnapshot): string =>
  `/api/file/${encodeURIComponent(project)}/${encodeURIComponent(snapshot.file)}?snapshot=${Math.round(snapshot.w)}x${Math.round(snapshot.h)}&mode=${encodeURIComponent(snapshot.mode ?? "none")}&kit=${snapshot.kit ?? "none"}&v=${snapshot.at}`;
