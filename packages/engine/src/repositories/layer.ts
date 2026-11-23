import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { UnframedError, unframedError, type ProjectKind, type Repository } from "@unframed/contracts";
import {
  NO_GIT,
  NOT_A_FOLDER,
  NOT_A_REPOSITORY,
  gitRoots,
  hasUncommittedChanges,
  projectSlug,
  repositoryProjectName,
  repositoryStatus,
} from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { errorText } from "../log.ts";
import { LoginShell, runCommand, type Spawned } from "../loginShell.ts";
import { ProjectDatabase } from "../projectDatabase.ts";
import { Projects } from "../projects.ts";
import { readKind, readRepository, writeRepository, type StoredRepository } from "./tables.ts";

const GIT_TIMEOUT_MS = 15_000;

export interface AddedRepository {
  readonly name: string;
  readonly repository: Repository;
  readonly uncommitted: boolean;
}

export class Repositories extends Context.Service<
  Repositories,
  {
    readonly kinds: (projects: ReadonlyArray<string>) => Effect.Effect<Record<string, ProjectKind>>;
    readonly read: (project: string) => Effect.Effect<Repository | undefined>;
    readonly add: (path: string, name?: string) => Effect.Effect<AddedRepository, UnframedError>;
  }
>()("unframed/engine/Repositories") {}

const asRepository = (stored: StoredRepository): Repository => ({
  ...stored,
  status: repositoryStatus(stored.status, existsSync(stored.root)),
});

export const repositoriesLayer = Layer.effect(
  Repositories,
  Effect.gen(function* () {
    const database = yield* ProjectDatabase;
    const projects = yield* Projects;
    const loginShell = yield* LoginShell;

    const git = (cwd: string, args: ReadonlyArray<string>): Effect.Effect<Spawned> =>
      Effect.flatMap(Effect.all([loginShell.setup, loginShell.resolve("git")]), ([{ env }, executable]) =>
        Effect.promise(() => runCommand(executable, args, { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }, GIT_TIMEOUT_MS, cwd)),
      );

    const output = (ran: Spawned): string | undefined => (ran.kind === "exited" && ran.code === 0 ? ran.output : undefined);

    const kinds = (names: ReadonlyArray<string>) =>
      Effect.map(
        Effect.forEach(names, (name) => Effect.map(database.peek(name, readKind), (kind) => [name, kind ?? "whiteboard"] as const)),
        (entries) => Object.fromEntries(entries),
      );

    const read = (project: string) =>
      Effect.map(database.peek(project, (db) => (readKind(db) === "repository" ? readRepository(db) : undefined)), (stored) =>
        stored === undefined ? undefined : asRepository(stored),
      );

    const folderOf = (path: string) =>
      Effect.tryPromise({
        try: async () => {
          if (!isAbsolute(path)) return undefined;
          const real = await realpath(path).catch(() => undefined);
          if (real === undefined) return undefined;
          return (await stat(real)).isDirectory() ? real : undefined;
        },
        catch: (error) => unframedError("internal", `Could not read that folder: ${errorText(error)}`),
      });

    const add = (path: string, name?: string) =>
      Effect.gen(function* () {
        const folder = yield* folderOf(path.trim());
        if (folder === undefined) return yield* unframedError("bad_request", NOT_A_FOLDER);
        const roots = yield* git(folder, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"]);
        if (roots.kind === "not_found") return yield* unframedError("unavailable", NO_GIT);
        const found = gitRoots(output(roots) ?? "");
        if (found === undefined) return yield* unframedError("bad_request", NOT_A_REPOSITORY);
        const branch = output(yield* git(found.root, ["symbolic-ref", "--quiet", "--short", "HEAD"]))?.trim();
        const baseBranch = branch || output(yield* git(found.root, ["rev-parse", "HEAD"]))?.trim() || "HEAD";
        const uncommitted = hasUncommittedChanges(output(yield* git(found.root, ["status", "--porcelain"])) ?? "");
        const wanted = name === undefined || projectSlug(name) === "" ? repositoryProjectName(found.root) : name;
        const slug = yield* projects.create(wanted);
        const stored: StoredRepository = {
          root: found.root,
          gitCommonDir: found.gitCommonDir,
          baseBranch,
          status: "setting-up",
          setup: null,
          addedAt: new Date().toISOString(),
        };
        const handle = yield* database.open(slug);
        yield* Effect.try({
          try: () => writeRepository(handle.db, stored),
          catch: (error) => unframedError("internal", `Could not save the repository: ${errorText(error)}`),
        });
        return { name: slug, repository: asRepository(stored), uncommitted };
      });

    return Repositories.of({ kinds, read, add });
  }),
);
