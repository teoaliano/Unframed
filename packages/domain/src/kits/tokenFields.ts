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

export const tokensForField = (field: string, kit: Kit): Token[] => {
  const types = typesOf(field);
  if (types.length === 0) return [];
  const offered = kit.tokens.filter((token) => types.includes(token.type));
  const keywords = PREFERRED[field];
  if (keywords === undefined) return offered;
  const preferred = offered.filter((token) => token.path.split("/").some((segment) => keywords.includes(segment)));
  return [...preferred, ...offered.filter((token) => !preferred.includes(token))];
};
