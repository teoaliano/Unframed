/**
 * Which tokens a Design tab field offers (spec 19). Fields are keyed by the CSS property they
 * write, as spec 18's Design tab names them. This is a local copy of that field list: spec 18's
 * DESIGN_FIELDS is not on this branch. Fields with no slot (opacity, layout, visibility) offer
 * nothing, so they are not listed.
 */
import type { Kit, Token, TokenType } from "./types.ts";

const FIELD_TYPES: Readonly<Record<string, readonly TokenType[]>> = {
  "font-family": ["fontFamily"],
  "font-size": ["dimension"],
  "font-weight": ["fontWeight"],
  "line-height": ["dimension"],
  "letter-spacing": ["dimension"],
  color: ["color"],
  "background-color": ["color"],
  "border-width": ["dimension"],
  "border-color": ["color"],
  "border-radius": ["dimension"],
  "box-shadow": ["shadow"],
  padding: ["dimension"],
  margin: ["dimension"],
  gap: ["dimension"],
  "text-style": ["textStyle"],
};

const SPACING = ["space", "spacing", "gap"];
const RADIUS = ["radius", "radii", "rounded"];
const TEXT = ["font", "text", "size"];

/** The path keywords that move a token to the front for a field. Other fields keep the kit's order. */
const PREFERRED: Readonly<Record<string, readonly string[]>> = {
  padding: SPACING,
  margin: SPACING,
  gap: SPACING,
  "border-radius": RADIUS,
  "font-size": TEXT,
  "line-height": TEXT,
  "letter-spacing": TEXT,
};

/** The tokens a field offers: of its types, the ones whose path has a preferred keyword first, each group in kit order. */
export const tokensForField = (field: string, kit: Kit): Token[] => {
  if (!Object.prototype.hasOwnProperty.call(FIELD_TYPES, field)) return [];
  const types = FIELD_TYPES[field]!;
  const offered = kit.tokens.filter((token) => types.includes(token.type));
  const keywords = PREFERRED[field];
  if (keywords === undefined) return offered;
  const preferred = offered.filter((token) => token.path.split("/").some((segment) => keywords.includes(segment)));
  return [...preferred, ...offered.filter((token) => !preferred.includes(token))];
};
