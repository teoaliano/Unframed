import type { DesignTokenCategory, DesignTokenOrigin, ScaleToken, TokenGroup, TokenScale } from "@unframed/contracts";
import type { DesignSystemIndex } from "../repoAnalysis/types.ts";
import { classNames, parseColour, readClass, type TailwindToken, type TokenKind } from "../tailwind.ts";

export type { DesignTokenCategory, ScaleToken, TokenGroup, TokenScale };

export interface CssSource {
  readonly file: string;
  readonly text: string;
}

export interface TokenScaleInput {
  readonly css: ReadonlyArray<CssSource>;
  readonly designSystem?: DesignSystemIndex | null;
}

export interface SnappedToken extends TailwindToken {
  readonly label: string;
  readonly px: number;
  readonly token: ScaleToken;
}

export interface BoundToken {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly token: ScaleToken | null;
}

export interface TokenOfInput {
  readonly computed: string;
  readonly className?: string | null;
  readonly authored?: string | null;
}

export const EMPTY_SCALE: TokenScale = { colors: [], colorGroups: [], spacing: [], sizes: [], radii: [], fontSizes: [], lineHeights: [], tracking: [], families: [], weights: [], shadows: [], other: [] };

type Scope = "theme" | "root" | "other";

interface Declaration {
  readonly name: string;
  readonly value: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly scope: Scope;
}

const ROOT_PX = 16;

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));

const scopeOf = (preludes: ReadonlyArray<string>): Scope => {
  if (preludes.some((prelude) => /^@theme\b/.test(prelude))) return "theme";
  const inner = preludes.filter((prelude) => !/^@layer\b/.test(prelude));
  if (inner.length === 1 && /^(:root|html|:host)$/.test(inner[0]!.trim())) return "root";
  return "other";
};

const declarationsOf = (file: string, source: string): Declaration[] => {
  const text = stripComments(source);
  const found: Declaration[] = [];
  const stack: string[] = [];
  let start = 0;
  let parens = 0;
  let quote: string | null = null;
  const lineAt = (index: number) => text.slice(0, index).split("\n").length;
  const statement = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const match = /^(--[\w*-]+)\s*:([\s\S]*)$/.exec(raw.trim());
    if (match !== null && stack.length > 0) found.push({ name: match[1]!, value: match[2]!.trim().replace(/\s+/g, " "), file, line: lineAt(start + lead), scope: scopeOf(stack) });
  };
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (quote !== null) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") parens++;
    else if (char === ")") parens = Math.max(0, parens - 1);
    else if (parens > 0) continue;
    else if (char === ";") {
      statement(index);
      start = index + 1;
    } else if (char === "{") {
      stack.push(text.slice(start, index).trim());
      start = index + 1;
    } else if (char === "}") {
      statement(index);
      stack.pop();
      start = index + 1;
    }
  }
  return found;
};

