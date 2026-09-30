/**
 * Generation's shared records: the recipe schema, result meta, run markers, and the RPC
 * payloads of the catalogue and of runs. Specs 04, 05, 06 and 11 use these and do not
 * redefine them.
 */
import * as Schema from "effect/Schema";

export const Medium = Schema.Literals(["image", "video", "text"]);
export type Medium = typeof Medium.Type;

/** What a run sent, exactly: a project file (a composite names the canvas image it came from), or an https link. */
export const RecipeRef = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["image", "video"]), file: Schema.String, original: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("video"), url: Schema.String }),
]);
export type RecipeRef = typeof RecipeRef.Type;

export const RecipeAction = Schema.Literals(["regenerate", "vary", "recipe"]);
export type RecipeAction = typeof RecipeAction.Type;

const ParamValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);

/** Everything needed to repeat a run. A result's sidecar holds it. */
export const ResultRecipe = Schema.Struct({
  medium: Medium,
  model: Schema.String,
  /** The props that were sent, keyed as the medium's tray names them. */
  params: Schema.Record(Schema.String, ParamValue),
  /** The selection's composed prompt parts, joined. */
  selectionPrompt: Schema.String,
  /** The per-run instruction, `''` when none. */
  instruction: Schema.String,
  /** Exactly what was sent, in order; composites and sketches as the files that were sent. */
  references: Schema.Array(RecipeRef),
  /** The contributing shape ids. */
  sources: Schema.Array(Schema.String),
  of: Schema.optionalKey(Schema.Struct({ sidecar: Schema.String, action: RecipeAction })),
  /** Spec 11: imported from the old app, which never recorded references or the selection prompt. */
  approximate: Schema.optionalKey(Schema.Literal(true)),
  sentPrompt: Schema.optionalKey(Schema.String),
});
export type ResultRecipe = typeof ResultRecipe.Type;

/** A group's standing settings (spec 06), stored as `meta.unframed.recipe` on the group. */
export const GroupRecipe = Schema.Struct({
  medium: Medium,
  model: Schema.String,
  params: Schema.Record(Schema.String, ParamValue),
  runs: Schema.Union([Schema.Number, Schema.Literal("free")]),
});
export type GroupRecipe = typeof GroupRecipe.Type;

/** `meta.unframed.run`: set by the engine on a shape whose work is still being made. */
export const RunMarker = Schema.Struct({
  runId: Schema.String,
  /** 1-based position in its batch. */
  runIndex: Schema.Number,
  /** Epoch ms. */
  startedAt: Schema.Number,
  /** Spec 04: the work is a render job that outlives the process. */
  durable: Schema.optionalKey(
    Schema.Struct({
      params: Schema.Struct({
        prompt: Schema.String,
        model: Schema.String,
        duration: Schema.NullOr(Schema.Number),
        resolution: Schema.NullOr(Schema.String),
        size: Schema.NullOr(Schema.String),
      }),
    }),
  ),
});
export type RunMarker = typeof RunMarker.Type;

/** `meta.unframed.result`: what makes a shape a result. The recipe itself lives in the sidecar. */
export const ResultMeta = Schema.Struct({
  /** The sidecar's file name in the project folder; `null` on an unfilled placeholder. */
  sidecar: Schema.NullOr(Schema.String),
  medium: Medium,
  model: Schema.String,
  batchId: Schema.String,
  runIndex: Schema.Number,
  runCount: Schema.Number,
  cost: Schema.NullOr(Schema.Number),
  /** Shape ids, for the tether only. */
  sources: Schema.Array(Schema.String),
  /** Spec 05: a Free batch's repair call, on every member. */
  batchExtraCost: Schema.optionalKey(Schema.Number),
  /** Spec 11 only: an imported result's approximate recipe. */
  recipe: Schema.optionalKey(ResultRecipe),
});
export type ResultMeta = typeof ResultMeta.Type;

/** The Unframed fields under a shape's `meta.unframed`. Only the engine writes `run` and `runError`. */
export interface UnframedShapeMeta {
  readonly result?: ResultMeta;
  readonly run?: RunMarker;
  readonly runError?: string;
  readonly recipe?: GroupRecipe;
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/** A shape's `meta.unframed`, or an empty object. */
export const unframedMetaOf = (shape: { readonly meta?: unknown }): Record<string, unknown> => {
  const value = field(shape.meta, "unframed");
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
};

/** A shape's result meta, when it is a result or an unfilled placeholder. */
export const resultMetaOf = (shape: { readonly meta?: unknown }): ResultMeta | undefined => {
  const result = unframedMetaOf(shape).result;
  return typeof field(result, "model") === "string" ? (result as ResultMeta) : undefined;
};

/** A shape's run marker, while its work is still being made. */
export const runMarkerOf = (shape: { readonly meta?: unknown }): RunMarker | undefined => {
  const run = unframedMetaOf(shape).run;
  return typeof field(run, "runId") === "string" ? (run as RunMarker) : undefined;
};

/** The change origin of a run's placeholders and fills. */
export const runOriginId = (runId: string): string => `run:${runId}`;

/** One model. `params` is OpenRouter's typed `supported_parameters` map. */
export const ModelEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  created: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  params: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  /** Spec 04: a video model's `pricing_skus`. */
  pricing: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  /** Spec 04: whether a video model takes video input; `null` when that is unknown. */
  acceptsVideo: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});
