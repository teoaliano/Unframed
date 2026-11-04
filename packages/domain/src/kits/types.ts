import type { TokenType } from "@unframed/contracts";
export type { Kit, KitLink, TextStyle, Token, TokenType, TokenValue } from "@unframed/contracts";
export { TOKEN_TYPES } from "@unframed/contracts";

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
} as const;

export const TEXT_STYLE_SUFFIX: Readonly<Record<TextStyleField, string>> = {
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
};

export const TEXT_STYLE_FIELD_TYPE: Readonly<Record<TextStyleField, TokenType>> = {
  fontFamily: "fontFamily",
  fontSize: "dimension",
  fontWeight: "fontWeight",
  lineHeight: "dimension",
  letterSpacing: "dimension",
};
