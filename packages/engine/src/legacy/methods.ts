/** The `legacyImport.*` RPC methods (spec 11), over the project database's opener. */
import { stat } from "node:fs/promises";
import { unframedError, type UnframedError } from "@unframed/contracts";
import { projectSlug, type ImportReport } from "@unframed/domain";
import * as Effect from "effect/Effect";
import type { ProjectDatabase } from "../projectDatabase.ts";
import type { Projects } from "../projects.ts";
import { markImportReportSeen, readImportReport } from "./reportTable.ts";

export const legacyImportMethods = (database: ProjectDatabase["Service"], projects: Projects["Service"]) => {
  /** The project's slug, when its folder exists. */
  const existing = (name: string): Effect.Effect<string, UnframedError> =>
    Effect.flatMap(projects.folder(name), (folder) =>
      Effect.flatMap(
        Effect.promise(() =>
          folder === undefined
            ? Promise.resolve(false)
            : stat(folder).then(
                (info) => info.isDirectory(),
                () => false,
              ),
        ),
        (found) => (found ? Effect.succeed(projectSlug(name)) : Effect.fail(unframedError("not_found", `There is no project named "${projectSlug(name)}".`))),
      ),
    );

  const report = (slug: string): Effect.Effect<ImportReport | null, UnframedError> => Effect.map(database.open(slug), (handle) => readImportReport(handle.db));

  return {
    status: (name: string) => Effect.flatMap(existing(name), database.importState),
    report: (name: string) => Effect.flatMap(existing(name), report),
    markSeen: (name: string) =>
      Effect.flatMap(existing(name), (slug) => Effect.map(database.open(slug), (handle) => (markImportReportSeen(handle.db), {}))),
    retry: (name: string) => Effect.flatMap(existing(name), (slug) => Effect.andThen(database.retryImport(slug), report(slug))),
  };
};
