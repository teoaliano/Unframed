import * as Schema from "effect/Schema";

/** A window's selection on one project's canvas, as it reports it (spec 14, "The live selection"). */
export const SelectionReport = Schema.Struct({
  project: Schema.String,
  windowId: Schema.String,
  shapeIds: Schema.Array(Schema.String),
});
export type SelectionReport = typeof SelectionReport.Type;

/** A window opens its selection stream for a project. `windowId` is the window's own id, kept for its lifetime. */
export const SelectionSubscribe = Schema.Struct({
  project: Schema.String,
  windowId: Schema.String,
});

const SelectApply = Schema.Struct({
  kind: Schema.Literal("apply"),
  requestId: Schema.String,
  shapeIds: Schema.Array(Schema.String),
});

const SnapshotRequest = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  requestId: Schema.String,
  bounds: Schema.Struct({ x: Schema.Number, y: Schema.Number, w: Schema.Number, h: Schema.Number }),
  scale: Schema.Number,
});

/**
 * What the engine asks of a window: select these shapes (answered with `selection.report`), or
 * render an area of the canvas as the person sees it (answered with `selection.snapshotResult`).
 */
export const SelectionApply = Schema.Union([SelectApply, SnapshotRequest]);
export type SelectionApply = typeof SelectionApply.Type;

/** A window's answer to a snapshot request: the PNG as base64, or why it could not draw it. */
export const SelectionSnapshotResult = Schema.Struct({
  requestId: Schema.String,
  png: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
});
export type SelectionSnapshotResult = typeof SelectionSnapshotResult.Type;
