import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";

export const StyleRuleRef = Schema.Struct({ block: Schema.Number, selector: Schema.String, occurrence: Schema.Number });
export type StyleRuleRef = typeof StyleRuleRef.Type;

const TweenRefSchema = Schema.Struct({ index: Schema.Number, id: Schema.String });
const TokenRefSchema = Schema.Struct({ token: Schema.String });

export const SourceEdit = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), elementId: Schema.String, text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("style"), elementId: Schema.String, property: Schema.String, value: Schema.NullOr(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("attribute"), elementId: Schema.String, name: Schema.String, value: Schema.NullOr(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("hide"), elementId: Schema.String, hidden: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("image"), elementId: Schema.String, target: Schema.Literals(["src", "background"]), file: Schema.String }),
  Schema.Struct({ type: Schema.Literal("componentRule"), rule: StyleRuleRef, property: Schema.String, value: Schema.String }),
  Schema.Struct({ type: Schema.Literal("componentUpdate"), tag: Schema.String, to: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("token"),
    elementId: Schema.optionalKey(Schema.String),
    rule: Schema.optionalKey(StyleRuleRef),
    property: Schema.String,
    token: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("tween-time"), tween: TweenRefSchema, start: Schema.optionalKey(Schema.Number), duration: Schema.optionalKey(Schema.Union([Schema.Number, TokenRefSchema])) }),
  Schema.Struct({ type: Schema.Literal("tween-ease"), tween: TweenRefSchema, ease: Schema.Union([Schema.String, TokenRefSchema]) }),
  Schema.Struct({ type: Schema.Literal("tween-stagger"), tween: TweenRefSchema, each: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("tween-value"), tween: TweenRefSchema, at: Schema.Number, property: Schema.String, value: Schema.Union([Schema.Number, Schema.String, TokenRefSchema]) }),
  Schema.Struct({ type: Schema.Literal("clip-time"), clip: Schema.String, start: Schema.optionalKey(Schema.Number), duration: Schema.optionalKey(Schema.Number) }),
  Schema.Struct({ type: Schema.Literal("composition-duration"), seconds: Schema.Number }),
]);
export type SourceEdit = typeof SourceEdit.Type;

export const ElementChip = Schema.Struct({
  shapeId: Schema.String,
  elementId: Schema.NullOr(Schema.String),
  selector: Schema.String,
  tag: Schema.String,
  label: Schema.String,
  excerpt: Schema.String,
});
export type ElementChip = typeof ElementChip.Type;

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

export const ArtifactImage = Schema.Struct({ file: Schema.String, fileName: Schema.String, at: Schema.Number });
export type ArtifactImage = typeof ArtifactImage.Type;

export const OffTokenPlace = Schema.Union([Schema.Struct({ elementId: Schema.String }), Schema.Struct({ rule: StyleRuleRef })]);
export type OffTokenPlace = typeof OffTokenPlace.Type;

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

export const ArtifactSourceTree = Rpc.make("artifact.sourceTree", {
  payload: Schema.Struct({ project: Schema.String, file: Schema.String }),
  success: Schema.Struct({ ready: Schema.Boolean, elements: Schema.Array(SourceTreeElement), offTokens: Schema.Array(OffTokenFound) }),
  error: UnframedError,
});

export const ArtifactPrepareEdit = Rpc.make("artifact.prepareEdit", {
  payload: Schema.Struct({ project: Schema.String, shapeId: Schema.String }),
  success: Schema.Struct({ file: Schema.String }),
  error: UnframedError,
});

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

export const ArtifactImages = Rpc.make("artifact.images", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({ images: Schema.Array(ArtifactImage) }),
  error: UnframedError,
});
