/**
 * The kit record (spec 19). The record types live in contracts, the leaf every package may
 * import; they are re-exported here so domain code keeps its names. The domain adds the
 * constants its rules read.
 */
import type { TokenType } from "@unframed/contracts";
export type { Kit, KitLink, TextStyle, Token, TokenType, TokenValue } from "@unframed/contracts";
export { TOKEN_TYPES } from "@unframed/contracts";

/** The five fields a text style sets, in the order their custom properties are written. */
export const TEXT_STYLE_FIELDS = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"] as const;
export type TextStyleField = (typeof TEXT_STYLE_FIELDS)[number];

export const KIT_LIMITS = {
  tokens: 2000,
  modes: 12,
  bytes: 512 * 1024,
  name: 80,
  description: 200,
  path: 120,
  segments: 6,
  /** Characters of guidance markdown. A long DESIGN.md body is about 40,000. */
  guidance: 100_000,
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
