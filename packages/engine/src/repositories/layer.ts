import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { UnframedError, unframedError, type Instance, type ProjectKind, type Repository } from "@unframed/contracts";
import {
  NO_GIT,
  NOT_A_FOLDER,
  NOT_A_REPOSITORY,
  NOT_A_REPOSITORY_PROJECT,
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
import { Instances } from "../instances/layer.ts";
import { LoginShell } from "../loginShell.ts";
import { ProjectDatabase } from "../projectDatabase.ts";
import { Projects } from "../projects.ts";
import { gitOutput as output, makeGit } from "./git.ts";
import { readKind, readRepository, writeRepository, type StoredRepository } from "./tables.ts";

export interface AddedRepository {
  readonly name: string;
  readonly repository: Repository;
  readonly uncommitted: boolean;
  readonly instance: Instance;
}

export class Repositories extends Context.Service<
  Repositories,
  {
    readonly kinds: (projects: ReadonlyArray<string>) => Effect.Effect<Record<string, ProjectKind>>;
    readonly read: (project: string) => Effect.Effect<Repository | undefined>;
    readonly add: (path: string, name?: string) => Effect.Effect<AddedRepository, UnframedError>;
    readonly update: (project: string, change: (stored: StoredRepository) => StoredRepository) => Effect.Effect<Repository, UnframedError>;
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
    const instances = yield* Instances;
    const git = makeGit(yield* LoginShell);

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
          setupChat: null,
        };
        const handle = yield* database.open(slug);
        yield* Effect.try({
          try: () => writeRepository(handle.db, stored),
          catch: (error) => unframedError("internal", `Could not save the repository: ${errorText(error)}`),
        });
        const instance = yield* instances.create(slug, {});
        return { name: slug, repository: asRepository(stored), uncommitted, instance };
      });

    const update = (project: string, change: (stored: StoredRepository) => StoredRepository) =>
      Effect.gen(function* () {
        const slug = projectSlug(project);
        const known = slug === "" ? undefined : yield* database.peek(slug, (db) => (readKind(db) === "repository" ? readRepository(db) : undefined));
        if (known === undefined) return yield* unframedError("bad_request", NOT_A_REPOSITORY_PROJECT);
        const { db } = yield* database.open(slug);
        return yield* Effect.try({
          try: () => {
            const next = change(readRepository(db) ?? known);
            writeRepository(db, next);
            return asRepository(next);
          },
          catch: (error) => unframedError("internal", `Could not save the repository: ${errorText(error)}`),
        });
      });

    return Repositories.of({ kinds, read, add, update });
  }),
);
