import type { DesignComponent, DesignSystemIndex, DesignToken, DesignTokenKind, SourceFiles } from "./types.ts";
import { entriesOf, firstBrace, lineAt, matchingClose, objectEntries, sortedPaths } from "./text.ts";

const COMPONENT_FILE = /\.(?:tsx|jsx)$/;
const SFC_FILE = /\.(?:vue|svelte)$/;
const STYLE_FILE = /\.(?:css|scss|pcss)$/;
const TAILWIND_CONFIG = /(?:^|\/)tailwind\.config\.(?:js|cjs|mjs|ts)$/;

interface Definition {
  readonly name: string;
  readonly at: number;
}

const definitionsIn = (source: string): Definition[] => {
  const exported = new Set<string>();
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1]!.split(",")) {
      const local = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (local !== undefined && /^[A-Z]/.test(local)) exported.add(local);
    }
  }
  const defaultName = /export\s+default\s+([A-Z][\w$]*)\s*;?\s*(?:\n|$)/.exec(source)?.[1];
  if (defaultName !== undefined) exported.add(defaultName);
  const found: Definition[] = [];
  const seen = new Set<string>();
  const add = (name: string, at: number, isExported: boolean) => {
    if (seen.has(name) || (!isExported && !exported.has(name))) return;
    seen.add(name);
    found.push({ name, at });
  };
  for (const match of source.matchAll(/(?:^|\n)[ \t]*(export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Z][\w$]*)\s*[<(]/g)) add(match[2]!, match.index + match[0].indexOf(match[2]!), match[1] !== undefined);
  for (const match of source.matchAll(/(?:^|\n)[ \t]*(export\s+)?const\s+([A-Z][\w$]*)\s*(?::[^=\n]+)?=\s*(?:(?:React\.)?(?:forwardRef|memo)\b|(?:async\s*)?\(|(?:async\s+)?function\b|<[\w\s,]*>\s*\()/g)) {
    add(match[2]!, match.index + match[0].indexOf(match[2]!), match[1] !== undefined);
  }
  return found;
};

const typeKeys = (source: string, open: number): string[] => entriesOf(source, open).map((entry) => entry.key);

const propsOf = (source: string, name: string, at: number): string[] => {
  const named = new RegExp(`(?:interface\\s+${name}Props\\b[^{]*|type\\s+${name}Props\\s*=[^{;]*?)\\{`).exec(source);
  if (named !== null) {
    const keys = typeKeys(source, named.index + named[0].length - 1);
    if (keys.length > 0) return [...new Set(keys)];
  }
  const head = source.slice(at, at + 400);
  const param = /^[\w$]*\s*(?::[^=\n]+)?=?\s*(?:(?:React\.)?(?:forwardRef|memo)\s*(?:<[^>]*>)?\s*\(\s*)?(?:(?:async\s+)?function\s*[\w$]*\s*)?(?:<[^>]*>\s*)?\(\s*\{/.exec(head) ?? /^[\w$]*\s*(?:<[^>]*>)?\s*\(\s*\{/.exec(head);
  if (param === null) return [];
  const open = at + param[0].length - 1;
  const close = matchingClose(source, open);
  if (close === -1) return [];
  return source
    .slice(open + 1, close)
    .split(",")
    .map((part) => /^\s*([A-Za-z_$][\w$]*)/.exec(part)?.[1])
    .filter((key): key is string => key !== undefined);
};

const cvaVariants = (source: string): Array<{ readonly name: string; readonly variants: Record<string, string[]> }> => {
  const found: Array<{ readonly name: string; readonly variants: Record<string, string[]> }> = [];
  for (const match of source.matchAll(/(?:const|let)\s+([\w$]+)\s*=\s*(?:cva|tv)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchingClose(source, open);
    if (close === -1) continue;
    const body = source.slice(open, close);
    const key = /\bvariants\s*:\s*\{/.exec(body);
    const variants: Record<string, string[]> = {};
    if (key !== null) {
      for (const entry of objectEntries(source, open + key.index + key[0].length - 1)) {
        const brace = firstBrace(source, entry.valueAt);
        if (brace !== -1) variants[entry.key] = objectEntries(source, brace).map((option) => option.key);
      }
    }
    found.push({ name: match[1]!, variants });
  }
  return found;
};

const sfcProps = (path: string, source: string): string[] => {
  if (path.endsWith(".svelte")) {
    const props = [...source.matchAll(/export\s+let\s+([\w$]+)/g)].map((match) => match[1]!);
    const runes = /let\s*\{([^}]*)\}\s*(?::[^=]+)?=\s*\$props\(\)/.exec(source);
    if (runes !== null) props.push(...runes[1]!.split(",").map((part) => /^\s*([\w$]+)/.exec(part)?.[1]).filter((key): key is string => key !== undefined));
    return props;
  }
  const generic = /defineProps\s*<\s*\{/.exec(source);
  if (generic !== null) return typeKeys(source, generic.index + generic[0].length - 1);
  const object = /defineProps\s*\(\s*\{|props\s*:\s*\{/.exec(source);
  if (object !== null) return objectEntries(source, object.index + object[0].length - 1).map((entry) => entry.key);
  const list = /defineProps\s*\(\s*\[([^\]]*)\]/.exec(source);
  return list === null ? [] : [...list[1]!.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]!);
};

const pascal = (name: string): string =>
  name
    .split(/[-_.\s]+/)
    .filter((part) => part !== "")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");

type Usages = ReadonlyMap<string, ReadonlyMap<string, number>>;

const usagesOf = (files: SourceFiles): Usages => {
  const usages = new Map<string, Map<string, number>>();
  for (const [path, source] of files) {
    if (!/\.(?:tsx|jsx|vue|svelte|astro|mdx)$/.test(path)) continue;
    for (const match of source.matchAll(/<([A-Za-z_$][\w$]*)(?=[\s/>])/g)) {
      const counts = usages.get(match[1]!) ?? new Map<string, number>();
      counts.set(path, (counts.get(path) ?? 0) + 1);
      usages.set(match[1]!, counts);
    }
  }
  return usages;
};

const usageOf = (usages: Usages, name: string, home: string): { readonly uses: number; readonly usedIn: string[] } => {
  const counts = [...(usages.get(name) ?? new Map<string, number>())].filter(([path]) => path !== home).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return { uses: counts.reduce((sum, [, count]) => sum + count, 0), usedIn: counts.slice(0, 5).map(([path]) => path) };
};

const componentsOf = (files: SourceFiles): DesignComponent[] => {
  const usages = usagesOf(files);
  const components: DesignComponent[] = [];
  for (const path of sortedPaths(files)) {
    const source = files.get(path)!;
    if (SFC_FILE.test(path)) {
      const name = pascal(/([^/]+)\.(?:vue|svelte)$/.exec(path)![1]!);
      components.push({ name, file: path, line: 1, props: sfcProps(path, source), variants: {}, ...usageOf(usages, name, path) });
      continue;
    }
    if (!COMPONENT_FILE.test(path)) continue;
    const variants = cvaVariants(source);
    for (const definition of definitionsIn(source)) {
      const related = variants.find((entry) => entry.name.toLowerCase().startsWith(definition.name.toLowerCase())) ?? (variants.length === 1 ? variants[0] : undefined);
      components.push({
        name: definition.name,
        file: path,
        line: lineAt(source, definition.at),
        props: propsOf(source, definition.name, definition.at),
        variants: related?.variants ?? {},
        ...usageOf(usages, definition.name, path),
      });
    }
  }
  const preferred = (component: DesignComponent) => (/(?:^|\/)(?:components|ui)\//.test(component.file) ? 0 : 1);
  return components.sort((a, b) => b.uses - a.uses || preferred(a) - preferred(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
};

const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}\b|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(|var\(--color)/i;
const COLOR_NAME = /color|colour|background|foreground|\bbg\b|border|ring|primary|secondary|accent|muted|destructive|chart|sidebar|card|popover|surface|success|warning|danger|info/i;

const kindOf = (name: string, value: string, section?: string): DesignTokenKind => {
  if (section === "colors") return "color";
  if (section === "borderRadius") return "radius";
  if (section === "fontFamily") return "font";
  if (section === "spacing") return "spacing";
  if (section === "boxShadow") return "shadow";
  if (/shadow/i.test(name)) return "shadow";
  if (/radius|rounded/i.test(name)) return "radius";
  if (/font|text-|leading|tracking|letter|line-height/i.test(name)) return "font";
  if (/spacing|space|gap|size|width|height/i.test(name) && !COLOR_VALUE.test(value)) return "spacing";
  if (COLOR_VALUE.test(value.trim()) || COLOR_NAME.test(name)) return "color";
  return "other";
};

const cssTokens = (path: string, source: string): DesignToken[] => {
  const tokens: DesignToken[] = [];
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  for (const match of clean.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    const before = clean.slice(Math.max(0, match.index - 1), match.index);
    if (before !== "" && !/[\s;{]/.test(before)) continue;
    const value = match[2]!.trim().replace(/\s+/g, " ");
    tokens.push({ name: match[1]!, value, file: path, line: lineAt(source, match.index), kind: kindOf(match[1]!, value), source: "css" });
  }
  return tokens;
};

const TAILWIND_SECTIONS = ["colors", "borderRadius", "fontFamily", "spacing", "boxShadow"];

const literal = (value: string): string => value.replace(/,\s*$/, "").trim();

const tailwindTokens = (path: string, source: string): DesignToken[] => {
  const tokens: DesignToken[] = [];
  const theme = /\btheme\s*:\s*\{/.exec(source);
  if (theme === null) return tokens;
  const themeOpen = theme.index + theme[0].length - 1;
  const scopes = [themeOpen];
  const extend = objectEntries(source, themeOpen).find((entry) => entry.key === "extend");
  if (extend !== undefined) {
    const brace = firstBrace(source, extend.valueAt);
    if (brace !== -1) scopes.push(brace);
  }
  for (const scope of scopes) {
    for (const section of objectEntries(source, scope)) {
      if (!TAILWIND_SECTIONS.includes(section.key)) continue;
      const brace = firstBrace(source, section.valueAt);
      if (brace === -1) continue;
      for (const entry of objectEntries(source, brace)) {
        const nested = firstBrace(source, entry.valueAt);
        if (nested !== -1 && section.key === "colors") {
          for (const shade of objectEntries(source, nested)) {
            const name = shade.key === "DEFAULT" ? entry.key : `${entry.key}-${shade.key}`;
            tokens.push({ name, value: literal(shade.value), file: path, line: lineAt(source, shade.at), kind: "color", source: "tailwind" });
          }
          continue;
        }
        const value = literal(entry.value);
        tokens.push({ name: entry.key, value, file: path, line: lineAt(source, entry.at), kind: kindOf(entry.key, value, section.key), source: "tailwind" });
      }
    }
  }
  return tokens;
};

const tokensOf = (files: SourceFiles): DesignToken[] => {
  const tokens: DesignToken[] = [];
  const seen = new Set<string>();
  for (const path of sortedPaths(files)) {
    const source = files.get(path)!;
    const found = STYLE_FILE.test(path) ? cssTokens(path, source) : TAILWIND_CONFIG.test(path) ? tailwindTokens(path, source) : [];
    for (const token of found) {
      const key = `${token.source}:${token.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push(token);
    }
  }
  return tokens;
};

export const designSystemOf = (files: SourceFiles): DesignSystemIndex => ({ version: 1, components: componentsOf(files), tokens: tokensOf(files) });

const wordsOf = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^\w$-]+/)
    .filter((word) => word !== "");

const componentScore = (component: DesignComponent, words: ReadonlyArray<string>): number => {
  let score = 0;
  const name = component.name.toLowerCase();
  const variantNames = Object.keys(component.variants).map((key) => key.toLowerCase());
  const variantValues = Object.values(component.variants).flatMap((values) => values.map((value) => value.toLowerCase()));
  for (const word of words) {
    if (name === word) score += 10;
    else if (name.includes(word)) score += 5;
    else if (variantNames.some((value) => value.includes(word)) || variantValues.some((value) => value.includes(word))) score += 3;
    else if (component.props.some((prop) => prop.toLowerCase().includes(word))) score += 2;
    else if (component.file.toLowerCase().includes(word)) score += 1;
  }
  return score;
};

const tokenScore = (token: DesignToken, words: ReadonlyArray<string>): number => {
  let score = 0;
  const name = token.name.toLowerCase().replace(/^--/, "");
  for (const word of words) {
    if (name === word) score += 10;
    else if (name.includes(word)) score += 5;
    else if (token.kind === word) score += 3;
    else if (token.value.toLowerCase().includes(word)) score += 2;
    else if (token.file.toLowerCase().includes(word)) score += 1;
  }
  return score;
};

export const searchDesignSystem = (
  index: DesignSystemIndex,
  query: string,
  options: { readonly kind?: "component" | "token"; readonly limit?: number } = {},
): { readonly components: DesignComponent[]; readonly tokens: DesignToken[] } => {
  const words = wordsOf(query);
  const limit = options.limit ?? 20;
  const components =
    options.kind === "token"
      ? []
      : index.components
          .map((component) => ({ component, score: words.length === 0 ? 1 : componentScore(component, words) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score || b.component.uses - a.component.uses)
          .slice(0, limit)
          .map((entry) => entry.component);
  const tokens =
    options.kind === "component"
      ? []
      : index.tokens
          .map((token) => ({ token, score: words.length === 0 ? 1 : tokenScore(token, words) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((entry) => entry.token);
  return { components, tokens };
};
