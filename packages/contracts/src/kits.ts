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

/*
 * The kit record (spec 19): the shapes the room stores as `meta.unframed.kit`, the library keeps
 * as a preset, and the domain's rules read. The domain re-exports these names.
 */

export const TOKEN_TYPES = ["color", "dimension", "fontFamily", "fontWeight", "textStyle", "shadow", "duration", "easing"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

export interface TextStyle {
  fontFamily: string;
  fontSize: string;
  fontWeight: number | string;
  lineHeight: string | number;
  letterSpacing: string;
}

/** A literal, a text style, or an alias written `{path}`. */
export type TokenValue = string | number | TextStyle;

export interface Token {
  path: string;
  type: TokenType;
  /** One value for every mode. Exactly one of `value` and `values` is set. */
  value?: TokenValue;
  /** A value per mode. A mode it leaves out uses the default mode's value. */
  values?: Record<string, TokenValue>;
  description?: string;
  /** CSS names kept working after a rename. */
  formerNames?: string[];
}

export interface KitLink {
  presetId: string;
  revision: number;
  base: { modes: string[]; tokens: Token[] };
}

export interface Kit {
  format: 1;
  name: string;
  /** The first is the default mode. */
  modes: string[];
  /** In the order the dialog shows them. */
  tokens: Token[];
  from?: KitLink;
}
