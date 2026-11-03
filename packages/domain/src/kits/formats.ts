/**
 * Kit formats (spec 19): import from DTCG JSON and from CSS custom properties, and export to
 * DTCG JSON, CSS and Tailwind v4 `@theme`. Import reads what it can, counts what it cannot and
 * returns a fragment; the caller merges it with `applyKitOps`. Export and import round-trip.
 *
 * In a DTCG file the token's `$value` is the default mode's value in DTCG form. The unframed
 * extension holds each mode's value in the kit's own text form, so every type comes back as
 * it was written.
 */
import { kitCss } from "./runtime.ts";
import { cubicBezierOf, isEaseName } from "./easings.ts";
import { parseStylesheet } from "./css.ts";
import { modeRefusal, valueRefusal } from "./rules.ts";
import { isShadow, parseBezier, parseColour, parseLength, parseTime, parseWeight } from "./values.ts";
import { TEXT_STYLE_FIELDS, type Kit, type Token, type TokenType, type TokenValue } from "./types.ts";

export interface ImportFragment {
  /** The name the file carries in the unframed extension, when it has one. */
  readonly name?: string;
  readonly modes: string[];
  readonly tokens: Token[];
  /** Tokens and declarations the import could not read. */
  readonly skipped: number;
  /** What was skipped, by name, when the format can name it (a DESIGN.md's front matter entries). */
  readonly skippedNames?: ReadonlyArray<string>;
  /** True when the values belong to no mode: they go to the kit's default mode, and add none. */
  readonly modeless?: boolean;
  /** Markdown the kit takes as its guidance. */
  readonly guidance?: string;
}

export type ImportResult = { ok: true; fragment: ImportFragment } | { ok: false; refusal: string };

export interface ImportFile {
  readonly name: string;
  readonly text: string;
}

const UNFRAMED = "org.unframed";
const DEFAULT_MODE = "default";
const DIMENSION_GROUPS = ["space", "size", "radius"];
const ALIAS = /^\{(.+)\}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isAlias = (value: unknown): boolean => typeof value === "string" && ALIAS.test(value);

/** A DTCG path in the kit's form: segments split on `.` and `/`, camel case and spaces made dashes, lower case. */
const pathOf = (raw: string): string =>
  raw
    .split(/[./]/)
    .map((segment) => segment.trim().replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/\s+/g, "-").toLowerCase())
    .filter((segment) => segment !== "")
    .join("/");

/** A DTCG reference `{group.token}` as the kit's alias `{group/token}`. */
const aliasOf = (value: string): string | undefined => {
  const match = ALIAS.exec(value.trim());
  return match ? `{${pathOf(match[1]!)}}` : undefined;
};

/** A DTCG dimension or duration: the object form (`{ value, unit }`) or a string, as the kit's text. */
const measure = (value: unknown): string | undefined => {
  if (typeof value === "string") return value.trim() === "" ? undefined : value.trim();
  if (isRecord(value) && typeof value["value"] === "number" && typeof value["unit"] === "string") return `${value["value"]}${value["unit"]}`;
  return undefined;
};

/** The kit's value for a DTCG value of one of the kit's types (`dimension` for a number too), or undefined when it cannot be read. */
const readDtcg = (type: string, value: unknown, path: string): TokenValue | undefined => {
  if (typeof value === "string" && aliasOf(value) !== undefined) return aliasOf(value);
  switch (type) {
    case "color":
      return typeof value === "string" ? value : undefined;
    case "dimension":
      if (typeof value === "number") return DIMENSION_GROUPS.some((group) => path.split("/").includes(group)) ? `${value}px` : undefined;
      return measure(value);
    case "duration":
      return measure(value);
    case "fontFamily":
      if (typeof value === "string") return value;
      if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")) {
        return (value as string[]).map((item) => (item.includes(" ") ? `"${item}"` : item)).join(", ");
      }
      return undefined;
    case "fontWeight":
      return typeof value === "number" || typeof value === "string" ? value : undefined;
    case "cubicBezier":
      return Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === "number") ? `cubic-bezier(${value.join(", ")})` : undefined;
    case "shadow":
      return readShadow(value);
    case "typography": {
      if (!isRecord(value)) return undefined;
      const style: Record<string, unknown> = {};
      for (const field of TEXT_STYLE_FIELDS) {
        const raw = value[field];
        if (raw === undefined) return undefined;
        if (field === "lineHeight" && typeof raw === "number") style[field] = raw;
        else {
          const kind = field === "fontFamily" ? "fontFamily" : field === "fontWeight" ? "fontWeight" : "dimension";
          const read = readDtcg(kind, raw, path);
          if (read === undefined) return undefined;
          style[field] = read;
        }
      }
      return style as unknown as TokenValue;
    }
    default:
      return undefined;
  }
};

