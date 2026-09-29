/** Artifacts (spec 09): motion uploads, motion renders and artifact snapshots. */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";

/** A composition dropped onto a motion: saved as an upload, with the runtime and bridge tags in. */
export const MotionUpload = Rpc.make("motion.upload", {
  payload: Schema.Struct({ project: Schema.String, fileName: Schema.String, html: Schema.String }),
  success: Schema.Struct({ file: Schema.String, fileName: Schema.String, bytes: Schema.Number, mime: Schema.Literal("text/html") }),
  error: UnframedError,
});

export const RenderState = Schema.Literals(["queued", "rendering", "done", "failed"]);
export type RenderState = typeof RenderState.Type;

/** Starts a render of a motion's composition. Answers once the render's placeholder is in the room. */
export const MotionRenderStart = Rpc.make("motion.renderStart", {
  payload: Schema.Struct({
    project: Schema.String,
    file: Schema.String,
    title: Schema.optionalKey(Schema.String),
    dials: Schema.optionalKey(Schema.Unknown),
    shapeId: Schema.String,
  }),
  success: Schema.Struct({ id: Schema.String, status: RenderState, placeholder: Schema.String }),
  error: UnframedError,
});

export const RenderStatus = Schema.Struct({
  id: Schema.String,
  file: Schema.String,
  status: RenderState,
  /** 0 to 100, never decreasing, at most 99 until done. */
  progress: Schema.Number,
  message: Schema.String,
  /** The placed MP4's name, once done. */
  output: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type RenderStatus = typeof RenderStatus.Type;

export const MotionRenderStatus = Rpc.make("motion.renderStatus", {
  payload: Schema.Struct({ project: Schema.String, id: Schema.String }),
  success: RenderStatus,
  error: UnframedError,
});

/** One snapshot in a project's cache folder: the artifact file it shows, at a shape size, and when it was made. */
export const ArtifactSnapshot = Schema.Struct({
  file: Schema.String,
  w: Schema.Number,
  h: Schema.Number,
  at: Schema.Number,
});
export type ArtifactSnapshot = typeof ArtifactSnapshot.Type;

/** Every snapshot the project's cache holds, then one item per snapshot written. */
export const ArtifactSnapshots = Rpc.make("artifact.snapshots", {
  payload: Schema.Struct({ project: Schema.String }),
  success: ArtifactSnapshot,
  error: UnframedError,
  stream: true,
});
