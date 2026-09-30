/**
 * Video generation's shared records (spec 04): the render job RPC payloads and the video
 * sidecar. The recipe, result meta and run marker are spec 03's.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";
import { PageBox, ResultRecipe } from "./generation.ts";

export const VideoInputMode = Schema.Literals(["reference", "first_frame", "first_last"]);
export type VideoInputMode = typeof VideoInputMode.Type;

/** One reference as OpenRouter's video endpoint takes it. */
export type VideoReference =
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } }
  | { readonly type: "video_url"; readonly video_url: { readonly url: string } };

/** One frame of an image-to-video request. */
export interface FrameReference {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
  readonly frame_type: "first_frame" | "last_frame";
}

/** A render job's params: what the job record and a render placeholder's marker both hold. */
export const RenderParams = Schema.Struct({
  prompt: Schema.String,
  model: Schema.String,
  duration: Schema.NullOr(Schema.Number),
  resolution: Schema.NullOr(Schema.String),
  size: Schema.NullOr(Schema.String),
});
export type RenderParams = typeof RenderParams.Type;

export const VideoStartRequest = Schema.Struct({
  project: Schema.String,
  prompt: Schema.String,
  /** `VideoReference[]`. A null or non-list value counts as empty. */
  input_references: Schema.optionalKey(Schema.Unknown),
  /** `FrameReference[]`. A null or non-list value counts as empty. */
  frame_images: Schema.optionalKey(Schema.Unknown),
  model: Schema.optionalKey(Schema.String),
  duration: Schema.optionalKey(Schema.Number),
  resolution: Schema.optionalKey(Schema.String),
  aspect_ratio: Schema.optionalKey(Schema.String),
  size: Schema.optionalKey(Schema.String),
  generate_audio: Schema.optionalKey(Schema.Boolean),
  /** The share consent, sent with every request; the engine never remembers it. */
  shareLocalVideos: Schema.optionalKey(Schema.Boolean),
  landing: PageBox,
  recipe: ResultRecipe,
});
export type VideoStartRequest = typeof VideoStartRequest.Type;

export const VideoStarted = Schema.Struct({ jobId: Schema.String, status: Schema.String, shapeId: Schema.String });

export const VideoPollRequest = Schema.Struct({ jobId: Schema.String, project: Schema.String, params: RenderParams });

export const VideoPollAnswer = Schema.Union([
  Schema.Struct({ status: Schema.Literal("completed"), cost: Schema.NullOr(Schema.Number), savedPath: Schema.String, url: Schema.String }),
  Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }),
  /** Still rendering: the upstream status as it came, so an unusual one reads as unusual. */
  Schema.Struct({ status: Schema.String, progress: Schema.NullOr(Schema.Number) }),
]);
export type VideoPollAnswer = typeof VideoPollAnswer.Type;

export const VideoForgetRequest = Schema.Struct({ project: Schema.String, jobId: Schema.String });

/** The sidecar beside every collected clip. The first ten fields are the old app's. */
export interface VideoSidecar {
  readonly kind: "video";
  readonly prompt: string;
  readonly model: string;
  readonly duration: number | null;
  readonly resolution: string | null;
  readonly size: string | null;
  readonly aspect_ratio: string | null;
  readonly generate_audio: boolean | null;
  readonly inputMode: VideoInputMode;
  readonly references: { readonly images: number; readonly videos: number; readonly frames: number } | null;
  /** The upstream usage block, verbatim: the only evidence that footage was consumed. */
  readonly usage: object | null;
  readonly cost: number | null;
  readonly createdAt: string;
  readonly file: string;
  readonly jobId: string;
  readonly recipe: ResultRecipe;
}

/**
 * Starts a render job. Answers once the job exists upstream, its pending record is written
 * and its render placeholder is in the room. Failures carry `details.reason`.
 */
export const VideoStart = Rpc.make("video.start", {
  payload: VideoStartRequest,
  success: VideoStarted,
  error: UnframedError,
});

/** Asks about one render job, collecting its clip when it has finished. */
export const VideoPoll = Rpc.make("video.poll", {
  payload: VideoPollRequest,
  success: VideoPollAnswer,
  error: UnframedError,
});

/** Stops tracking a render job on the canvas. The render is not cancelled. */
export const VideoForget = Rpc.make("video.forget", {
  payload: VideoForgetRequest,
  success: Schema.Struct({}),
  error: UnframedError,
});