const usesTailwind = (css: ReadonlyArray<CssSource>, index: DesignSystemIndex | null | undefined): boolean =>
  css.some((source) => /@import\s+["']tailwindcss|@tailwind\s|@theme\b|@config\s/.test(source.text)) || (index?.tokens ?? []).some((token) => token.source === "tailwind");

const SPACING_STEPS = ["0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14", "16", "20", "24", "28", "32", "36", "40", "44", "48", "52", "56", "60", "64", "72", "80", "96"];
const FRAMEWORK: ReadonlyArray<readonly [string, string]> = [
  ["--radius-xs", "0.125rem"],
  ["--radius-sm", "0.25rem"],
  ["--radius-md", "0.375rem"],
  ["--radius-lg", "0.5rem"],
  ["--radius-xl", "0.75rem"],
  ["--radius-2xl", "1rem"],
  ["--radius-3xl", "1.5rem"],
  ["--radius-4xl", "2rem"],
  ["--text-xs", "0.75rem"],
  ["--text-xs--line-height", "1rem"],
  ["--text-sm", "0.875rem"],
  ["--text-sm--line-height", "1.25rem"],
  ["--text-base", "1rem"],
  ["--text-base--line-height", "1.5rem"],
  ["--text-lg", "1.125rem"],
  ["--text-lg--line-height", "1.75rem"],
  ["--text-xl", "1.25rem"],
  ["--text-xl--line-height", "1.75rem"],
  ["--text-2xl", "1.5rem"],
  ["--text-2xl--line-height", "2rem"],
  ["--text-3xl", "1.875rem"],
  ["--text-3xl--line-height", "2.25rem"],
  ["--text-4xl", "2.25rem"],
  ["--text-4xl--line-height", "2.5rem"],
  ["--text-5xl", "3rem"],
  ["--text-5xl--line-height", "1"],
  ["--text-6xl", "3.75rem"],
  ["--text-6xl--line-height", "1"],
  ["--text-7xl", "4.5rem"],
  ["--text-7xl--line-height", "1"],
  ["--text-8xl", "6rem"],
  ["--text-8xl--line-height", "1"],
  ["--text-9xl", "8rem"],
  ["--text-9xl--line-height", "1"],
  ["--font-sans", 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'],
  ["--font-serif", 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'],
  ["--font-mono", 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'],
  ["--font-weight-thin", "100"],
  ["--font-weight-extralight", "200"],
  ["--font-weight-light", "300"],
  ["--font-weight-normal", "400"],
  ["--font-weight-medium", "500"],
  ["--font-weight-semibold", "600"],
  ["--font-weight-bold", "700"],
  ["--font-weight-extrabold", "800"],
  ["--font-weight-black", "900"],
  ["--tracking-tighter", "-0.05em"],
  ["--tracking-tight", "-0.025em"],
  ["--tracking-normal", "0em"],
  ["--tracking-wide", "0.025em"],
  ["--tracking-wider", "0.05em"],
  ["--tracking-widest", "0.1em"],
  ["--leading-tight", "1.25"],
  ["--leading-snug", "1.375"],
  ["--leading-normal", "1.5"],
  ["--leading-relaxed", "1.625"],
  ["--leading-loose", "2"],
  ["--shadow-2xs", "0 1px rgb(0 0 0 / 0.05)"],
  ["--shadow-xs", "0 1px 2px 0 rgb(0 0 0 / 0.05)"],
  ["--shadow-sm", "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)"],
  ["--shadow-md", "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)"],
  ["--shadow-lg", "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)"],
  ["--shadow-xl", "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)"],
  ["--shadow-2xl", "0 25px 50px -12px rgb(0 0 0 / 0.25)"],
  ["--container-3xs", "16rem"],
  ["--container-2xs", "18rem"],
  ["--container-xs", "20rem"],
  ["--container-sm", "24rem"],
  ["--container-md", "28rem"],
  ["--container-lg", "32rem"],
  ["--container-xl", "36rem"],
  ["--container-2xl", "42rem"],
  ["--container-3xl", "48rem"],
  ["--container-4xl", "56rem"],
  ["--container-5xl", "64rem"],
  ["--container-6xl", "72rem"],
  ["--container-7xl", "80rem"],
];

const V3_NAMESPACE: Readonly<Record<string, string>> = { color: "--color-", radius: "--radius-", spacing: "--spacing-", font: "--font-", shadow: "--shadow-" };

const varRef = (value: string): string | undefined => /^var\(\s*(--[\w-]+)\s*(?:,[\s\S]*)?\)$/.exec(value.trim())?.[1];

type Num = { readonly n: number; readonly px: boolean };

const evaluate = (expression: string): number | undefined => {
  const tokens = expression.match(/\d*\.?\d+(?:px|rem)?|[-+*/()]/g);
  if (tokens === null || tokens.join("") !== expression.replace(/\s+/g, "")) return undefined;
  let at = 0;
  const atom = (): Num | undefined => {
    const token = tokens[at++];
    if (token === undefined) return undefined;
    if (token === "(") {
      const inner = sum();
      return tokens[at++] === ")" ? inner : undefined;
    }
    if (token === "-") {
      const inner = atom();
      return inner === undefined ? undefined : { n: -inner.n, px: inner.px };
    }
    const match = /^(\d*\.?\d+)(px|rem)?$/.exec(token);
    if (match === null) return undefined;
    const n = Number(match[1]);
    return match[2] === "rem" ? { n: n * ROOT_PX, px: true } : { n, px: match[2] === "px" };
  };
  const product = (): Num | undefined => {
    let left = atom();
    while (left !== undefined && (tokens[at] === "*" || tokens[at] === "/")) {
      const op = tokens[at++];
      const right = atom();
      if (right === undefined) return undefined;
      if (op === "*") left = left.px && right.px ? undefined : { n: left.n * right.n, px: left.px || right.px };
      else left = right.px ? undefined : { n: left.n / right.n, px: left.px };
    }
    return left;
  };
  const sum = (): Num | undefined => {
    let left = product();
    while (left !== undefined && (tokens[at] === "+" || tokens[at] === "-")) {
      const op = tokens[at++];
      const right = product();
      if (right === undefined || right.px !== left.px) return undefined;
      left = { n: op === "+" ? left.n + right.n : left.n - right.n, px: left.px };
    }
    return left;
  };
  const result = sum();
  if (result === undefined || at !== tokens.length) return undefined;
  if (!result.px && result.n !== 0) return undefined;
  return Math.round(result.n * 1000) / 1000;
};

interface Resolver {
  readonly value: (name: string) => string | undefined;
}

const pxIn = (value: string, resolver: Resolver, seen: ReadonlySet<string> = new Set()): number | undefined => {
  let text = value.trim();
  if (text === "0") return 0;
  let failed = false;
  text = text.replace(/var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g, (_, name: string) => {
    const inner = resolver.value(name);
    const px = inner === undefined || seen.has(name) ? undefined : pxIn(inner, resolver, new Set([...seen, name]));
    if (px === undefined) failed = true;
    return `${px ?? 0}px`;
  });
  if (failed) return undefined;
  text = text.replace(/^calc\(([\s\S]*)\)$/, "$1");
  return evaluate(text);
};

const hexOf = (value: string): string | null => {
  const rgba = parseColour(value);
  if (rgba === undefined) return null;
  const hex = rgba
    .slice(0, 3)
    .map((part) => Math.round(part).toString(16).padStart(2, "0"))
    .join("");
  const alpha = rgba[3] < 1 ? Math.round(rgba[3] * 255).toString(16).padStart(2, "0") : "";
  return `#${hex}${alpha}`.toUpperCase();
};

const looksColour = (value: string): boolean => /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|color-mix)\(|transparent$|currentcolor$|white$|black$)/i.test(value.trim());

const topLevel = (value: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value.charAt(index);
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(value.slice(from, index).trim());
      from = index + 1;
    }
  }
  parts.push(value.slice(from).trim());
  return parts.filter((part) => part !== "");
};

const shadowOf = (value: string): { layers: number; blur: number } | undefined => {
  if (value.trim() === "none") return undefined;
  const layers = topLevel(value);
  const lengths = (layer: string) => layer.replace(/\([^()]*\)/g, " ").split(/\s+/).filter((word) => /^-?(\d*\.?\d+)(px|rem)?$/.test(word));
  if (layers.length === 0 || !layers.every((layer) => lengths(layer).length >= 2)) return undefined;
  const first = lengths(layers[0]!);
  const blur = first[2] === undefined ? 0 : (evaluate(first[2]) ?? Number(first[2].replace(/px|rem/, "")));
  return { layers: layers.length, blur };
};

const PALETTE = /^[a-z]+-\d{2,3}$/;
const TEXT_WORDS = new Set(["text", "foreground", "fg"]);
const SURFACE_WORDS = new Set(["surface", "background", "bg", "card", "popover", "panel", "canvas"]);
const BORDER_WORDS = new Set(["border", "stroke", "ring", "outline", "divider", "separator", "input"]);

const colourGroup = (name: string): string => {
  const bare = name.replace(/^color-/, "");
  if (name.startsWith("color-") && PALETTE.test(bare)) return "Palettes";
  const first = bare.split("-")[0]!;
  if (TEXT_WORDS.has(first)) return "Text";
  if (SURFACE_WORDS.has(first)) return "Surfaces";
  if (BORDER_WORDS.has(first)) return "Borders";
  return first.charAt(0).toUpperCase() + first.slice(1);
};

const THEME_NAMESPACES: ReadonlyArray<readonly [string, DesignTokenCategory]> = [
  ["--color-", "color"],
  ["--spacing-", "spacing"],
  ["--radius-", "radius"],
  ["--font-weight-", "font-weight"],
  ["--font-", "font-family"],
  ["--leading-", "line-height"],
  ["--tracking-", "tracking"],
  ["--inset-shadow-", "shadow"],
  ["--drop-shadow-", "shadow"],
  ["--shadow-", "shadow"],
  ["--container-", "size"],
  ["--text-", "font-size"],
];

const themeCategory = (name: string): { category: DesignTokenCategory; step: string } | undefined => {
  if (name === "--radius") return { category: "radius", step: "" };
  for (const [prefix, category] of THEME_NAMESPACES) if (name.startsWith(prefix)) return { category, step: name.slice(prefix.length) };
  return undefined;
};

const customCategory = (name: string, resolved: string, px: number | undefined): DesignTokenCategory => {
  if (looksColour(resolved)) return "color";
  if (/shadow/i.test(name) || (resolved !== "none" && shadowOf(resolved) !== undefined && /rgb|#|hsl|oklch/.test(resolved))) return "shadow";
  if (/radius|rounded/i.test(name) && px !== undefined) return "radius";
  if (/font-family|-family$/i.test(name) || (/font/i.test(name) && /,|["']/.test(resolved))) return "font-family";
  if (/weight/i.test(name) && /^\d{3}$/.test(resolved)) return "font-weight";
  if (/font-size/i.test(name) && px !== undefined) return "font-size";
  if (/line-height|leading/i.test(name)) return "line-height";
  if (/letter-spacing|tracking/i.test(name)) return "tracking";
  if (/opacity/i.test(name) && /^(0?\.\d+|1|0)$/.test(resolved)) return "opacity";
  if (px !== undefined) return "spacing";
  return "other";
};

const SCOPE_RANK: Readonly<Record<Scope, number>> = { theme: 0, root: 1, other: 2 };

export const tokenScaleOf = (input: TokenScaleInput): TokenScale => {
  const tailwind = usesTailwind(input.css, input.designSystem);
  const declarations = input.css.flatMap((source) => declarationsOf(source.file, source.text));
  for (const token of input.designSystem?.tokens ?? []) {
    if (token.source === "tailwind") {
      const prefix = V3_NAMESPACE[token.kind];
      if (prefix !== undefined) declarations.push({ name: `${prefix}${token.name}`, value: token.value, file: token.file, line: token.line, scope: "theme" });
    } else if (token.name.startsWith("--")) declarations.push({ name: token.name, value: token.value, file: token.file, line: token.line, scope: "root" });
  }
  const cleared = declarations.filter((each) => each.scope === "theme" && /^--[\w-]*\*$/.test(each.name) && each.value === "initial").map((each) => each.name.slice(0, -1));
  const defined = new Map<string, Declaration>();
  for (const each of declarations) {
    if (each.name.endsWith("*")) continue;
    const earlier = defined.get(each.name);
    if (earlier === undefined || SCOPE_RANK[each.scope] < SCOPE_RANK[earlier.scope]) defined.set(each.name, each);
  }
  const framework = new Map<string, string>();
  if (tailwind) {
    for (const [name, value] of FRAMEWORK) if (!cleared.some((prefix) => name.startsWith(prefix))) framework.set(name, value);
    if (!defined.has("--spacing") && !cleared.includes("--spacing-")) framework.set("--spacing", "0.25rem");
  }
  const resolver: Resolver = { value: (name) => defined.get(name)?.value ?? framework.get(name) };
  const chainOf = (name: string): { chain: string[]; resolved: string } => {
    const chain = [name];
    let value = resolver.value(name) ?? "";
    for (let next = varRef(value); next !== undefined && !chain.includes(next); next = varRef(value)) {
      const inner = resolver.value(next);
      if (inner === undefined) break;
      chain.push(next);
      value = inner;
    }
    return { chain: chain.length > 1 ? chain : [], resolved: value };
  };

  const tokens: ScaleToken[] = [];
  const make = (name: string, value: string, origin: DesignTokenOrigin, category: DesignTokenCategory, step: string | null, at: Declaration | undefined): ScaleToken => {
    const { chain, resolved } = origin === "framework" ? { chain: [], resolved: value } : chainOf(name);
    const px = category === "color" || category === "font-family" || category === "font-weight" || category === "shadow" || category === "other" ? undefined : pxIn(resolved, resolver);
    const shadow = category === "shadow" ? shadowOf(resolved) : undefined;
    const bare = name.slice(2);
    return {
      name: bare,
      variable: origin === "framework" ? null : name,
      category,
      origin,
      value,
      resolved,
      px: px ?? null,
      step,
      chain,
      group: category === "color" ? colourGroup(bare) : origin === "custom" ? "Semantic" : "Scale",
      file: at?.file ?? null,
      line: at?.line ?? null,
      hex: category === "color" ? hexOf(resolved) : null,
      lineHeight: null,
      layers: shadow?.layers ?? null,
      blur: shadow?.blur ?? null,
    };
  };

  const themeNames = new Set<string>();
  for (const [name, value] of framework) {
    if (name === "--spacing" || name.includes("--line-height") || defined.get(name)?.scope === "theme") continue;
    const theme = themeCategory(name)!;
    tokens.push(make(name, value, "framework", theme.category, theme.step, undefined));
  }
  if (tailwind) {
    for (const step of SPACING_STEPS) {
      const value = step === "px" ? "1px" : step === "0" ? "0px" : `calc(var(--spacing) * ${step})`;
      const token = make(`--spacing-${step}`, value, "framework", "spacing", step, undefined);
      tokens.push({ ...token, px: step === "px" ? 1 : (pxIn(value, resolver) ?? null) });
    }
  }
  for (const each of defined.values()) {
    if (each.name === "--spacing" || each.name.includes("--line-height")) continue;
    const theme = each.scope === "theme" ? themeCategory(each.name) : undefined;
    if (theme !== undefined) {
      themeNames.add(each.name);
      tokens.push(make(each.name, each.value, "theme", theme.category, theme.step, each));
      continue;
    }
    if (each.scope === "theme") continue;
    const { chain, resolved } = chainOf(each.name);
    const target = chain.at(-1);
    const targetTheme = target !== undefined && defined.get(target)?.scope !== "root" ? themeCategory(target) : undefined;
    const px = pxIn(resolved, resolver);
    const guessed = customCategory(each.name, resolved, px);
    const category = guessed === "other" || guessed === "spacing" ? (targetTheme?.category ?? guessed) : guessed;
    tokens.push(make(each.name, each.value, "custom", category, `(${each.name})`, each));
  }
  const lineHeightOf = (step: string): string | null => {
    const raw = defined.get(`--text-${step}--line-height`)?.value ?? framework.get(`--text-${step}--line-height`);
    if (raw === undefined) return null;
    const px = pxIn(raw, resolver);
    return px === undefined ? raw : `${px}px`;
  };
  const sizeOf = (token: ScaleToken): ScaleToken => (token.category === "font-size" && token.step !== null && token.origin !== "custom" ? { ...token, lineHeight: lineHeightOf(token.step) } : token);
  const all = tokens.map(sizeOf);
  const ofCategory = (category: DesignTokenCategory) => all.filter((token) => token.category === category);
  const byPx = (list: ScaleToken[]) => [...list].sort((a, b) => (a.group === b.group ? 0 : a.group === "Scale" ? -1 : b.group === "Scale" ? 1 : 0) || (a.px ?? Infinity) - (b.px ?? Infinity));
  const spacing = byPx(ofCategory("spacing"));
  const colors = ofCategory("color");
  const named = new Map<string, string[]>();
  for (const token of colors) named.set(token.group, [...(named.get(token.group) ?? []), token.name]);
  const fixed = ["Text", "Surfaces", "Borders", "Palettes"];
  const other: string[] = [];
  const prefixed: TokenGroup[] = [];
  for (const [name, list] of named) {
    if (fixed.includes(name)) continue;
    if (list.length < 2) other.push(...list);
    else prefixed.push({ name, count: list.length, tokens: list });
  }
  prefixed.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
  const colorGroups: TokenGroup[] = [
    ...fixed.filter((name) => named.has(name)).map((name) => ({ name, count: named.get(name)!.length, tokens: named.get(name)! })),
    ...prefixed,
    ...(other.length > 0 ? [{ name: "Other", count: other.length, tokens: other }] : []),
  ];
  const sizes = [...byPx(ofCategory("size")), ...spacing.filter((token) => token.origin === "custom" && /width|height|size/i.test(token.name))];
  return {
    colors: colors.map((token) => (named.get(token.group)!.length < 2 && !fixed.includes(token.group) ? { ...token, group: "Other" } : token)),
    colorGroups,
    spacing,
    sizes,
    radii: byPx(ofCategory("radius")),
    fontSizes: byPx(ofCategory("font-size")),
    lineHeights: ofCategory("line-height"),
    tracking: ofCategory("tracking"),
    families: ofCategory("font-family"),
    weights: [...ofCategory("font-weight")].sort((a, b) => Number(a.resolved) - Number(b.resolved)),
    shadows: ofCategory("shadow"),
    other: [...ofCategory("other"), ...ofCategory("opacity")],
  };
};

const SIDE_PREFIX: Readonly<Record<string, string>> = { top: "t", right: "r", bottom: "b", left: "l" };

const PREFIXES = (property: string): ReadonlyArray<string> => {
  const box = /^(padding|margin)-(top|right|bottom|left)$/.exec(property);
  if (box !== null) {
    const letter = box[1] === "padding" ? "p" : "m";
    const side = SIDE_PREFIX[box[2]!]!;
    return [`${letter}${side}`, `${letter}${side === "t" || side === "b" ? "y" : "x"}`, letter];
  }
  const corner = /^border-(top|bottom)-(left|right)-radius$/.exec(property);
  if (corner !== null) {
    const v = SIDE_PREFIX[corner[1]!]!;
    const h = SIDE_PREFIX[corner[2]!]!;
    return [`rounded-${v}${h}`, `rounded-${v}`, `rounded-${h}`, "rounded"];
  }
  const map: Readonly<Record<string, ReadonlyArray<string>>> = {
    padding: ["p"],
    margin: ["m"],
    gap: ["gap"],
    "column-gap": ["gap-x", "gap"],
    "row-gap": ["gap-y", "gap"],
    width: ["w", "size"],
    height: ["h", "size"],
    "min-width": ["min-w"],
    "min-height": ["min-h"],
    "max-width": ["max-w"],
    "max-height": ["max-h"],
    top: ["top", "inset-y", "inset"],
    bottom: ["bottom", "inset-y", "inset"],
    left: ["left", "inset-x", "inset"],
    right: ["right", "inset-x", "inset"],
    "border-radius": ["rounded"],
    "font-size": ["text"],
    "line-height": ["leading"],
    "letter-spacing": ["tracking"],
    "font-weight": ["font"],
    "font-family": ["font"],
    color: ["text"],
    "background-color": ["bg"],
    "border-color": ["border"],
    "outline-color": ["outline"],
    fill: ["fill"],
    stroke: ["stroke"],
    "text-decoration-color": ["decoration"],
    "box-shadow": ["shadow"],
  };
  return map[property] ?? [];
};

const CATEGORIES = (property: string): ReadonlyArray<keyof Omit<TokenScale, "colorGroups">> => {
  if (/^(padding|margin|gap|column-gap|row-gap|top|right|bottom|left)(-|$)/.test(property)) return ["spacing"];
  if (/^(min-|max-)?(width|height)$/.test(property)) return ["spacing", "sizes"];
  if (/radius$/.test(property)) return ["radii"];
  if (property === "font-size") return ["fontSizes"];
  if (property === "line-height") return ["lineHeights", "spacing"];
  if (property === "letter-spacing") return ["tracking"];
  if (property === "font-weight") return ["weights"];
  if (property === "font-family") return ["families"];
  if (/(^|-)color$|^fill$|^stroke$/.test(property)) return ["colors"];
  if (property === "box-shadow") return ["shadows"];
  return [];
};

const KIND_OF = (property: string): TokenKind => {
  const category = CATEGORIES(property)[0];
  if (category === "spacing") return /width|height/.test(property) ? "size" : "spacing";
  if (category === "radii") return "radius";
  if (category === "fontSizes") return "font-size";
  if (category === "lineHeights") return "line-height";
  if (category === "tracking") return "tracking";
  if (category === "weights") return "font-weight";
  if (category === "families") return "font-family";
  if (category === "colors") return "color";
  if (category === "shadows") return "shadow";
  return "spacing";
};

export const tokensFor = (scale: TokenScale, property: string): ReadonlyArray<ScaleToken> => {
  const seen = new Set<string>();
  return CATEGORIES(property)
    .flatMap((category) => scale[category])
    .filter((token) => {
      if (seen.has(token.name)) return false;
      seen.add(token.name);
      return true;
    });
};

export const classForToken = (property: string, token: ScaleToken): string | undefined => {
  const prefix = PREFIXES(property)[0];
  if (prefix === undefined || token.step === null || !CATEGORIES(property).some((category) => (category === "sizes" ? token.category === "size" || token.category === "spacing" : true))) return undefined;
  if (token.step === "") return prefix;
  const step = token.origin === "custom" && property === "font-size" ? `(length:${token.variable})` : token.step;
  return `${prefix}-${step}`;
};

const labelOf = (property: string, token: ScaleToken, className: string): string => (token.category === "spacing" && token.origin !== "custom" ? className : token.name);

export const snapToken = (scale: TokenScale, property: string, px: number, threshold = 2): SnappedToken | undefined => {
  const rank: Readonly<Record<DesignTokenOrigin, number>> = { framework: 0, theme: 1, custom: 2 };
  let best: { token: ScaleToken; distance: number; order: number } | undefined;
  tokensFor(scale, property).forEach((token, order) => {
    if (token.px === null) return;
    const distance = Math.abs(token.px - px);
    if (distance > threshold + 1e-9) return;
    if (best === undefined || distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) < 1e-9 && (rank[token.origin] < rank[best.token.origin] || (rank[token.origin] === rank[best.token.origin] && order < best.order)))) best = { token, distance, order };
  });
  if (best === undefined) return undefined;
  const className = classForToken(property, best.token);
  if (className === undefined) return undefined;
  const value = `${best.token.px}px`;
  return { name: className, value, kind: KIND_OF(property), label: labelOf(property, best.token, className), px: best.token.px!, token: best.token };
};

const variantless = (name: string): string => {
  let depth = 0;
  let cut = -1;
  for (let index = 0; index < name.length; index++) {
    const char = name.charAt(index);
    if (char === "[" || char === "(") depth++;
    else if (char === "]" || char === ")") depth--;
    else if (char === ":" && depth === 0) cut = index;
  }
  return name.slice(cut + 1).replace(/^!|!$/g, "");
};

const ALL_PREFIXES = ["min-w", "min-h", "max-w", "max-h", "gap-x", "gap-y", "inset-x", "inset-y", "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl", "rounded-t", "rounded-r", "rounded-b", "rounded-l", "rounded", "leading", "tracking", "shadow", "opacity", "decoration", "outline", "border", "stroke", "inset", "bottom", "right", "left", "top", "text", "font", "fill", "gap", "bg", "size", "px", "py", "pt", "pr", "pb", "pl", "mx", "my", "mt", "mr", "mb", "ml", "p", "m", "w", "h"];

export const tokenLabel = (_property: string, name: string): string => {
  if (name.startsWith("--")) return name.slice(2);
  const bare = variantless(name);
  if (bare === "rounded") return "DEFAULT";
  const prefix = ALL_PREFIXES.find((each) => bare.startsWith(`${each}-`));
  if (prefix === undefined) return bare;
  const rest = bare.slice(prefix.length + 1);
  if (rest === "full") return "Full";
  const variable = /^\((?:[a-z-]+:)?--([\w-]+)\)$/.exec(rest);
  if (variable !== null) return variable[1]!;
  if (/^\[.*\]$/.test(rest)) return rest.slice(1, -1);
  return rest;
};

export const tokenOf = (scale: TokenScale, property: string, input: TokenOfInput): BoundToken | undefined => {
  const prefixes = PREFIXES(property);
  const candidates = tokensFor(scale, property);
  const valueOf = (token: ScaleToken | null) => (token === null ? input.computed : token.px !== null ? `${token.px}px` : token.resolved);
  const own = classNames(input.className).filter((name) => variantless(name) === name);
  for (const prefix of prefixes) {
    for (const name of own) {
      if (!name.startsWith(`${prefix}-`)) continue;
      const rest = name.slice(prefix.length + 1);
      const token = candidates.find((each) => each.step === rest || (each.origin === "custom" && rest === `(length:${each.variable})`));
      if (token !== undefined) return { name, label: tokenLabel(property, name), value: valueOf(token), token };
    }
  }
  for (const prefix of prefixes) {
    for (const name of own) {
      if (!name.startsWith(`${prefix}-`) || name.includes("[")) continue;
      const read = readClass(name);
      if (read !== undefined && (read.sets.includes(property) || (property.endsWith("-radius") && read.sets.includes("border-radius")))) return { name, label: tokenLabel(property, name), value: input.computed, token: null };
    }
  }
  const variable = input.authored === null || input.authored === undefined ? undefined : varRef(input.authored);
  if (variable !== undefined) {
    const token = [...candidates, ...scale.other].find((each) => each.variable === variable) ?? null;
    return { name: variable, label: tokenLabel(property, variable), value: valueOf(token), token };
  }
  return undefined;
};
