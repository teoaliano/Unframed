/**
 * The preset media copier (spec 06): brings every file a preset points at into the project
 * it is inserted into, each under a new name with a copy sidecar naming where it came from.
 * A file that is gone, or whose project is gone, answers `missing`, so its shape arrives
 * empty instead of failing the insert.
 */
import { isBareFileName, unframedError, type CopiedPresetFile, type UnframedError } from "@unframed/contracts";
import { projectSlug } from "@unframed/domain";
import * as Effect from "effect/Effect";
import type { MediaStore } from "../media/mediaStore.ts";

export const NOT_A_FILE_MESSAGE = "That is not a file in this project.";

export const copyPresetFiles = (
  media: MediaStore["Service"],
  project: string,
  files: ReadonlyArray<{ readonly project: string; readonly file: string }>,
): Effect.Effect<CopiedPresetFile[], UnframedError> =>
  Effect.gen(function* () {
    if (files.some((each) => !isBareFileName(each.file))) return yield* unframedError("bad_request", NOT_A_FILE_MESSAGE);
    const target = yield* Effect.promise(() => media.folder(project));
    if (target === undefined) return yield* unframedError("not_found", `There is no project named "${projectSlug(project)}".`);
    const copied: CopiedPresetFile[] = [];
    for (const each of files) {
      // An empty project is spec 11's converted preset: the file is in the project it goes into.
      const from = each.project === "" ? project : each.project;
      const answer = yield* media.copy(project, each.file, from, from).pipe(
        Effect.map((file): CopiedPresetFile => ({ file })),
        Effect.catchIf(
          (error) => error.code === "not_found" || error.code === "bad_request",
          () => Effect.succeed<CopiedPresetFile>({ missing: true }),
        ),
      );
      copied.push(answer);
    }
    return copied;
  });