/** A DTCG shadow: CSS text, or one or more layers as objects (offsetX, offsetY, blur, spread, color). */
const readShadow = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  const layers = Array.isArray(value) ? value : [value];
  if (layers.length === 0) return undefined;
  const texts: string[] = [];
  for (const layer of layers) {
    if (typeof layer === "string") {
      texts.push(layer);
      continue;
    }
    if (!isRecord(layer)) return undefined;
    const length = (name: string, fallback?: string): string | undefined => {
      const raw = layer[name];
      if (typeof raw === "number") return `${raw}px`;
      if (typeof raw === "string") return raw;
      return fallback;
    };
    const parts = [length("offsetX"), length("offsetY"), length("blur", "0px"), length("spread", "0px"), typeof layer["color"] === "string" ? layer["color"] : undefined];
    if (parts.some((part) => part === undefined)) return undefined;
    texts.push((parts as string[]).join(" "));
  }
  return texts.join(", ");
};

const KIT_TYPE: Readonly<Record<string, TokenType>> = {
  color: "color",
  dimension: "dimension",
  fontFamily: "fontFamily",
  fontWeight: "fontWeight",
  duration: "duration",
  cubicBezier: "easing",
  shadow: "shadow",
  typography: "textStyle",
};

/** The mode a file stands for: its name without `.json` and `.tokens`, or the default mode when that is not a mode name. */
const modeOfFile = (name: string): string => {
  const base = name.replace(/\.json$/i, "").replace(/\.tokens$/i, "").trim();
  return base === "" || base === "tokens" || modeRefusal(base) !== null ? DEFAULT_MODE : base;
};

interface Collected {
  type: TokenType;
  description?: string;
  /** Values by mode. */
  values: Record<string, TokenValue>;
  /** True when the token came from one place with one value, so it is one value for every mode. */
  shared: boolean;
}

/** The tokens as the kit holds them: one value when every mode has the same one (or the token was one value), else a value per mode. */
const assemble = (collected: Map<string, Collected>, modes: string[], skipped: number, name?: string): ImportFragment => {
  const tokens: Token[] = [];
  for (const [path, entry] of collected) {
    const values = entry.values;
    const defaultMode = modes[0]!;
    if (values[defaultMode] === undefined) values[defaultMode] = Object.values(values)[0]!;
    const distinct = new Set(Object.values(values).map((value) => JSON.stringify(value)));
    const single = entry.shared || (distinct.size === 1 && modes.every((mode) => values[mode] !== undefined));
    const token: Token = single
      ? { path, type: entry.type, value: values[defaultMode]! }
      : { path, type: entry.type, values: Object.fromEntries(modes.filter((mode) => values[mode] !== undefined).map((mode) => [mode, values[mode]!])) };
    if (entry.description !== undefined) token.description = entry.description;
    tokens.push(token);
  }
  return { ...(name !== undefined ? { name } : {}), modes, tokens, skipped };
};

/** Whether a value holds an alias anywhere. Those are checked when the kit is whole, not here. */
const holdsAlias = (value: unknown): boolean => {
  if (isAlias(value)) return true;
  return isRecord(value) && TEXT_STYLE_FIELDS.some((field) => isAlias(value[field]));
};

