import { randomBytes } from "node:crypto";
import { copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { UnframedError, unframedError, type InstanceDiff } from "@unframed/contracts";
import { INSTANCE_REMOVED, NOT_A_REPOSITORY_PROJECT, excludedPathspecs, limitPatch, parseNumstat, projectSlug } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { LoginShell } from "../loginShell.ts";
import { ProjectDatabase } from "../projectDatabase.ts";
import { gitOutput, gitStdout, makeGit } from "../repositories/git.ts";
import { Repositories } from "../repositories/layer.ts";
import { Instances } from "./layer.ts";
import { readInstances } from "./tables.ts";

export class InstanceGit extends Context.Service<
  InstanceGit,
  {
    readonly diff: (project: string, id: string) => Effect.Effect<InstanceDiff, UnframedError>;
  }
>()("unframed/engine/InstanceGit") {}

export interface InstanceTarget {
  readonly slug: string;
  readonly worktree: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly setupFiles: ReadonlyArray<string>;
  readonly baseBranch: string;
}

export const instanceGitLayer = Layer.effect(
  InstanceGit,
  Effect.gen(function* () {
    const instances = yield* Instances;
    const repositories = yield* Repositories;
    const database = yield* ProjectDatabase;
    const git = makeGit(yield* LoginShell);

    const target = (project: string, id: string) =>
      Effect.gen(function* () {
        const slug = projectSlug(project);
        const repository = yield* repositories.read(slug);
        if (repository === undefined) return yield* unframedError("bad_request", NOT_A_REPOSITORY_PROJECT);
        const instance = yield* instances.status(slug, id);
        if (instance.state === "removed") return yield* unframedError("conflict", INSTANCE_REMOVED);
        const stored = (yield* database.peek(slug, readInstances))?.find((candidate) => candidate.id === id);
        return {
          slug,
          worktree: instance.worktree,
          branch: instance.branch,
          baseRef: instance.baseRef,
          baseCommit: stored?.baseCommit ?? instance.baseRef,
          setupFiles: repository.setup?.files ?? [],
          baseBranch: repository.baseBranch,
        } satisfies InstanceTarget;
      });

    const failed = (what: string, ran: { readonly kind: string; readonly output?: string }) =>
      unframedError("internal", `${what}: ${ran.output?.trim() || ran.kind}`);

    const mergeBase = (at: InstanceTarget) =>
      Effect.gen(function* () {
        for (const ref of [at.baseRef, at.baseCommit]) {
          const found = gitOutput(yield* git(at.worktree, ["merge-base", "HEAD", ref]))?.trim();
          if (found) return found;
        }
        return at.baseCommit;
      });

    const withTemporaryIndex = <A>(at: InstanceTarget, run: (env: Record<string, string>) => Effect.Effect<A, UnframedError>) =>
      Effect.gen(function* () {
        const real = gitOutput(yield* git(at.worktree, ["rev-parse", "--git-path", "index"]))?.trim();
        const path = join(tmpdir(), `unframed-index-${randomBytes(6).toString("hex")}`);
        if (real) yield* Effect.promise(() => copyFile(isAbsolute(real) ? real : join(at.worktree, real), path).catch(() => undefined));
        return yield* run({ GIT_INDEX_FILE: path }).pipe(Effect.ensuring(Effect.promise(() => rm(path, { force: true }))));
      });

    const diff = (project: string, id: string) =>
      Effect.gen(function* () {
        const at = yield* target(project, id);
        const base = yield* mergeBase(at);
        const paths = ["--", ".", ...excludedPathspecs(at.setupFiles)];
        return yield* withTemporaryIndex(at, (env) =>
          Effect.gen(function* () {
            const added = yield* git(at.worktree, ["add", "-A", ...paths], env);
            if (gitOutput(added) === undefined) return yield* failed("Could not read the Instance's changes", added);
            const numstat = yield* git(at.worktree, ["diff", "--cached", "--no-renames", "--numstat", "-z", base, ...paths], env);
            const patch = yield* git(at.worktree, ["diff", "--cached", "--no-renames", "--no-color", "--no-ext-diff", base, ...paths], env);
            const numstatText = gitStdout(numstat);
            const patchText = gitStdout(patch);
            if (numstatText === undefined) return yield* failed("Could not diff the Instance", numstat);
            if (patchText === undefined) return yield* failed("Could not diff the Instance", patch);
            return { base, baseRef: at.baseRef, files: parseNumstat(numstatText), ...limitPatch(patchText) } satisfies InstanceDiff;
          }),
        );
      });

    return InstanceGit.of({ diff });
  }),
);
