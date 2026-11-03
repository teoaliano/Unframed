/** Element editing (spec 18): the source edits the editor sends, and the element chips a message carries. */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";

/** The address of one rule in an artifact's `<style>` elements (spec 19): the block, the selector as written and the occurrence. */
export const StyleRuleRef = Schema.Struct({ block: Schema.Number, selector: Schema.String, occurrence: Schema.Number });
export type StyleRuleRef = typeof StyleRuleRef.Type;

/** One typed change to an artifact's HTML. Specs 20 and 21 add members. */
export const SourceEdit = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), elementId: Schema.String, text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("style"), elementId: Schema.String, property: Schema.String, value: Schema.NullOr(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("attribute"), elementId: Schema.String, name: Schema.String, value: Schema.NullOr(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("hide"), elementId: Schema.String, hidden: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("image"), elementId: Schema.String, target: Schema.Literals(["src", "background"]), file: Schema.String }),
  // A declaration in one rule of a component sheet's style (spec 20). The rule's selector is checked against locks by the engine.
  Schema.Struct({ type: Schema.Literal("componentRule"), rule: StyleRuleRef, property: Schema.String, value: Schema.String }),
  // Moves a page or motion's pin of one tag to a newer sheet of that tag (spec 20). `to` is a sheet file of the project.
  Schema.Struct({ type: Schema.Literal("componentUpdate"), tag: Schema.String, to: Schema.String }),
  // Exactly one of elementId and rule is set; the source edit refuses a token edit with both or neither (spec 19).
  Schema.Struct({
    type: Schema.Literal("token"),
    elementId: Schema.optionalKey(Schema.String),
    rule: Schema.optionalKey(StyleRuleRef),
    property: Schema.String,
    token: Schema.String,
  }),
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

/** One element of an artifact's source tree (spec 18): the elements that carry an element id, as the Design and Layers tabs read them. */
export const SourceTreeElement = Schema.Struct({
  id: Schema.String,
  tag: Schema.String,
  parent: Schema.NullOr(Schema.String),
  index: Schema.Number,
  name: Schema.String,
  named: Schema.Boolean,
  text: Schema.NullOr(Schema.String),
  style: Schema.Record(Schema.String, Schema.String),
  hidden: Schema.Boolean,
  src: Schema.optionalKey(Schema.String),
  inPicture: Schema.optionalKey(Schema.Boolean),
  attributes: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type SourceTreeElement = typeof SourceTreeElement.Type;

/** The sidecar of a source edit or a prepare, written beside the new file (spec 18, Persisted formats). */
export const ArtifactEditSidecar = Schema.Struct({
  source: Schema.Literal("edit"),
  kind: Schema.Literals(["page", "motion"]),
  of: Schema.String,
  shapeId: Schema.String,
  edits: Schema.Array(Schema.String),
  title: Schema.String,
  bytes: Schema.Number,
  at: Schema.String,
});
export type ArtifactEditSidecar = typeof ArtifactEditSidecar.Type;

/** A project image the preview origin serves (spec 18, the image picker). `at` is the file time in epoch milliseconds. */
export const ArtifactImage = Schema.Struct({ file: Schema.String, fileName: Schema.String, at: Schema.Number });
export type ArtifactImage = typeof ArtifactImage.Type;

/** Where an off-token value sits: an element's inline style (by its id), or a style rule (spec 19). */
export const OffTokenPlace = Schema.Union([Schema.Struct({ elementId: Schema.String }), Schema.Struct({ rule: StyleRuleRef })]);
export type OffTokenPlace = typeof OffTokenPlace.Type;

/** A literal in an artifact's source that sits close to a kit token (spec 19, Off-token rules). */
export const OffTokenFound = Schema.Struct({
  place: OffTokenPlace,
  property: Schema.String,
  value: Schema.String,
  path: Schema.String,
  css: Schema.String,
  tokenValue: Schema.String,
  exact: Schema.Boolean,
});
export type OffTokenFound = typeof OffTokenFound.Type;

/** Reads an artifact file's source tree, whether every element has its id and the bridge is in, and its off-token values (spec 19). */
export const ArtifactSourceTree = Rpc.make("artifact.sourceTree", {
  payload: Schema.Struct({ project: Schema.String, file: Schema.String }),
  success: Schema.Struct({ ready: Schema.Boolean, elements: Schema.Array(SourceTreeElement), offTokens: Schema.Array(OffTokenFound) }),
  error: UnframedError,
});

/** Writes a stamped, bridged version of a page or motion that is not ready for editing, or answers its current file. */
export const ArtifactPrepareEdit = Rpc.make("artifact.prepareEdit", {
  payload: Schema.Struct({ project: Schema.String, shapeId: Schema.String }),
  success: Schema.Struct({ file: Schema.String }),
  error: UnframedError,
});

/** Applies a burst's source edits to the file it began on and writes the result as a new version. */
export const ArtifactEdit = Rpc.make("artifact.edit", {
  payload: Schema.Struct({
    project: Schema.String,
    shapeId: Schema.String,
    baseFile: Schema.String,
    edits: Schema.Array(SourceEdit),
  }),
  success: Schema.Struct({ file: Schema.String, summary: Schema.Array(Schema.String) }),
  error: UnframedError,
});

/** The project's images the preview origin serves, newest first. */
export const ArtifactImages = Rpc.make("artifact.images", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({ images: Schema.Array(ArtifactImage) }),
  error: UnframedError,
});
