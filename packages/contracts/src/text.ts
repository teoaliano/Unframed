/**
 * Spec 05's text calls: a text run, which lands its answer on the canvas as a text result,
 * and a text completion, which lands nothing (Free's repair call).
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";
import { PageBox, RecipeAction, RecipeRef, RunStarted, type ResultRecipe } from "./generation.ts";

export const TextRunRequest = Schema.Struct({
  project: Schema.String,
  /** The default text model when absent. */
  model: Schema.optionalKey(Schema.String),
  /** The selection's composed prompt parts, joined: for the recipe. */
  selectionPrompt: Schema.String,
  instruction: Schema.String,
  /** What is sent: the parts and the instruction, joined. */
  prompt: Schema.String,
  references: Schema.Array(RecipeRef),
  sources: Schema.Array(Schema.String),
  /** Page coordinates: the result lands to its right. */
  anchor: PageBox,
  of: Schema.optionalKey(Schema.Struct({ shapeId: Schema.String, action: RecipeAction })),
});
export type TextRunRequest = typeof TextRunRequest.Type;

export const TextCompleteRequest = Schema.Struct({
  project: Schema.String,
  prompt: Schema.String,
  /** Sent as a system message first when it is not blank. Only Free's repair sends one. */
  system: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  references: Schema.optionalKey(Schema.Array(RecipeRef)),
  /** The batch the call is part of, for its sidecar. */
  batchId: Schema.optionalKey(Schema.String),
});
export type TextCompleteRequest = typeof TextCompleteRequest.Type;

export const TextCompleteAnswer = Schema.Struct({ text: Schema.String, cost: Schema.NullOr(Schema.Number) });
export type TextCompleteAnswer = typeof TextCompleteAnswer.Type;

/** Starts a text run. Answers once its placeholder is in the room; the outcome arrives on `run.subscribe`. */
export const RunText = Rpc.make("run.text", {
  payload: TextRunRequest,
  success: RunStarted,
  error: UnframedError,
});

/** One text call that lands nothing on the canvas. It still leaves a sidecar with its cost. */
export const TextComplete = Rpc.make("text.complete", {
  payload: TextCompleteRequest,
  success: TextCompleteAnswer,
  error: UnframedError,
});

/**
 * The sidecar of every text call, `<stamp>-text-<slug>.json`. The first block is the old
 * app's, field for field; `recipe` is present only for runs that landed a text result.
 */
export interface TextSidecar {
  readonly kind: "text";
  readonly prompt: string;
  readonly model: string;
  readonly result: string;
  readonly referenceCount: number;
  readonly references: { readonly images: number; readonly videos: number };
  readonly batchId: string | null;
  readonly cost: number | null;
  readonly createdAt: string;
  readonly recipe?: ResultRecipe;
}
