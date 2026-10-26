/**
 * The kit record (spec 19): a kit is named tokens with modes. These are the shapes the room
 * stores as `meta.unframed.kit`, the library keeps as a preset, and every kit rule reads.
 */

export const TOKEN_TYPES = ["color", "dimension", "fontFamily", "fontWeight", "textStyle", "shadow", "duration", "easing"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

/** The five fields a text style sets, in the order their custom properties are written. */
export const TEXT_STYLE_FIELDS = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"] as const;
export type TextStyleField = (typeof TEXT_STYLE_FIELDS)[number];

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

export const KIT_LIMITS = {
  tokens: 2000,
  modes: 12,
  bytes: 512 * 1024,
  name: 80,
  description: 200,
  path: 120,
  segments: 6,
} as const;

/** The CSS property a text style field becomes, after the text style's name. */
export const TEXT_STYLE_SUFFIX: Readonly<Record<TextStyleField, string>> = {
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
};

/** The type a text style field takes as a value, and so as an alias. */
export const TEXT_STYLE_FIELD_TYPE: Readonly<Record<TextStyleField, TokenType>> = {
  fontFamily: "fontFamily",
  fontSize: "dimension",
  fontWeight: "fontWeight",
  lineHeight: "dimension",
  letterSpacing: "dimension",
};
