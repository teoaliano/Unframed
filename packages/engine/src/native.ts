import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import type { EngineIpcMessage } from "@unframed/contracts";
import { UnframedError, unframedError } from "@unframed/contracts";
import { folderPickerPlan, folderPickerResult, revealPlan, type NativeCommand } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Config } from "./services.ts";

/** The parent's IPC channel, when the process has one. */
export class Ipc extends Context.Service<Ipc, { readonly send: ((message: EngineIpcMessage) => void) | undefined }>()(
  "unframed/engine/Ipc",
) {}

const NO_PICKER = "No folder picker available here. Type the path instead.";

/** Reveal in the file manager and the folder picker: the only places the engine opens OS windows. */
export class Native extends Context.Service<
  Native,
  {
    /** `files` are absolute paths that exist. Answers the count revealed, or `"folder"`. */
    readonly reveal: (folder: string, files: ReadonlyArray<string>) => Effect.Effect<number | "folder">;
    /** Answers the chosen path, `''` when cancelled. */
    readonly pickFolder: (currentOutputDir: string) => Effect.Effect<string, UnframedError>;
  }
>()("unframed/engine/Native") {}

type Runner = {
  /** Starts a command and does not wait for it. */
  readonly launch: (command: NativeCommand) => Promise<void>;
  /** Runs a command to its end. `undefined` when it cannot be spawned. */
  readonly run: (command: NativeCommand) => Promise<{ exitCode: number | null; stdout: string } | undefined>;
};

const spawnRunner: Runner = {
  launch: async (command) => {
    const child = spawn(command.cmd, [...command.args], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  },
  run: (command) =>
    new Promise((resolve) => {
      const child = spawn(command.cmd, [...command.args], { stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
      child.on("error", () => resolve(undefined));
      child.on("close", (exitCode) => resolve({ exitCode, stdout }));
    }),
};

/** `UNFRAMED_TEST_NATIVE_LOG`: record each command as a JSON line instead of spawning it. */
const loggingRunner = (logPath: string, pickAnswer: string | undefined): Runner => {
  const record = (command: NativeCommand) =>
    appendFile(logPath, `${JSON.stringify({ cmd: command.cmd, args: command.args })}\n`);
  return {
    launch: record,
    run: async (command) => {
      await record(command);
      if (pickAnswer === "none") return undefined;
      if (pickAnswer === undefined || pickAnswer === "cancel") return { exitCode: 1, stdout: "" };
      return { exitCode: 0, stdout: `${pickAnswer}\n` };
    },
  };
};

export const nativeLayer = Layer.effect(
  Native,
  Effect.gen(function* () {
    const config = yield* Config;
    const ipc = yield* Ipc;
    const runner = config.nativeLogPath ? loggingRunner(config.nativeLogPath, config.pickFolderAnswer) : spawnRunner;
    // Gated on the variable as well as the channel: a dev run under a file watcher has a
    // channel whose parent drops unknown messages, so every reveal would go nowhere.
    const hostedSend = config.clientDist !== undefined ? ipc.send : undefined;

    const reveal = (folder: string, files: ReadonlyArray<string>) =>
      Effect.promise(async () => {
        if (hostedSend) {
          hostedSend({ type: "reveal", files: files.length > 0 ? [...files] : [folder] });
          return files.length > 0 ? files.length : ("folder" as const);
        }
        const plan = revealPlan(config.platform, files, folder);
        await runner.launch(plan.command).catch(() => {});
        return plan.revealed;
      });

    const pickFolder = (currentOutputDir: string) =>
      Effect.gen(function* () {
        const outcome = yield* Effect.promise(() =>
          runner.run(folderPickerPlan(config.platform, currentOutputDir)).catch(() => undefined),
        );
        if (outcome === undefined) return yield* unframedError("unavailable", NO_PICKER);
        return folderPickerResult(outcome.exitCode, outcome.stdout);
      });

    return Native.of({ reveal, pickFolder });
  }),
);
