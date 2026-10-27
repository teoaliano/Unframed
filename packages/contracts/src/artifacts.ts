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

/**
 * "Open in a new tab": writes the shape's live viewer pointer, which the engine keeps current
 * from then on. Shapes never opened in a tab have none.
 */
export const ArtifactOpenLive = Rpc.make("artifact.openLive", {
  payload: Schema.Struct({ project: Schema.String, shapeId: Schema.String }),
  success: Schema.Struct({}),
  error: UnframedError,
});

/** One value's owner in a motion's timeline reading (spec 21): a literal, a parameter path, a token, or the agent's code. */
const TimelineOwner = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("source"), value: Schema.Union([Schema.Number, Schema.String]) }),
  Schema.Struct({ kind: Schema.Literal("dial"), path: Schema.Array(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("token"), name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("script"), text: Schema.String }),
]);

const TimelineGroup = Schema.Literals(["position", "scale", "size", "rotation", "visual", "other"]);
const TimelineTweenRef = Schema.Struct({ index: Schema.Number, id: Schema.String });
const TimelineElement = Schema.Struct({ name: Schema.String, parent: Schema.NullOr(Schema.String), clip: Schema.NullOr(Schema.String) });

/** The timeline reading of one motion file (spec 21): its clips, tweens, owners and carries. */
export const MotionTimelineReading = Schema.Struct({
  file: Schema.String,
  script: Schema.Literals(["ok", "none", "unreadable"]),
  length: TimelineOwner,
  clips: Schema.Array(
    Schema.Struct({
      hfId: Schema.String,
      id: Schema.String,
      track: Schema.Number,
      start: TimelineOwner,
      duration: TimelineOwner,
      carry: Schema.Union([
        Schema.Struct({ tweens: Schema.Array(TimelineTweenRef), dials: Schema.Array(Schema.Array(Schema.String)) }),
        Schema.Struct({ refused: Schema.String }),
      ]),
    }),
  ),
  tweens: Schema.Array(
    Schema.Struct({
      ref: TimelineTweenRef,
      method: Schema.Literals(["to", "from", "fromTo", "set"]),
      targets: Schema.Array(Schema.String),
      groups: Schema.Array(TimelineGroup),
      start: TimelineOwner,
      duration: TimelineOwner,
      ease: Schema.NullOr(TimelineOwner),
      stagger: Schema.NullOr(TimelineOwner),
      staggerForm: Schema.NullOr(Schema.Literals(["number", "each", "amount", "other"])),
      repeat: Schema.NullOr(Schema.Struct({ count: Schema.NullOr(Schema.Number), yoyo: Schema.Boolean })),
      keyframes: Schema.Array(
        Schema.Struct({ at: Schema.Number, values: Schema.Record(Schema.String, TimelineOwner), ease: Schema.NullOr(TimelineOwner) }),
      ),
      readOnly: Schema.NullOr(Schema.String),
      source: Schema.String,
    }),
  ),
  elements: Schema.Record(Schema.String, TimelineElement),
});
export type MotionTimelineReading = typeof MotionTimelineReading.Type;

/** The timeline reading of a motion file in the project, cached per file by the engine. */
export const MotionTimelineRpc = Rpc.make("motion.timeline", {
  payload: Schema.Struct({ project: Schema.String, file: Schema.String }),
  success: MotionTimelineReading,
  error: UnframedError,
});

/** Every snapshot the project's cache holds, then one item per snapshot written. */
export const ArtifactSnapshots = Rpc.make("artifact.snapshots", {
  payload: Schema.Struct({ project: Schema.String }),
  success: ArtifactSnapshot,
  error: UnframedError,
  stream: true,
});
