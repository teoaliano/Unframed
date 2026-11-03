import { isEaseName } from "./easings.ts";
import { kitRuntime } from "./runtime.ts";
import { isFontFamily, isShadow, parseBezier, parseColour, parseLength, parseTime, parseWeight } from "./values.ts";
import { KIT_LIMITS, TEXT_STYLE_FIELD_TYPE, TEXT_STYLE_FIELDS, TEXT_STYLE_SUFFIX, TOKEN_TYPES, type Kit, type Token, type TokenType, type TokenValue } from "./types.ts";

export { cssName, resolve } from "./runtime.ts";

const ALIAS = /^\{(.+)\}$/;
const SEGMENT = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MODE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const NAME_SENTENCE = "A token name is words joined by slashes, like color/brand/primary.";
const FORMER_NAME = /^--[a-z0-9-]+$/;
const FORMER_NAME_SENTENCE = "A former name is a CSS name in lower case, like --color-brand-primary.";

export const pathRefusal = (path: string): string | null => {
  if (path.length > KIT_LIMITS.path) return `A token name is at most ${KIT_LIMITS.path} characters.`;
  const segments = path.split("/");
  if (segments.length > KIT_LIMITS.segments) return `A token name has at most ${KIT_LIMITS.segments} parts, like color/brand/primary.`;
  if (segments.some((segment) => segment.length > 40)) return "A part of a token name is at most 40 characters.";
  return segments.every((segment) => SEGMENT.test(segment)) ? null : NAME_SENTENCE;
};

export const modeRefusal = (name: string): string | null => {
  if (!MODE.test(name)) return "A mode name is a short word, like light or dark.";
  return name === "none" ? "none is reserved; give the mode another name." : null;
};

const DIMENSION_SENTENCE = (value: unknown) => `${String(value)} is not a size. Use a number with px, rem, em or %.`;
const WEIGHT_SENTENCE = "A font weight is a number from 1 to 1000, or normal, bold, lighter or bolder.";

const literalRefusal = (type: TokenType, value: unknown): string | null => {
  switch (type) {
    case "color":
      return typeof value === "string" && parseColour(value) !== null ? null : `${String(value)} is not a colour. Use a hex value like #1a73e8, or rgb(), hsl() or oklch().`;
    case "dimension":
      return typeof value === "string" && parseLength(value) !== null ? null : DIMENSION_SENTENCE(value);
    case "fontFamily":
      if (typeof value === "string" && value.trim() === "") return "A font family cannot be empty.";
      return typeof value === "string" && isFontFamily(value) ? null : `${String(value)} is not a font family. Use a list of family names, like Inter, sans-serif.`;
    case "fontWeight":
      return parseWeight(value) ? null : WEIGHT_SENTENCE;
    case "shadow":
      return typeof value === "string" && isShadow(value) ? null : `${String(value)} is not a shadow. Use CSS box-shadow, like 0 2px 8px rgba(0, 0, 0, 0.2).`;
    case "duration":
      return typeof value === "string" && parseTime(value) !== null ? null : `${String(value)} is not a duration. Use ms or s, like 200ms.`;
    case "easing":
      return typeof value === "string" && (isEaseName(value) || parseBezier(value) !== null)
        ? null
        : `${String(value)} is not an easing. Use a GSAP ease like power2.out, or cubic-bezier(x1, y1, x2, y2).`;
    case "textStyle":
      return `${String(value)} is not a text style.`;
  }
};

const isAlias = (value: unknown): value is string => typeof value === "string" && ALIAS.test(value);
const targetOf = (value: string): string => ALIAS.exec(value)![1]!;

const aliasRefusal = (kit: Kit, path: string, expected: TokenType, value: string): string | null => {
  const target = kit.tokens.find((token) => token.path === targetOf(value));
  if (target === undefined) return `${path} refers to ${targetOf(value)}, which is not in the kit.`;
  if (target.type !== expected) return `${path} is a ${expected} and cannot refer to ${target.path}, a ${target.type}.`;
  return null;
};

export const valueRefusal = (token: Pick<Token, "path" | "type">, value: unknown, kit: Kit): string | null => {
  if (token.type === "textStyle") {
    if (isAlias(value)) return aliasRefusal(kit, token.path, "textStyle", value);
    if (typeof value !== "object" || value === null) return `${token.path} needs its fontFamily.`;
    const fields = value as Record<string, unknown>;
    for (const field of TEXT_STYLE_FIELDS) {
      const fieldValue = fields[field];
      if (fieldValue === undefined) return `${token.path} needs its ${field}.`;
      const expected = TEXT_STYLE_FIELD_TYPE[field];
      if (isAlias(fieldValue)) {
        const refusal = aliasRefusal(kit, token.path, expected, fieldValue);
        if (refusal) return refusal;
        continue;
      }
      if (field === "lineHeight" && typeof fieldValue === "number") {
        if (!Number.isFinite(fieldValue)) return DIMENSION_SENTENCE(fieldValue);
        continue;
      }
      const refusal = literalRefusal(expected, fieldValue);
      if (refusal) return refusal;
    }
    return null;
  }
  if (isAlias(value)) return aliasRefusal(kit, token.path, token.type, value);
  return literalRefusal(token.type, value);
};