/** Imports DTCG JSON files. Each file is a mode named from its file name, unless the unframed extension names the kit's modes. */
export const fromDtcg = (files: ReadonlyArray<ImportFile>): ImportResult => {
  const collected = new Map<string, Collected>();
  const modes: string[] = [];
  let skipped = 0;
  let name: string | undefined;
  let guidance: string | undefined;

  for (const file of files) {
    let root: unknown;
    try {
      root = JSON.parse(file.text);
    } catch {
      return { ok: false, refusal: `${file.name} is not JSON.` };
    }
    if (!isRecord(root)) return { ok: false, refusal: `${file.name} is not a tokens file.` };
    const extension = isRecord(root["$extensions"]) && isRecord(root["$extensions"][UNFRAMED]) ? (root["$extensions"][UNFRAMED] as Record<string, unknown>) : undefined;
    const fileModes = Array.isArray(extension?.["modes"]) ? (extension["modes"] as unknown[]).filter((mode): mode is string => typeof mode === "string") : undefined;
    if (name === undefined && typeof extension?.["name"] === "string") name = extension["name"] as string;
    if (guidance === undefined && typeof extension?.["guidance"] === "string" && extension["guidance"].trim() !== "") guidance = extension["guidance"] as string;
    const mode = modeOfFile(file.name);
    const defaultMode = fileModes?.[0] ?? mode;
    for (const listed of fileModes ?? [mode]) if (!modes.includes(listed)) modes.push(listed);

    const visit = (node: Record<string, unknown>, segments: string[], inherited: string | undefined) => {
      const typeName = typeof node["$type"] === "string" ? (node["$type"] as string) : inherited;
      if (!Object.prototype.hasOwnProperty.call(node, "$value")) {
        for (const [key, child] of Object.entries(node)) {
          if (!key.startsWith("$") && isRecord(child)) visit(child, [...segments, key], typeName);
        }
        return;
      }
      const path = pathOf(segments.join("/"));
      // A DTCG number is a size only under a space, size or radius group; elsewhere it is not a token.
      const isNumberSize = typeName === "number" && DIMENSION_GROUPS.some((group) => path.split("/").includes(group));
      const dtcgType = isNumberSize ? "dimension" : typeName;
      const kitType = dtcgType === undefined ? undefined : KIT_TYPE[dtcgType];
      const value = kitType === undefined ? undefined : readDtcg(dtcgType!, node["$value"], path);
      if (kitType === undefined || value === undefined || path === "") {
        skipped++;
        return;
      }
      const ext = isRecord(node["$extensions"]) && isRecord(node["$extensions"][UNFRAMED]) ? (node["$extensions"][UNFRAMED] as Record<string, unknown>) : undefined;
      const easeName = kitType === "easing" && typeof ext?.["ease"] === "string" && isEaseName(ext["ease"] as string) ? (ext["ease"] as string) : undefined;
      const readValue = easeName ?? value;
      if (!holdsAlias(readValue) && valueRefusal({ path, type: kitType }, readValue, { format: 1, name: "x", modes: [defaultMode], tokens: [] }) !== null) {
        skipped++;
        return;
      }
      const existed = collected.has(path);
      const entry = collected.get(path) ?? { type: kitType, values: {}, shared: true };
      if (typeof node["$description"] === "string" && entry.description === undefined) entry.description = (node["$description"] as string).slice(0, 200);
      entry.values[defaultMode] = readValue as TokenValue;
      if (fileModes !== undefined && isRecord(ext?.["modes"])) {
        entry.shared = false;
        for (const [listed, raw] of Object.entries(ext["modes"] as Record<string, unknown>)) {
          if (typeof raw === "string" || typeof raw === "object") entry.values[listed] = raw as TokenValue;
        }
      }
      if (existed) entry.shared = false;
      collected.set(path, entry);
    };
    visit(root, [], undefined);
  }

  const fragment = assemble(collected, modes.length > 0 ? modes : [DEFAULT_MODE], skipped, name);
  return { ok: true, fragment: guidance === undefined ? fragment : { ...fragment, guidance } };
};