export type ModelEntry = typeof ModelEntry.Type;

export const ModelsListRequest = Schema.Struct({ medium: Schema.Literals(["image", "video", "text"]) });

export const ModelsListAnswer = Schema.Struct({ models: Schema.Array(ModelEntry), default: Schema.String });
export type ModelsListAnswer = typeof ModelsListAnswer.Type;

/** One billing line of an endpoint's pricing. */
export const Sku = Schema.Struct({
  unit: Schema.optionalKey(Schema.String),
  billable: Schema.optionalKey(Schema.String),
  variant: Schema.optionalKey(Schema.NullOr(Schema.String)),
  cost_usd: Schema.optionalKey(Schema.Number),
});
export type Sku = typeof Sku.Type;

export const ImagePricingAnswer = Schema.Struct({ endpoints: Schema.Array(Schema.Array(Sku)) });
export type ImagePricingAnswer = typeof ImagePricingAnswer.Type;

export const ImageParams = Schema.Struct({
  resolution: Schema.optionalKey(Schema.String),
  quality: Schema.optionalKey(Schema.String),
  aspect_ratio: Schema.optionalKey(Schema.String),
  background: Schema.optionalKey(Schema.String),
  output_format: Schema.optionalKey(Schema.String),
  size: Schema.optionalKey(Schema.String),
});
export type ImageParams = typeof ImageParams.Type;

export const PageBox = Schema.Struct({ x: Schema.Number, y: Schema.Number, w: Schema.Number, h: Schema.Number });

/** How a Free section's `images:` line was read: the picks that named an image (`null` for all) and the rest. */
export const FreePicks = Schema.Struct({ picks: Schema.NullOr(Schema.Array(Schema.Number)), dropped: Schema.Array(Schema.Number) });
export type FreePicks = typeof FreePicks.Type;

export const ImageRunRequest = Schema.Struct({
  project: Schema.String,
  /** `b-<epochMs>`; minted by the engine when absent. */
  batchId: Schema.optionalKey(Schema.String),
  /** The default model when absent. */
  model: Schema.optionalKey(Schema.String),
  params: ImageParams,
  selectionPrompt: Schema.String,
  instruction: Schema.String,
  outputs: Schema.Array(
    Schema.Struct({
      prompt: Schema.String,
      references: Schema.Array(RecipeRef),
      /** Spec 05, a Free output: its own recorded selection prompt, the shared context and its section. */
      selectionPrompt: Schema.optionalKey(Schema.String),
      /** Spec 05, a Free output: the image numbers its section picked (`null` for all) and the ones that named no image. */
      free: Schema.optionalKey(FreePicks),
    }),
  ),
  sources: Schema.Array(Schema.String),
  /** Page coordinates: results land to its right. */
  anchor: PageBox,
  of: Schema.optionalKey(Schema.Struct({ shapeId: Schema.String, action: RecipeAction })),
  /** Spec 05: a Free batch's repair call cost, set on every member's result meta. */
  batchExtraCost: Schema.optionalKey(Schema.Number),
});
export type ImageRunRequest = typeof ImageRunRequest.Type;

export const RunStarted = Schema.Struct({ runId: Schema.String, batchId: Schema.String, placeholders: Schema.Array(Schema.String) });

export const RunEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("started"), runId: Schema.String, batchId: Schema.String, count: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("output"),
    runId: Schema.String,
    runIndex: Schema.Number,
    ok: Schema.Literal(true),
    shapeId: Schema.String,
    file: Schema.String,
    cost: Schema.NullOr(Schema.Number),
  }),
  Schema.Struct({ type: Schema.Literal("output"), runId: Schema.String, runIndex: Schema.Number, ok: Schema.Literal(false), error: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("finished"),
    runId: Schema.String,
    succeeded: Schema.Number,
    failed: Schema.Number,
    errors: Schema.Array(Schema.String),
    orphaned: Schema.Number,
  }),
]);
export type RunEvent = typeof RunEvent.Type;

/** The image sidecar, beside each generated image. The first block is the old app's, field for field. */
export interface ImageSidecar {
  readonly prompt: string;
  readonly model: string;
  readonly resolution?: string;
  readonly quality?: string;
  readonly aspect_ratio?: string;
  readonly output_format?: string;
  readonly background: string | null;
  readonly size?: string;
  readonly referenceCount: number;
  readonly references: { readonly images: number; readonly videos: number };
  readonly batchId: string;
  readonly runIndex: number;
  readonly runCount: number;
  readonly cost: number | null;
  readonly createdAt: string;
  readonly file: string;
  readonly recipe: ResultRecipe;
  /** Spec 05: a Free output's picks. */
  readonly free?: FreePicks;
}