const namesOf = (token: Token, base: string): string[] =>
  token.type === "textStyle" ? Object.values(TEXT_STYLE_SUFFIX).map((sub) => `${base}-${sub}`) : [base];

const aliasTargets = (token: Token): string[] => {
  const values: unknown[] = token.value !== undefined ? [token.value] : Object.values(token.values ?? {});
  const targets: string[] = [];
  for (const value of values) {
    if (isAlias(value)) targets.push(targetOf(value));
    else if (typeof value === "object" && value !== null) {
      for (const field of TEXT_STYLE_FIELDS) {
        const fieldValue = (value as Record<string, unknown>)[field];
        if (isAlias(fieldValue)) targets.push(targetOf(fieldValue));
      }
    }
  }
  return targets;
};

export const kitRefusal = (kit: Kit): string | null => {
  if (kit.name.trim().length < 1 || kit.name.trim().length > 80) return "A kit needs a name of 1 to 80 characters.";
  if (kit.modes.length === 0) return "A kit keeps at least one mode.";
  if (kit.modes.length > KIT_LIMITS.modes) return "A kit holds at most 12 modes.";
  const seenModes = new Set<string>();
  for (const mode of kit.modes) {
    const refusal = modeRefusal(mode);
    if (refusal) return refusal;
    if (seenModes.has(mode)) return `There is already a mode ${mode}.`;
    seenModes.add(mode);
  }
  if (kit.tokens.length > KIT_LIMITS.tokens) return "A kit holds at most 2000 tokens.";
  if (new TextEncoder().encode(JSON.stringify(kit)).length > KIT_LIMITS.bytes) return "The kit is too large to save.";

  const defaultMode = kit.modes[0]!;
  const paths = new Set<string>();
  for (const token of kit.tokens) {
    const refusal = pathRefusal(token.path);
    if (refusal) return refusal;
    if (paths.has(token.path)) return `There is already a token ${token.path}.`;
    paths.add(token.path);
    if ((token.formerNames ?? []).some((former) => !FORMER_NAME.test(former))) return FORMER_NAME_SENTENCE;
    if (!(TOKEN_TYPES as readonly string[]).includes(token.type)) return `${token.path} has a type this app does not know.`;
    if ((token.value === undefined) === (token.values === undefined)) return `${token.path} needs one value, or a value for each mode.`;
    if (token.description !== undefined && token.description.length > KIT_LIMITS.description) return "A description is at most 200 characters.";
    if (token.values !== undefined) {
      for (const mode of Object.keys(token.values)) if (!kit.modes.includes(mode)) return `There is no mode ${mode} in the kit.`;
      if (token.values[defaultMode] === undefined) return `${token.path} needs a value for ${defaultMode}, the default mode.`;
    }
    for (const value of token.value !== undefined ? [token.value] : Object.values(token.values ?? {})) {
      const refusal = valueRefusal(token, value as TokenValue, kit);
      if (refusal) return refusal;
    }
  }

  const targets = new Map(kit.tokens.map((token) => [token.path, aliasTargets(token)]));
  const state = new Map<string, "open" | "done">();
  const visit = (path: string, stack: string[]): string | null => {
    if (state.get(path) === "done") return null;
    if (state.get(path) === "open") {
      const cycle = stack.slice(stack.indexOf(path));
      return `${cycle[0]} and ${cycle[1] ?? cycle[0]} refer to each other.`;
    }
    state.set(path, "open");
    for (const target of targets.get(path) ?? []) {
      const refusal = visit(target, [...stack, path]);
      if (refusal) return refusal;
    }
    state.set(path, "done");
    return null;
  };
  for (const token of kit.tokens) {
    const refusal = visit(token.path, []);
    if (refusal) return refusal;
  }

  const owners = new Map<string, string>();
  for (const token of kit.tokens) {
    const base = kitRuntime.cssName(token.path);
    const claims = [...namesOf(token, base), ...(token.formerNames ?? []).flatMap((former) => namesOf(token, former))];
    for (const name of claims) {
      const owner = owners.get(name);
      if (owner !== undefined && owner !== token.path) return `${owner} and ${token.path} both make ${name}. Rename one.`;
      owners.set(name, token.path);
    }
  }
  return null;
};

export const kitCssNames = (kit: Kit): string[] =>
  kit.tokens.flatMap((token) => {
    const base = kitRuntime.cssName(token.path);
    return [...namesOf(token, base), ...(token.formerNames ?? []).flatMap((former) => namesOf(token, former))];
  });

