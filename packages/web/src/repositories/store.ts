import type { Instance, Repository, ScreenSnapshot } from "@unframed/contracts";
import { atom, type Atom } from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";

export interface RepositoryState {
  readonly repository: Atom<Repository | null | undefined>;
  readonly instances: Atom<ReadonlyMap<string, Instance>>;
  readonly loaded: Atom<boolean>;
  readonly snapshots: Atom<ReadonlyMap<string, ScreenSnapshot>>;
  readonly bridges: Atom<ReadonlyMap<string, boolean>>;
}

const states = new Map<string, RepositoryState>();

export const repositoryState = (project: string): RepositoryState => {
  let found = states.get(project);
  if (!found) {
    found = {
      repository: atom(`repository ${project}`, undefined),
      instances: atom(`instances ${project}`, new Map()),
      loaded: atom(`instances loaded ${project}`, false),
      snapshots: atom(`screen snapshots ${project}`, new Map()),
      bridges: atom(`screen bridges ${project}`, new Map()),
    };
    states.set(project, found);
  }
  return found;
};

const putInstance = (state: RepositoryState, instance: Instance) => state.instances.set(new Map(state.instances.get()).set(instance.id, instance));

export const watchRepository = (engine: EngineConnection, project: string): (() => void) => {
  const state = repositoryState(project);
  let stopped = false;
  let stopInstances: (() => void) | undefined;
  void engine
    .call("repositories.read", { project })
    .then(async ({ repository }) => {
      if (stopped) return;
      state.repository.set(repository);
      if (repository === null) return;
      stopInstances = engine.subscribe("instances.subscribe", { project }, (instance) => putInstance(state, instance));
      const { instances } = await engine.call("instances.list", { project });
      if (stopped) return;
      for (const instance of instances) if (!state.instances.get().has(instance.id)) putInstance(state, instance);
      state.loaded.set(true);
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    stopInstances?.();
  };
};

export const refreshRepository = async (engine: EngineConnection, project: string): Promise<void> => {
  const { repository } = await engine.call("repositories.read", { project });
  repositoryState(project).repository.set(repository);
};

export const watchScreenSnapshots = (engine: EngineConnection, project: string): (() => void) => {
  const store = repositoryState(project).snapshots;
  return engine.subscribe("screens.snapshots", { project }, (snapshot) => {
    const known = store.get().get(snapshot.shape);
    if (known && known.at >= snapshot.at) return;
    store.set(new Map(store.get()).set(snapshot.shape, snapshot));
  });
};

export const screenSnapshotUrl = (project: string, snapshot: ScreenSnapshot): string =>
  `/api/file/${encodeURIComponent(project)}/${encodeURIComponent(snapshot.shape.replace(/^shape:/, ""))}.png?screen=1&v=${snapshot.at}`;

export const noteBridge = (project: string, shapeId: string, bridge: boolean): void => {
  const { bridges } = repositoryState(project);
  if (bridges.get().get(shapeId) === bridge) return;
  bridges.set(new Map(bridges.get()).set(shapeId, bridge));
};
