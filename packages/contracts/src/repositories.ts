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
  setupChat: Schema.NullOr(Schema.String),
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

export const RepositoriesRead = Rpc.make("repositories.read", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({ repository: Schema.NullOr(Repository) }),
  error: UnframedError,
});

export const RepositoriesSetup = Rpc.make("repositories.setup", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({ chatId: Schema.NullOr(Schema.String) }),
  error: UnframedError,
});

export const RepositoriesConfirmLogin = Rpc.make("repositories.confirmLogin", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({ waiting: Schema.Boolean }),
  error: UnframedError,
});

export const RepositoriesSetupVerdict = Rpc.make("repositories.setupVerdict", {
  payload: Schema.Struct({ project: Schema.String, accepted: Schema.Boolean, note: Schema.optionalKey(Schema.String) }),
  success: Schema.Struct({ repository: Repository }),
  error: UnframedError,
});

export const ScreensExplode = Rpc.make("screens.explode", {
  payload: Schema.Struct({ project: Schema.String, shapeId: Schema.String, routes: Schema.Array(Schema.String) }),
  success: Schema.Struct({ group: Schema.String, screens: Schema.Array(Schema.String) }),
  error: UnframedError,
});

export const DiffFile = Schema.Struct({ path: Schema.String, additions: Schema.Number, deletions: Schema.Number, binary: Schema.Boolean });
export type DiffFile = typeof DiffFile.Type;

export const InstanceDiff = Schema.Struct({
  base: Schema.String,
  baseRef: Schema.String,
  files: Schema.Array(DiffFile),
  patch: Schema.String,
  truncated: Schema.Boolean,
});
export type InstanceDiff = typeof InstanceDiff.Type;

export const InstancesDiff = Rpc.make("instances.diff", { payload: InstanceRef, success: InstanceDiff, error: UnframedError });

export const GIT_ACTIONS = ["commit", "commit_push", "commit_push_pr"] as const;
export const GitAction = Schema.Literals(GIT_ACTIONS);
export type GitAction = typeof GitAction.Type;

export const GitActionResult = Schema.Struct({
  action: GitAction,
  commit: Schema.NullOr(Schema.Struct({ sha: Schema.String, subject: Schema.String })),
  push: Schema.NullOr(Schema.Struct({ remote: Schema.String, branch: Schema.String })),
  pr: Schema.NullOr(Schema.Struct({ number: Schema.Number, url: Schema.String, title: Schema.String, existing: Schema.Boolean })),
});
export type GitActionResult = typeof GitActionResult.Type;

export const InstancesGitAction = Rpc.make("instances.gitAction", {
  payload: Schema.Struct({ project: Schema.String, id: Schema.String, action: GitAction }),
  success: GitActionResult,
  error: UnframedError,
});

export const InstancesBranches = Rpc.make("instances.branches", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({ branches: Schema.Array(Schema.String), current: Schema.String }),
  error: UnframedError,
});

export const ScreenSnapshot = Schema.Struct({ shape: Schema.String, w: Schema.Number, h: Schema.Number, at: Schema.Number });
export type ScreenSnapshot = typeof ScreenSnapshot.Type;

export const ScreensSnapshots = Rpc.make("screens.snapshots", {
  payload: Schema.Struct({ project: Schema.String }),
  success: ScreenSnapshot,
  error: UnframedError,
  stream: true,
});
