import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";
import { RecipeRef } from "./generation.ts";
import { Preset } from "./library.ts";

export const RenderedInputs = Schema.Record(Schema.String, RecipeRef);
export type RenderedInputs = typeof RenderedInputs.Type;

export const DownstreamScope = Schema.Literals(["pending", "all"]);
export type DownstreamScope = typeof DownstreamScope.Type;

export const ChainStarted = Schema.Struct({ chainId: Schema.String, nodes: Schema.Array(Schema.String) });
export type ChainStarted = typeof ChainStarted.Type;

export const NodeRun = Rpc.make("node.run", {
  payload: Schema.Struct({
    project: Schema.String,
    shapeId: Schema.String,
    downstream: Schema.optionalKey(Schema.Boolean),
    scope: Schema.optionalKey(DownstreamScope),
    rendered: Schema.optionalKey(RenderedInputs),
  }),
  success: ChainStarted,
  error: UnframedError,
});

export const ChainRun = Rpc.make("chain.run", {
  payload: Schema.Struct({ project: Schema.String, shapeIds: Schema.Array(Schema.String), rendered: Schema.optionalKey(RenderedInputs) }),
  success: ChainStarted,
  error: UnframedError,
});

export const NodeUseVersion = Rpc.make("node.useVersion", {
  payload: Schema.Struct({ project: Schema.String, shapeId: Schema.String, versionId: Schema.String }),
  success: Schema.Struct({}),
  error: UnframedError,
});

export const NodeRemoveVersion = Rpc.make("node.removeVersion", {
  payload: Schema.Struct({ project: Schema.String, shapeId: Schema.String, versionId: Schema.String }),
  success: Schema.Struct({}),
  error: UnframedError,
});

export const NodeRenders = Rpc.make("node.renders", {
  payload: Schema.Struct({ project: Schema.String, files: Schema.Array(Schema.String) }),
  success: Schema.Struct({ renders: Schema.Record(Schema.String, Schema.String) }),
  error: UnframedError,
});

export const FlowSave = Rpc.make("flow.save", {
  payload: Schema.Struct({ project: Schema.String, shapeIds: Schema.Array(Schema.String), name: Schema.String, summary: Schema.optionalKey(Schema.String) }),
  success: Schema.Struct({ preset: Preset, droppedWires: Schema.Number }),
  error: UnframedError,
});
