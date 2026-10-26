/** Element editing (spec 18): the source edits the editor sends, and the element chips a message carries. */
import * as Schema from "effect/Schema";

/** One typed change to an artifact's HTML. Specs 19 to 21 add members. */
export const SourceEdit = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), elementId: Schema.String, text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("style"), elementId: Schema.String, property: Schema.String, value: Schema.NullOr(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("attribute"), elementId: Schema.String, name: Schema.String, value: Schema.NullOr(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("hide"), elementId: Schema.String, hidden: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("image"), elementId: Schema.String, target: Schema.Literals(["src", "background"]), file: Schema.String }),
]);
export type SourceEdit = typeof SourceEdit.Type;

/** A pointed-at element in the composer: its artifact, its element id (null for a runtime element), a selector and an excerpt. */
export const ElementChip = Schema.Struct({
  shapeId: Schema.String,
  elementId: Schema.NullOr(Schema.String),
  selector: Schema.String,
  tag: Schema.String,
  label: Schema.String,
  excerpt: Schema.String,
});
export type ElementChip = typeof ElementChip.Type;
