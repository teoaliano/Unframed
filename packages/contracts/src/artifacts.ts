import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";

export const MotionUpload = Rpc.make("motion.upload", {
  payload: Schema.Struct({ project: Schema.String, fileName: Schema.String, html: Schema.String }),
  success: Schema.Struct({ file: Schema.String, fileName: Schema.String, bytes: Schema.Number, mime: Schema.Literal("text/html") }),
  error: UnframedError,
});

export const RenderState = Schema.Literals(["queued", "rendering", "done", "failed"]);
export type RenderState = typeof RenderState.Type;

export const MotionRenderStart = Rpc.make("motion.renderStart", {
  payload: Schema.Struct({
    project: Schema.String,
    file: Schema.String,
    title: Schema.optionalKey(Schema.String),
    dials: Schema.optionalKey(Schema.Unknown),
    mode: Schema.optionalKey(Schema.String),
    shapeId: Schema.String,
  }),
  success: Schema.Struct({ id: Schema.String, status: RenderState, placeholder: Schema.String }),
  error: UnframedError,
});

export const RenderStatus = Schema.Struct({
  id: Schema.String,
  file: Schema.String,
  status: RenderState,
  progress: Schema.Number,
  message: Schema.String,
  output: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type RenderStatus = typeof RenderStatus.Type;

export const MotionRenderStatus = Rpc.make("motion.renderStatus", {
  payload: Schema.Struct({ project: Schema.String, id: Schema.String }),
  success: RenderStatus,
  error: UnframedError,
});

export const ArtifactSnapshot = Schema.Struct({
  file: Schema.String,
  w: Schema.Number,
  h: Schema.Number,
  at: Schema.Number,
  mode: Schema.optionalKey(Schema.NullOr(Schema.String)),
  kit: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type ArtifactSnapshot = typeof ArtifactSnapshot.Type;

export const ArtifactOpenLive = Rpc.make("artifact.openLive", {
  payload: Schema.Struct({ project: Schema.String, shapeId: Schema.String }),
  success: Schema.Struct({}),
  error: UnframedError,
});

const TimelineOwner = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("source"), value: Schema.Union([Schema.Number, Schema.String]) }),
  Schema.Struct({ kind: Schema.Literal("dial"), path: Schema.Array(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("token"), name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("script"), text: Schema.String }),
]);

const TimelineGroup = Schema.Literals(["position", "scale", "size", "rotation", "visual", "other"]);
const TimelineTweenRef = Schema.Struct({ index: Schema.Number, id: Schema.String });
const TimelineElement = Schema.Struct({ name: Schema.String, parent: Schema.NullOr(Schema.String), clip: Schema.NullOr(Schema.String) });

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

export const MotionTimelineRpc = Rpc.make("motion.timeline", {
  payload: Schema.Struct({ project: Schema.String, file: Schema.String }),
  success: MotionTimelineReading,
  error: UnframedError,
});

export const ArtifactSnapshots = Rpc.make("artifact.snapshots", {
  payload: Schema.Struct({ project: Schema.String }),
  success: ArtifactSnapshot,
  error: UnframedError,
  stream: true,
});

export const ComponentPin = Schema.Struct({ tag: Schema.String, sheet: Schema.String });
export type ComponentPin = typeof ComponentPin.Type;

export const ComponentPins = Schema.Struct({ file: Schema.String, pins: Schema.Array(ComponentPin) });
export type ComponentPins = typeof ComponentPins.Type;

export const ComponentPinsSubscribe = Rpc.make("component.pins", {
  payload: Schema.Struct({ project: Schema.String }),
  success: ComponentPins,
  error: UnframedError,
  stream: true,
});

export const ComponentUpdate = Schema.Struct({ tag: Schema.String, title: Schema.String, from: Schema.String, to: Schema.String, warnings: Schema.Array(Schema.String) });
export type ComponentUpdate = typeof ComponentUpdate.Type;

export const ComponentUpdates = Rpc.make("component.updates", {
  payload: Schema.Struct({ project: Schema.String, shapeId: Schema.String }),
  success: Schema.Array(ComponentUpdate),
  error: UnframedError,
});

export const ComponentCopy = Rpc.make("component.copy", {
  payload: Schema.Struct({ project: Schema.String, file: Schema.String, from: Schema.optionalKey(Schema.String) }),
  success: Schema.Struct({ file: Schema.String, tag: Schema.String }),
  error: UnframedError,
});