/** The kit path of a CSS custom property name: `--color-brand-primary` is `color/brand/primary`. */
const pathOfCssName = (name: string): string => name.replace(/^--/, "").split("-").join("/");

/** The kit type a CSS value reads as, by its shape and its name, or undefined. */
const typeOfCss = (name: string, value: string): TokenType | undefined => {
  if (parseBezier(value) !== null) return "easing";
  if (name.includes("shadow") && isShadow(value)) return "shadow";
  if (parseTime(value) !== null) return "duration";
  if (parseLength(value) !== null) return "dimension";
  if (parseColour(value) !== null) return "color";
  if (name.includes("weight") && parseWeight(value)) return "fontWeight";
  if ((name.includes("font") || name.includes("family")) && /[,"']/.test(value)) return "fontFamily";
  return undefined;
};

/** The mode a rule's selector names: `:root` is the default mode, a theme selector its mode, anything else none. */
const modeOfSelector = (selector: string): string | undefined => {
  if (selector === ":root") return DEFAULT_MODE;
  const patterns: ReadonlyArray<RegExp> = [/^\[data-theme\s*=\s*["']?([a-z0-9-]+)["']?\]$/i, /^:root\.([a-z0-9-]+)$/i, /^\.theme-([a-z0-9-]+)$/i, /^\.([a-z0-9-]+)$/i];
  for (const pattern of patterns) {
    const match = pattern.exec(selector);
    if (match) return match[1]!.toLowerCase();
  }
  return undefined;
};

/** Imports the custom properties of a stylesheet: `:root` is the default mode, each theme block its mode, and each value's type is read from its shape. */
export const fromCss = (text: string): ImportResult => {
  const collected = new Map<string, Collected>();
  const modes: string[] = [DEFAULT_MODE];
  let skipped = 0;
  const aliases: Array<{ path: string; target: string }> = [];

  for (const rule of parseStylesheet(text)) {
    const darkMedia = rule.atRules.length === 1 && /prefers-color-scheme\s*:\s*dark/i.test(rule.atRules[0]!) && rule.selector === ":root";
    const mode = rule.atRules.length === 0 ? modeOfSelector(rule.selector) : darkMedia ? "dark" : undefined;
    if (mode === undefined) {
      skipped += rule.declarations.length;
      continue;
    }
    if (!modes.includes(mode)) modes.push(mode);
    for (const declaration of rule.declarations) {
      if (!declaration.property.startsWith("--")) {
        skipped++;
        continue;
      }
      const path = pathOfCssName(declaration.property);
      const alias = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*\)$/.exec(declaration.value);
      if (alias) {
        aliases.push({ path, target: pathOfCssName(alias[1]!) });
        const entry = collected.get(path) ?? { type: "color" as TokenType, values: {}, shared: true };
        entry.values[mode] = `{${pathOfCssName(alias[1]!)}}`;
        entry.shared = false;
        collected.set(path, entry);
        continue;
      }
      const type = typeOfCss(declaration.property, declaration.value);
      const existing = collected.get(path);
      if (type === undefined || (existing !== undefined && existing.type !== type)) {
        skipped++;
        continue;
      }
      const entry = existing ?? { type, values: {}, shared: true };
      entry.values[mode] = type === "fontWeight" && /^\d+$/.test(declaration.value) ? Number(declaration.value) : declaration.value;
      if (existing !== undefined || mode !== DEFAULT_MODE) entry.shared = false;
      collected.set(path, entry);
    }
  }

  // An alias takes the type of the token it refers to. One that refers to no token is skipped.
  for (const { path, target } of aliases) {
    const entry = collected.get(path);
    if (entry === undefined) continue;
    const targetEntry = collected.get(target);
    if (targetEntry === undefined) {
      collected.delete(path);
      skipped++;
      continue;
    }
    entry.type = targetEntry.type;
  }

  return { ok: true, fragment: assemble(collected, modes, skipped) };
};

/** DTCG's form of a kit value, for the default mode's `$value`. */
const dtcgValue = (type: TokenType, value: TokenValue): unknown => {
  if (isAlias(value)) return `{${String(value).slice(1, -1).split("/").join(".")}}`;
  switch (type) {
    case "dimension": {
      const length = parseLength(String(value));
      return length !== null ? { value: length.value, unit: length.unit } : String(value);
    }
    case "duration": {
      const match = /^(-?(?:\d+\.?\d*|\.\d+))(ms|s)$/i.exec(String(value).trim());
      return match ? { value: Number(match[1]), unit: match[2]!.toLowerCase() } : String(value);
    }
    case "fontWeight":
      return typeof value === "number" ? value : /^\d+$/.test(String(value)) ? Number(value) : String(value);
    case "easing": {
      const text = String(value);
      if (isEaseName(text)) return cubicBezierOf(text) ?? [0, 0, 1, 1];
      return parseBezier(text) ?? [0, 0, 1, 1];
    }
    case "textStyle": {
      const style = value as unknown as Record<string, TokenValue>;
      return Object.fromEntries(
        TEXT_STYLE_FIELDS.map((field) => {
          const raw = style[field];
          if (field === "lineHeight" && typeof raw === "number") return [field, raw];
          const kind: TokenType = field === "fontFamily" ? "fontFamily" : field === "fontWeight" ? "fontWeight" : "dimension";
          return [field, dtcgValue(kind, raw as TokenValue)];
        }),
      );
    }
    default:
      return String(value);
  }
};

const DTCG_TYPE: Readonly<Record<TokenType, string>> = {
  color: "color",
  dimension: "dimension",
  fontFamily: "fontFamily",
  fontWeight: "fontWeight",
  textStyle: "typography",
  shadow: "shadow",
  duration: "duration",
  easing: "cubicBezier",
};

/** The DTCG JSON of a kit: a group per path segment, the default mode's value, and every mode's value and the guidance in the unframed extension. */
export const toDtcg = (kit: Kit): string => {
  const root: Record<string, unknown> = { $extensions: { [UNFRAMED]: { name: kit.name, modes: kit.modes, ...(kit.guidance === undefined ? {} : { guidance: kit.guidance }) } } };
  const defaultMode = kit.modes[0]!;
  for (const token of kit.tokens) {
    const segments = token.path.split("/");
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      if (!isRecord(node[segment])) node[segment] = {};
      node = node[segment] as Record<string, unknown>;
    }
    const values: Record<string, TokenValue> = token.value !== undefined ? { [defaultMode]: token.value } : { ...token.values };
    const current = values[defaultMode] ?? Object.values(values)[0]!;
    const leaf: Record<string, unknown> = { $type: DTCG_TYPE[token.type], $value: dtcgValue(token.type, current) };
    if (token.description !== undefined) leaf["$description"] = token.description;
    const extension: Record<string, unknown> = {};
    if (token.type === "easing" && isEaseName(String(current))) extension["ease"] = String(current);
    if (token.values !== undefined) extension["modes"] = { ...token.values };
    if (Object.keys(extension).length > 0) leaf["$extensions"] = { [UNFRAMED]: extension };
    node[segments[segments.length - 1]!] = leaf;
  }
  return JSON.stringify(root, null, 2) + "\n";
};

/** The CSS custom properties, exactly as the tokens script writes them. */
export const toCss = (kit: Kit): string => kitCss(kit);

/** Tailwind v4 `@theme`: the default mode inside `@theme`, the other modes as theme blocks. */
export const toTailwind = (kit: Kit): string => {
  const title = kit.name.replace(/\*\//g, "* /");
  return [
    `/* Tokens from the Unframed kit "${title}". Tokens under Tailwind's namespaces (color, spacing, radius, font, text, shadow, ease) become utilities; the rest are plain variables. */`,
    kitCss(kit).replace(/^:root \{/, "@theme {"),
  ].join("\n");
};
