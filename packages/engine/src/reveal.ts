import { stat } from "node:fs/promises";
import { join } from "node:path";
import { unframedError } from "@unframed/contracts";
import * as Effect from "effect/Effect";
import { Native } from "./native.ts";
import { fileNameOf } from "./paths.ts";
import { Projects } from "./projects.ts";
import { SettingsStore } from "./settingsStore.ts";

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const projectFolder = (project: string | undefined) =>
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    const projects = yield* Projects;
    const folder = project === undefined ? yield* settings.outputDir : yield* projects.folder(project);
    const isFolder =
      folder !== undefined && (yield* Effect.promise(() => stat(folder).then((info) => info.isDirectory(), () => false)));
    if (folder === undefined || !isFolder) return yield* unframedError("not_found", "No files for this project yet.");
    return folder;
  });

/** `files.path`: the absolute path of a file in the project folder, from its basename. */
export const filePath = (input: { readonly project: string; readonly fileName: string }) =>
  Effect.gen(function* () {
    const folder = yield* projectFolder(input.project);
    const name = fileNameOf(input.fileName);
    const path = name === undefined ? undefined : join(folder, name);
    if (path === undefined || !(yield* Effect.promise(() => exists(path)))) {
      return yield* unframedError("not_found", `No file ${input.fileName} in this project.`);
    }
    return { path };
  });

/**
 * `files.reveal`: the project folder (or the output folder when no project is named).
 * It keeps each name's basename and drops the names not on disk.
 */
export const revealFiles = (input: { readonly project?: string; readonly fileNames: ReadonlyArray<string> }) =>
  Effect.gen(function* () {
    const native = yield* Native;
    const folder = yield* projectFolder(input.project);

    const names = [
      ...new Set(input.fileNames.map(fileNameOf).filter((name): name is string => name !== undefined)),
    ];
    const files: string[] = [];
    for (const name of names) {
      const path = join(folder, name);
      if (yield* Effect.promise(() => exists(path))) files.push(path);
    }
    return { revealed: yield* native.reveal(folder, files) };
  });
