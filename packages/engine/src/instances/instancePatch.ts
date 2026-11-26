import { randomBytes } from "node:crypto";
import { copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { UnframedError } from "@unframed/contracts";
import { excludedPathspecs, parseNumstat, takeHomePathspecs } from "@unframed/domain";
import * as Effect from "effect/Effect";
import { gitFailure, gitOutput, gitStdout, type Git } from "../repositories/git.ts";

export interface PatchTarget {
  readonly worktree: string;
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly setupFiles: ReadonlyArray<string>;
}

export interface InstancePatch {
  readonly base: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly additions: number; readonly deletions: number; readonly binary: boolean }>;
  readonly patch: string;
}

export const mergeBaseOf = (git: Git, at: { readonly worktree: string; readonly baseRef: string; readonly baseCommit: string }) =>
  Effect.gen(function* () {
    for (const ref of [at.baseRef, at.baseCommit]) {
      const found = gitOutput(yield* git(at.worktree, ["merge-base", "HEAD", ref]))?.trim();
      if (found) return found;
    }
    return at.baseCommit;
  });

export const withTemporaryIndex = <A>(git: Git, worktree: string, run: (env: Record<string, string>) => Effect.Effect<A, UnframedError>) =>
  Effect.gen(function* () {
    const real = gitOutput(yield* git(worktree, ["rev-parse", "--git-path", "index"]))?.trim();
    const realIndex = real && (isAbsolute(real) ? real : join(worktree, real));
    const path = join(realIndex ? dirname(realIndex) : tmpdir(), `unframed-index-${randomBytes(6).toString("hex")}`);
    if (realIndex) yield* Effect.promise(() => copyFile(realIndex, path).catch(() => undefined));
    return yield* run({ GIT_INDEX_FILE: path }).pipe(Effect.ensuring(Effect.promise(() => Promise.all([rm(path, { force: true }), rm(`${path}.lock`, { force: true })]))));
  });

export const instancePatch = (git: Git, at: PatchTarget) =>
  Effect.gen(function* () {
    const base = yield* mergeBaseOf(git, at);
    const pathspec = ["--", ".", ...excludedPathspecs(at.setupFiles), ...takeHomePathspecs];
    return yield* withTemporaryIndex(git, at.worktree, (env) =>
      Effect.gen(function* () {
        const added = yield* git(at.worktree, ["add", "-A", ...pathspec], env);
        if (gitOutput(added) === undefined) return yield* gitFailure("Could not read the Instance's changes", added);
        const numstat = yield* git(at.worktree, ["diff", "--cached", "--no-renames", "--numstat", "-z", base, ...pathspec], env);
        const patch = yield* git(at.worktree, ["diff", "--cached", "--binary", "--no-color", "--no-ext-diff", base, ...pathspec], env);
        const numstatText = gitStdout(numstat);
        const patchText = gitStdout(patch);
        if (numstatText === undefined || patchText === undefined) return yield* gitFailure("Could not export the Instance's changes", numstatText === undefined ? numstat : patch);
        return { base, files: parseNumstat(numstatText), patch: patchText } satisfies InstancePatch;
      }),
    );
  });
