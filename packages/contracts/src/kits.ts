/** Kits (spec 19): the read-only and export methods. Person edits to a kit go through the canvas room. */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";

export const KIT_EXPORT_FORMATS = ["dtcg", "css", "tailwind"] as const;
export const KitExportFormat = Schema.Literals(KIT_EXPORT_FORMATS);
export type KitExportFormat = typeof KitExportFormat.Type;

/** Which artifact shapes refer to each token path, and which to each mode. */
export const KitUsage = Rpc.make("kit.usage", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({
    tokens: Schema.Record(Schema.String, Schema.Array(Schema.String)),
    modes: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  }),
  error: UnframedError,
});

/** Writes the project's kit into the project folder in one format, with its export sidecar. */
export const KitExportFile = Rpc.make("kit.exportFile", {
  payload: Schema.Struct({ project: Schema.String, format: KitExportFormat }),
  success: Schema.Struct({ file: Schema.String }),
  error: UnframedError,
});
