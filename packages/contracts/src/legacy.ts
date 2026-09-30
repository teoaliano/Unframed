/**
 * Spec 11's import from the old app: the report stored with an imported project, and the
 * methods the web's loading, failure and report states use.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";

export const ImportReportItem = Schema.Struct({
  section: Schema.Literals(["changed", "notKept", "missing"]),
  text: Schema.String,
});

export const ImportReport = Schema.Struct({
  importedAt: Schema.String,
  source: Schema.Struct({
    snapshotVersion: Schema.NullOr(Schema.Number),
    journalEntriesApplied: Schema.Number,
    journalStoppedAtLine: Schema.optionalKey(Schema.Number),
  }),
  counts: Schema.Struct({
    prompts: Schema.Number,
    images: Schema.Number,
    videos: Schema.Number,
    groups: Schema.Number,
    recipeGroups: Schema.Number,
    results: Schema.Number,
    pages: Schema.Number,
    motions: Schema.Number,
    wiresRemoved: Schema.Number,
    filesExtracted: Schema.Number,
  }),
  items: Schema.Array(ImportReportItem),
  seen: Schema.Boolean,
});
export type ImportReport = typeof ImportReport.Type;

const ProjectPayload = Schema.Struct({ project: Schema.String });

/**
 * How a project's import stands, without starting it: `none` (nothing to import, or done),
 * `pending` (the folder holds an old graph and no database, or its import is running), or
 * `failed` with the sentence the person reads. The web shows its loading or failure state
 * from this before it opens the canvas.
 */
export const LegacyImportStatus = Rpc.make("legacyImport.status", {
  payload: ProjectPayload,
  success: Schema.Union([
    Schema.Struct({ state: Schema.Literals(["none", "pending"]) }),
    Schema.Struct({ state: Schema.Literal("failed"), message: Schema.String }),
  ]),
  error: UnframedError,
});

/** The report of the import that made this project, or `null` when it was never imported. Runs a pending import first. */
export const LegacyImportReport = Rpc.make("legacyImport.report", {
  payload: ProjectPayload,
  success: Schema.NullOr(ImportReport),
  error: UnframedError,
});

export const LegacyImportMarkSeen = Rpc.make("legacyImport.markSeen", {
  payload: ProjectPayload,
  success: Schema.Struct({}),
  error: UnframedError,
});

/** Reruns a failed import, and answers its report. */
export const LegacyImportRetry = Rpc.make("legacyImport.retry", {
  payload: ProjectPayload,
  success: Schema.NullOr(ImportReport),
  error: UnframedError,
});
