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

export const RepositoriesPickFolder = Rpc.make("repositories.pickFolder", {
  success: Schema.Struct({ path: Schema.String }),
  error: UnframedError,
});

export const RepositoriesAdd = Rpc.make("repositories.add", {
  payload: Schema.Struct({ path: Schema.String, name: Schema.optionalKey(Schema.String) }),
  success: Schema.Struct({ name: Schema.String, repository: Repository, uncommitted: Schema.Boolean }),
  error: UnframedError,
});
