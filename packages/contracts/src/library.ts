import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";
import { Medium } from "./generation.ts";
import { KitDefinition } from "./kits.ts";

export const PresetContent = Schema.Struct({
  schema: Schema.Unknown,
  shapes: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  rootShapeIds: Schema.Array(Schema.String),
  assets: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  bindings: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
export type PresetContent = typeof PresetContent.Type;

const PresetFields = {
  format: Schema.Literal(2),
  id: Schema.String,
  source: Schema.Literals(["user", "system"]),
  savedAt: Schema.optionalKey(Schema.String),
  name: Schema.String,
  summary: Schema.String,
  legacy: Schema.optionalKey(Schema.Literal(true)),
  notes: Schema.optionalKey(Schema.Array(Schema.String)),
};

const ContentPreset = Schema.Struct({
  ...PresetFields,
  needs: Schema.optionalKey(Schema.String),
  kind: Schema.Literals(["recipe", "group", "flow"]),
  medium: Schema.optionalKey(Medium),
  content: PresetContent,
});

const KitPreset = Schema.Struct({
  ...PresetFields,
  kind: Schema.Literal("kit"),
  kit: KitDefinition,
  revision: Schema.Number,
});

export const Preset = Schema.Union([ContentPreset, KitPreset]);
export type Preset = typeof Preset.Type;

export const LibraryList = Rpc.make("library.list", {
  success: Schema.Struct({ presets: Schema.Array(Preset) }),
  error: UnframedError,
});

export const LibrarySave = Rpc.make("library.save", {
  payload: Schema.Struct({
    name: Schema.String,
    summary: Schema.String,
    needs: Schema.optionalKey(Schema.String),
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

export const PresetFileRef = Schema.Union([Schema.Struct({ project: Schema.String, file: Schema.String }), Schema.Struct({ dataUrl: Schema.String })]);
export type PresetFileRef = typeof PresetFileRef.Type;

export const CopiedPresetFile = Schema.Union([Schema.Struct({ file: Schema.String }), Schema.Struct({ missing: Schema.Literal(true) })]);
export type CopiedPresetFile = typeof CopiedPresetFile.Type;

export const LibraryCopyFiles = Rpc.make("library.copyFiles", {
  payload: Schema.Struct({ project: Schema.String, files: Schema.Array(PresetFileRef) }),
  success: Schema.Array(CopiedPresetFile),
  error: UnframedError,
});

export const KitSaveToLibrary = Rpc.make("kit.saveToLibrary", {
  payload: Schema.Struct({ project: Schema.String, name: Schema.String, summary: Schema.String }),
  success: Schema.Struct({ preset: Preset }),
  error: UnframedError,
});

export const KitUpdateInLibrary = Rpc.make("kit.updateInLibrary", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({ preset: Preset }),
  error: UnframedError,
});
