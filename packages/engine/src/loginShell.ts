import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { LOGIN_SHELL_ARGS, mergePath, resolveWindowsCommand, shellPathFromOutput, spawnEnvironment, type VersionRun } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { errorText } from "./log.ts";
import { Config } from "./services.ts";

const SHELL_TIMEOUT_MS = 5_000;

export type Spawned = VersionRun & { readonly stderr?: string };

export const runCommand = (
  executable: string,
  args: ReadonlyArray<string>,
  env: Record<string, string>,
  timeoutMs: number,
  cwd?: string,
): Promise<Spawned> =>
  new Promise((resolve) => {
    const [command, commandArgs] = executable.endsWith(".js") ? [process.execPath, [executable, ...args]] : [executable, [...args]];
    let settled = false;
    let output = "";
    const finish = (result: Spawned) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, commandArgs, { env, stdio: ["ignore", "pipe", "pipe"], ...(cwd === undefined ? {} : { cwd }) });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      finish(code === "ENOENT" ? { kind: "not_found" } : { kind: "spawn_failed", code: code ?? errorText(error) });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ kind: "timed_out" });
    }, timeoutMs);
    timer.unref();
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(error.code === "ENOENT" ? { kind: "not_found" } : { kind: "spawn_failed", code: error.code ?? error.message });
    });
    child.on("close", (code) => finish({ kind: "exited", code, output }));
  });

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const resolveOnPath = (
  command: string,
  path: string,
  platform: NodeJS.Platform,
  env: Record<string, string>,
  packageEntries?: ReadonlyArray<ReadonlyArray<string>>,
): string => {
  if (platform === "win32") {
    return resolveWindowsCommand(command, { pathDirs: path.split(";"), pathext: env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD", exists: existsSync }, packageEntries);
  }
  if (command.includes("/")) return command;
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }
  return command;
};

export interface SpawnSetup {
  readonly path: string;
  readonly env: Record<string, string>;
}

export class LoginShell extends Context.Service<
  LoginShell,
  {
    readonly setup: Effect.Effect<SpawnSetup>;
    readonly resolve: (command: string, packageEntries?: ReadonlyArray<ReadonlyArray<string>>) => Effect.Effect<string>;
  }
>()("unframed/engine/LoginShell") {}

export const loginShellLayer = Layer.effect(
  LoginShell,
  Effect.gen(function* () {
    const config = yield* Config;
    let hydrated: Promise<SpawnSetup> | undefined;

    const hydrate = (): Promise<SpawnSetup> => {
      hydrated ??= (async () => {
        const base = spawnEnvironment(process.env);
        const own = process.env.PATH;
        if (config.platform === "win32") return { path: own ?? "", env: { ...base, PATH: own ?? "" } };
        const shell = process.env.SHELL?.trim() || "/bin/sh";
        const answer = await runCommand(shell, LOGIN_SHELL_ARGS, base, SHELL_TIMEOUT_MS);
        const shellPath = answer.kind === "exited" && answer.code === 0 ? shellPathFromOutput(answer.output) : undefined;
        const path = mergePath(own, shellPath, delimiter);
        return { path, env: { ...base, PATH: path } };
      })();
      return hydrated;
    };

    const setup = Effect.promise(hydrate);

    return LoginShell.of({
      setup,
      resolve: (command, packageEntries) =>
        Effect.map(setup, ({ path, env }) => resolveOnPath(command, path, config.platform, env, packageEntries)),
    });
  }),
);
