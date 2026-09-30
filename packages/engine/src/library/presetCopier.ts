/**
 * The preset media copier (spec 06): brings every file a preset points at into the project
 * it is inserted into, each under a new name with a copy sidecar naming where it came from.
 * A file that is gone, or whose project is gone, answers `missing`, so its shape arrives
 * empty instead of failing the insert. A converted old preset (spec 11) may carry bytes as
 * a `data:` URL instead, written into the project with a `legacy-preset` sidecar.
 */
import { isBareFileName, unframedError, type CopiedPresetFile, type PresetFileRef, type UnframedError } from "@unframed/contracts";
import { parseDataUrl, projectSlug } from "@unframed/domain";
import * as Effect from "effect/Effect";
import type { MediaStore } from "../media/mediaStore.ts";
import { errorText } from "../log.ts";

export const NOT_A_FILE_MESSAGE = "That is not a file in this project.";

async function* once(bytes: Uint8Array): AsyncIterable<Buffer> {
  yield Buffer.from(bytes);
}

export const copyPresetFiles = (
  media: MediaStore["Service"],
  project: string,
  files: ReadonlyArray<PresetFileRef>,
): Effect.Effect<CopiedPresetFile[], UnframedError> =>
  Effect.gen(function* () {
    if (files.some((each) => "file" in each && !isBareFileName(each.file))) return yield* unframedError("bad_request", NOT_A_FILE_MESSAGE);
    const target = yield* Effect.promise(() => media.folder(project));
    if (target === undefined) return yield* unframedError("not_found", `There is no project named "${projectSlug(project)}".`);
    const copied: CopiedPresetFile[] = [];
    for (const each of files) {
      if ("dataUrl" in each) {
        const parsed = parseDataUrl(each.dataUrl);
        if (!parsed) {
          copied.push({ missing: true });
          continue;
        }
        const saved = yield* Effect.tryPromise({
          try: () => media.save(project, { originalName: "", mime: parsed.mime, body: once(parsed.bytes), source: "legacy-preset" }),
          catch: (error) => unframedError("internal", `Could not save the file: ${errorText(error)}`),
        });
        copied.push({ file: saved.file });
        continue;
      }
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
