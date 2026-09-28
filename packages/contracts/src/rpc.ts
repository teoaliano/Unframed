import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { UnframedError } from "./errors.ts";
import { ImagePricingAnswer, ImageRunRequest, ModelsListAnswer, ModelsListRequest, ResultRecipe, RunEvent, RunStarted } from "./generation.ts";
import { Health, Settings, SettingsPatch } from "./settings.ts";
import { VideoForget, VideoPoll, VideoStart } from "./video.ts";

const Empty = Schema.Struct({});

export const ServerHealth = Rpc.make("server.health", {
  success: Health,
  error: UnframedError,
});

export const SettingsGet = Rpc.make("settings.get", {
  success: Settings,
  error: UnframedError,
});

export const SettingsUpdate = Rpc.make("settings.update", {
  payload: SettingsPatch,
  success: Settings,
  error: UnframedError,
});

/** The current settings first, then one value per change from any source. */
export const SettingsSubscribe = Rpc.make("settings.subscribe", {
  success: Settings,
  error: UnframedError,
  stream: true,
});

/** `path` is `''` when the person cancelled the dialog. */
export const SettingsPickFolder = Rpc.make("settings.pickFolder", {
  success: Schema.Struct({ path: Schema.String }),
  error: UnframedError,
});

export const ProjectsList = Rpc.make("projects.list", {
  success: Schema.Struct({ projects: Schema.Array(Schema.String) }),
  error: UnframedError,
});

/** Answers the slug the name became. */
export const ProjectsCreate = Rpc.make("projects.create", {
  payload: Schema.Struct({ name: Schema.String }),
  success: Schema.Struct({ name: Schema.String }),
  error: UnframedError,
});

export const FilesReveal = Rpc.make("files.reveal", {
  payload: Schema.Struct({
    project: Schema.optionalKey(Schema.String),
    fileNames: Schema.Array(Schema.String),
  }),
  success: Schema.Struct({
    revealed: Schema.Union([Schema.Number, Schema.Literal("folder")]),
  }),
  error: UnframedError,
});

const PreferenceKeys = Schema.Struct({
  keys: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const PreferencesGet = Rpc.make("preferences.get", {
  payload: PreferenceKeys,
  success: Schema.Struct({ values: Schema.Record(Schema.String, Schema.Unknown) }),
  error: UnframedError,
});

/** A `null` value deletes the key. */
export const PreferencesSet = Rpc.make("preferences.set", {
  payload: Schema.Struct({ key: Schema.String, value: Schema.Unknown }),
  success: Empty,
  error: UnframedError,
});

export const PreferenceChange = Schema.Struct({ key: Schema.String, value: Schema.Unknown });
export type PreferenceChange = typeof PreferenceChange.Type;

/**
 * The current value of each key first (`null` for a key with no value), then one per
 * change from any socket. Without `keys`, every stored key and then every change.
 */
export const PreferencesSubscribe = Rpc.make("preferences.subscribe", {
  payload: PreferenceKeys,
  success: PreferenceChange,
  error: UnframedError,
  stream: true,
});

/** Copies a bare file name from `from` (default `project`) into `project` with a copy sidecar. */
export const FilesCopy = Rpc.make("files.copy", {
  payload: Schema.Struct({
    project: Schema.String,
    file: Schema.String,
    from: Schema.optionalKey(Schema.String),
  }),
  success: Schema.Struct({ file: Schema.String }),
  error: UnframedError,
});

/** A canvas change for the engine-side write: whole records to put and ids to remove. */
export const CanvasChangePayload = Schema.Struct({
  put: Schema.Array(Schema.Unknown),
  remove: Schema.Array(Schema.String),
});

const CanvasOrigin = Schema.Struct({ kind: Schema.Literals(["server", "system"]), id: Schema.String });

// Test-only: answered only when the engine runs with UNFRAMED_TEST_CANVAS=1 (spec 01's
// table of test-only variables), so the engine seam can reach the room's engine-side
// interface. Otherwise every one answers `unavailable`.

export const TestCanvasRead = Rpc.make("testCanvas.read", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({ clock: Schema.Number, records: Schema.Array(Schema.Unknown) }),
  error: UnframedError,
});

export const TestCanvasApply = Rpc.make("testCanvas.apply", {
  payload: Schema.Struct({ project: Schema.String, change: CanvasChangePayload, origin: CanvasOrigin }),
  success: Schema.Struct({ clock: Schema.Number, inverse: CanvasChangePayload }),
  error: UnframedError,
});

export const TestCanvasChangedSince = Rpc.make("testCanvas.changedSince", {
  payload: Schema.Struct({ project: Schema.String, recordIds: Schema.Array(Schema.String), clock: Schema.Number }),
  success: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  error: UnframedError,
});

/** The catalogue for a medium, newest data from OpenRouter; on any upstream failure only the default model. */
export const ModelsList = Rpc.make("models.list", {
  payload: ModelsListRequest,
  success: ModelsListAnswer,
  error: UnframedError,
});

/** One SKU list per endpoint of an image model; empty on any upstream failure. */
export const ModelsImagePricing = Rpc.make("models.imagePricing", {
  payload: Schema.Struct({ id: Schema.String }),
  success: ImagePricingAnswer,
  error: UnframedError,
});

/** Starts an image run. Answers once its placeholders are in the room; outputs arrive on `run.subscribe`. */
export const RunImage = Rpc.make("run.image", {
  payload: ImageRunRequest,
  success: RunStarted,
  error: UnframedError,
});

/** A result's recipe, from its sidecar. */
export const RecipeRead = Rpc.make("recipe.read", {
  payload: Schema.Struct({ project: Schema.String, shapeId: Schema.String }),
  success: ResultRecipe,
  error: UnframedError,
});

/**
 * A result pasted into another project brings its recipe: the sidecar and every file the
 * recipe names are copied from `from` into `project`, beside `file` (the image's copy).
 */
export const RecipeCopy = Rpc.make("recipe.copy", {
  payload: Schema.Struct({ project: Schema.String, from: Schema.String, sidecar: Schema.String, file: Schema.String }),
  success: Schema.Struct({ sidecar: Schema.String }),
  error: UnframedError,
});

/** Run events of one project, as they happen. */
export const RunSubscribe = Rpc.make("run.subscribe", {
  payload: Schema.Struct({ project: Schema.String }),
  success: RunEvent,
  error: UnframedError,
  stream: true,
});

export const UnframedRpcs = RpcGroup.make(
  ServerHealth,
  SettingsGet,
  SettingsUpdate,
  SettingsSubscribe,
  SettingsPickFolder,
  ProjectsList,
  ProjectsCreate,
  FilesReveal,
  PreferencesGet,
  PreferencesSet,
  PreferencesSubscribe,
  FilesCopy,
  TestCanvasRead,
  TestCanvasApply,
  TestCanvasChangedSince,
  ModelsList,
  ModelsImagePricing,
  RunImage,
  RecipeRead,
  RecipeCopy,
  RunSubscribe,
  VideoStart,
  VideoPoll,
  VideoForget,
);
export type UnframedRpcs = typeof UnframedRpcs;
