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

/** The engine asks a window to select these shapes. The window answers with `selection.report`. */
export const SelectionApply = Schema.Struct({
  kind: Schema.Literal("apply"),
  requestId: Schema.String,
  shapeIds: Schema.Array(Schema.String),
});
export type SelectionApply = typeof SelectionApply.Type;
