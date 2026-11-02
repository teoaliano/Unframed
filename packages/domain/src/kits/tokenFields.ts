/**
 * Which tokens a Design tab field offers (spec 19). A field is named by the CSS property it
 * writes, as spec 18's DESIGN_FIELDS lists them; the token types follow the field's value kind.
 * Opacity, keyword fields (layout, align, border style) offer nothing. The shorthands `padding`
 * and `margin` stand for their four sides, and `text-style` is the Text section header's picker.
 */
import { DESIGN_FIELDS, type DesignValueKind } from "../designFields.ts";
import type { Kit, Token, TokenType } from "./types.ts";

const KIND_TYPES: Readonly<Partial<Record<DesignValueKind, readonly TokenType[]>>> = {
  family: ["fontFamily"],
  weight: ["fontWeight"],
  color: ["color"],
  shadow: ["shadow"],
  length: ["dimension"],
  number: ["dimension"],
};

const typesOf = (field: string): readonly TokenType[] => {
  if (field === "text-style") return ["textStyle"];
  const property = field === "padding" || field === "margin" ? `${field}-top` : field;
  const found = DESIGN_FIELDS.find((candidate) => candidate.property === property);
  return (found && KIND_TYPES[found.kind]) || [];
};

const SPACING = ["space", "spacing", "gap"];
const RADIUS = ["radius", "radii", "rounded"];
const TEXT = ["font", "text", "size"];

/** The path keywords that move a token to the front for a field. Other fields keep the kit's order. */
const PREFERRED: Readonly<Record<string, readonly string[]>> = {
  padding: SPACING,
  margin: SPACING,
  "padding-top": SPACING,
  "padding-right": SPACING,
  "padding-bottom": SPACING,
  "padding-left": SPACING,
  "margin-top": SPACING,
  "margin-right": SPACING,
  "margin-bottom": SPACING,
  "margin-left": SPACING,
  gap: SPACING,
  "border-radius": RADIUS,
  "font-size": TEXT,
  "line-height": TEXT,
  "letter-spacing": TEXT,
};

/** The tokens a field offers: of its types, the ones whose path has a preferred keyword first, each group in kit order. */
export const tokensForField = (field: string, kit: Kit): Token[] => {
  const types = typesOf(field);
  if (types.length === 0) return [];
  const offered = kit.tokens.filter((token) => types.includes(token.type));
  const keywords = PREFERRED[field];
  if (keywords === undefined) return offered;
  const preferred = offered.filter((token) => token.path.split("/").some((segment) => keywords.includes(segment)));
  return [...preferred, ...offered.filter((token) => !preferred.includes(token))];
};
