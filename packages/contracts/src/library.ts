/**
 * Spec 06's library: presets, the saved groups that live in `presets.json` at the root of
 * the output folder, and the copier that brings a preset's files into a project.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";
import { Medium } from "./generation.ts";

/**
 * tldraw content as tldraw's own copy produces it: the records of one group and its
 * members, their assets and bindings, and the schema they were written with.
 */
export const PresetContent = Schema.Struct({
  schema: Schema.Unknown,
  shapes: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  rootShapeIds: Schema.Array(Schema.String),
  assets: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  bindings: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
export type PresetContent = typeof PresetContent.Type;

/** One entry of `presets.json`. Entries without `format: 2` are not this version's and are never listed. */
export const Preset = Schema.Struct({
  format: Schema.Literal(2),
  /** `"user-"` and the save's epoch ms in base 36; system presets use fixed ids. */
  id: Schema.String,
  /** Only `"user"` is ever stored. */
  source: Schema.Literals(["user", "system"]),
  /** ISO time, set by the engine at save. */
  savedAt: Schema.optionalKey(Schema.String),
  name: Schema.String,
  summary: Schema.String,
  /** What to do after inserting it, shown on the card. */
  needs: Schema.optionalKey(Schema.String),
  kind: Schema.Literals(["recipe", "group"]),
  /** The recipe's medium; absent for a plain group. */
  medium: Schema.optionalKey(Medium),
  content: PresetContent,
});
export type Preset = typeof Preset.Type;

/** The user presets. A damaged `presets.json` fails rather than reading as empty. */
export const LibraryList = Rpc.make("library.list", {
  success: Schema.Struct({ presets: Schema.Array(Preset) }),
  error: UnframedError,
});

/** Saves a new preset first in the file. The engine derives its kind and medium and mints its id and time. */
export const LibrarySave = Rpc.make("library.save", {
  payload: Schema.Struct({
    name: Schema.String,
    summary: Schema.String,
    needs: Schema.optionalKey(Schema.String),
    /** Checked by the engine, so a content that is not one group answers the person's message. */
    content: Schema.Unknown,
  }),
  success: Schema.Struct({ preset: Preset }),
  error: UnframedError,
});

export const LibraryDelete = Rpc.make("library.delete", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
  error: UnframedError,
});

/** A file a preset points at: `project` is the one it was saved from, `''` for the target project. */
export const PresetFileRef = Schema.Struct({ project: Schema.String, file: Schema.String });

export const CopiedPresetFile = Schema.Union([Schema.Struct({ file: Schema.String }), Schema.Struct({ missing: Schema.Literal(true) })]);
export type CopiedPresetFile = typeof CopiedPresetFile.Type;

/** Copies each file into `project` under a new name, one answer per file, in order. */
export const LibraryCopyFiles = Rpc.make("library.copyFiles", {
  payload: Schema.Struct({ project: Schema.String, files: Schema.Array(PresetFileRef) }),
  success: Schema.Array(CopiedPresetFile),
  error: UnframedError,
});
