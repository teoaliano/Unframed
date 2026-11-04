import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";

export const TOKEN_TYPES = ["color", "dimension", "fontFamily", "fontWeight", "textStyle", "shadow", "duration", "easing"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

const KIT_EXPORT_FORMATS = ["dtcg", "css", "tailwind"] as const;
export const KitExportFormat = Schema.Literals(KIT_EXPORT_FORMATS);
export type KitExportFormat = typeof KitExportFormat.Type;

const KitDefinitionToken = Schema.Struct({
  path: Schema.String,
  type: Schema.Literals(TOKEN_TYPES),
  value: Schema.optionalKey(Schema.Unknown),
  values: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  description: Schema.optionalKey(Schema.String),
  formerNames: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const KitDefinition = Schema.Struct({
  name: Schema.String,
  modes: Schema.Array(Schema.String),
  tokens: Schema.Array(KitDefinitionToken),
});
export type KitDefinition = typeof KitDefinition.Type;

export const KitUsage = Rpc.make("kit.usage", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({
    tokens: Schema.Record(Schema.String, Schema.Array(Schema.String)),
    modes: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  }),
  error: UnframedError,
});

export const KitExportFile = Rpc.make("kit.exportFile", {
  payload: Schema.Struct({ project: Schema.String, format: KitExportFormat }),
  success: Schema.Struct({ file: Schema.String }),
  error: UnframedError,
});



export interface TextStyle {
  fontFamily: string;
  fontSize: string;
  fontWeight: number | string;
  lineHeight: string | number;
  letterSpacing: string;
}

export type TokenValue = string | number | TextStyle;

export interface Token {
  path: string;
  type: TokenType;
  value?: TokenValue;
  values?: Record<string, TokenValue>;
  description?: string;
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
  modes: string[];
  tokens: Token[];
  from?: KitLink;
}
