import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { unframedError } from "@unframed/contracts";
import * as Effect from "effect/Effect";
import { Native } from "./native.ts";
import { Projects } from "./projects.ts";
import { SettingsStore } from "./settingsStore.ts";

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * `files.reveal`: the project folder (or the output folder when no project is named).
 * Each name is reduced to its basename and names not on disk are dropped.
 */
export const revealFiles = (input: { readonly project?: string; readonly fileNames: ReadonlyArray<string> }) =>
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    const projects = yield* Projects;
    const native = yield* Native;
    const folder = input.project === undefined ? yield* settings.outputDir : yield* projects.folder(input.project);
    const isFolder =
      folder !== undefined && (yield* Effect.promise(() => stat(folder).then((info) => info.isDirectory(), () => false)));
    if (folder === undefined || !isFolder) return yield* unframedError("not_found", "No files for this project yet.");

    const names = [...new Set(input.fileNames.map((name) => basename(name)))].filter(
      (name) => name !== "" && name !== "." && name !== "..",
    );
    const files: string[] = [];
    for (const name of names) {
      const path = join(folder, name);
      if (yield* Effect.promise(() => exists(path))) files.push(path);
    }
    return { revealed: yield* native.reveal(folder, files) };
  });
