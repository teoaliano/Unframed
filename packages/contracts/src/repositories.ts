import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";

export const PROJECT_KINDS = ["whiteboard", "repository"] as const;
export const ProjectKind = Schema.Literals(PROJECT_KINDS);
export type ProjectKind = typeof ProjectKind.Type;

export const RepositoryStatus = Schema.Literals(["setting-up", "ready", "missing"]);
export type RepositoryStatus = typeof RepositoryStatus.Type;

export const StoredRepositoryStatus = Schema.Literals(["setting-up", "ready"]);
export type StoredRepositoryStatus = typeof StoredRepositoryStatus.Type;

export const PortMode = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("free") }),
  Schema.Struct({ mode: Schema.Literal("single"), port: Schema.Number }),
]);
export type PortMode = typeof PortMode.Type;

export const PackageManager = Schema.Literals(["npm", "pnpm", "yarn", "bun"]);
export type PackageManager = typeof PackageManager.Type;

export const RepositorySetup = Schema.Struct({
  setupCommand: Schema.String,
  runCommand: Schema.String,
  packageManager: PackageManager,
  portMode: PortMode,
  files: Schema.Array(Schema.String),
  mocks: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.String),
});
export type RepositorySetup = typeof RepositorySetup.Type;

export const Repository = Schema.Struct({
  root: Schema.String,
  gitCommonDir: Schema.String,
  baseBranch: Schema.String,
  status: RepositoryStatus,
  setup: Schema.NullOr(RepositorySetup),
  addedAt: Schema.String,
});
export type Repository = typeof Repository.Type;

export const INSTANCE_STATES = ["creating", "installing", "starting", "live", "stopped", "failed", "removed"] as const;
export const InstanceState = Schema.Literals(INSTANCE_STATES);
export type InstanceState = typeof InstanceState.Type;

export const Instance = Schema.Struct({
  id: Schema.String,
  repository: Schema.String,
  branch: Schema.String,
  baseRef: Schema.String,
  worktree: Schema.String,
  state: InstanceState,
  proxyPort: Schema.NullOr(Schema.Number),
  upstreamPort: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
  log: Schema.String,
});
export type Instance = typeof Instance.Type;

export const RepositoriesPickFolder = Rpc.make("repositories.pickFolder", {
  success: Schema.Struct({ path: Schema.String }),
  error: UnframedError,
});

export const RepositoriesAdd = Rpc.make("repositories.add", {
  payload: Schema.Struct({ path: Schema.String, name: Schema.optionalKey(Schema.String) }),
  success: Schema.Struct({ name: Schema.String, repository: Repository, uncommitted: Schema.Boolean, instance: Instance }),
  error: UnframedError,
});

const InstanceRef = Schema.Struct({ project: Schema.String, id: Schema.String });

export const InstancesCreate = Rpc.make("instances.create", {
  payload: Schema.Struct({ project: Schema.String, base: Schema.optionalKey(Schema.String), branch: Schema.optionalKey(Schema.String) }),
  success: Instance,
  error: UnframedError,
});

export const InstancesRemove = Rpc.make("instances.remove", {
  payload: Schema.Struct({ project: Schema.String, id: Schema.String, force: Schema.optionalKey(Schema.Boolean), deleteBranch: Schema.optionalKey(Schema.Boolean) }),
  success: Instance,
  error: UnframedError,
});

export const InstancesList = Rpc.make("instances.list", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({ instances: Schema.Array(Instance) }),
  error: UnframedError,
});

export const InstancesStatus = Rpc.make("instances.status", { payload: InstanceRef, success: Instance, error: UnframedError });

export const InstancesStart = Rpc.make("instances.start", { payload: InstanceRef, success: Instance, error: UnframedError });

export const InstancesStop = Rpc.make("instances.stop", { payload: InstanceRef, success: Instance, error: UnframedError });

export const InstancesDemand = Rpc.make("instances.demand", {
  payload: Schema.Struct({ project: Schema.String, client: Schema.String, ids: Schema.Array(Schema.String) }),
  success: Schema.Struct({ instances: Schema.Array(Instance) }),
  error: UnframedError,
});

export const InstancesSubscribe = Rpc.make("instances.subscribe", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Instance,
  error: UnframedError,
  stream: true,
});
