import * as Effect from "effect/Effect";
import { runCommand, type Spawned, type SpawnSetup } from "../loginShell.ts";

const GIT_TIMEOUT_MS = 60_000;

export type Git = (cwd: string, args: ReadonlyArray<string>, extraEnv?: Record<string, string>) => Effect.Effect<Spawned>;

export const makeGit =
  (loginShell: { readonly setup: Effect.Effect<SpawnSetup>; readonly resolve: (command: string) => Effect.Effect<string> }): Git =>
  (cwd, args, extraEnv = {}) =>
    Effect.flatMap(Effect.all([loginShell.setup, loginShell.resolve("git")]), ([{ env }, executable]) =>
      Effect.promise(() => runCommand(executable, args, { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", ...extraEnv }, GIT_TIMEOUT_MS, cwd)),
    );

export const gitOutput = (ran: Spawned): string | undefined => (ran.kind === "exited" && ran.code === 0 ? ran.output : undefined);

export const gitStdout = (ran: Spawned): string | undefined => (ran.kind === "exited" && ran.code === 0 ? (ran.stdout ?? ran.output) : undefined);
