import { pathRefusal, valueRefusal } from "./rules.ts";
import { cssName } from "./runtime.ts";
import { TEXT_STYLE_FIELDS, type Kit, type TextStyle, type Token, type TokenType } from "./types.ts";
import type { ImportResult } from "./formats.ts";

type Yaml = string | { readonly [key: string]: Yaml };

export const splitFrontMatter = (markdown: string): { readonly frontMatter: string | undefined; readonly body: string } => {
  const text = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  return match ? { frontMatter: match[1]!, body: text.slice(match[0].length) } : { frontMatter: undefined, body: text };
};

const scalar = (raw: string): string => {
  const trimmed = raw.trim();
  const quoted = /^"(.*)"$/.exec(trimmed) ?? /^'(.*)'$/.exec(trimmed);
  if (quoted) return trimmed.startsWith("'") ? quoted[1]!.replace(/''/g, "'") : quoted[1]!.replace(/\\"/g, '"');
  return trimmed.replace(/\s+#.*$/, "");
};

const parseYaml = (text: string): Record<string, Yaml> => {
  const root: Record<string, Yaml> = {};
  const stack: Array<{ indent: number; node: Record<string, Yaml> }> = [{ indent: -1, node: root }];
  for (const line of text.split("\n")) {
    if (/^\s*(#|$)/.test(line) || /^\s*-(\s|$)/.test(line)) continue;
    const match = /^(\s*)("[^"]*"|'[^']*'|[^:\s][^:]*?)\s*:(?:\s+(.*))?$/.exec(line);
    if (!match) continue;
    const indent = match[1]!.length;
    while (stack.length > 1 && stack.at(-1)!.indent >= indent) stack.pop();
    const parent = stack.at(-1)!.node;
    const key = scalar(match[2]!);
    const raw = (match[3] ?? "").trim();
    if (raw === "" || raw === "|" || raw === ">") {
      const child: Record<string, Yaml> = {};
      parent[key] = child;
      stack.push({ indent, node: child });
      continue;
    }
    parent[key] = scalar(raw);
  }
  return root;
};

const isMap = (value: Yaml | undefined): value is { readonly [key: string]: Yaml } => typeof value === "object" && value !== null;

const segmentOf = (name: string): string =>
  name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_.]+/g, "-")
    .toLowerCase();

const SECTIONS: Readonly<Record<string, { readonly group: string; readonly type: TokenType }>> = {
  colors: { group: "color", type: "color" },
  typography: { group: "text", type: "textStyle" },
  rounded: { group: "radius", type: "dimension" },
  spacing: { group: "space", type: "dimension" },
};

const ABOUT = new Set(["version", "name", "description"]);

const textStyleOf = (entry: Yaml): TextStyle | undefined => {
  if (!isMap(entry)) return undefined;
  const field = (name: string) => (typeof entry[name] === "string" ? (entry[name] as string) : undefined);
  const [fontFamily, fontSize, fontWeight, lineHeight] = [field("fontFamily"), field("fontSize"), field("fontWeight"), field("lineHeight")];
  if (fontFamily === undefined || fontSize === undefined || fontWeight === undefined || lineHeight === undefined) return undefined;
  return {
    fontFamily,
    fontSize,
    fontWeight: /^\d+$/.test(fontWeight) ? Number(fontWeight) : fontWeight,
    lineHeight: /^\d*\.?\d+$/.test(lineHeight) ? Number(lineHeight) : lineHeight,
    letterSpacing: field("letterSpacing") ?? "0",
  };
};

const kitNameOf = (name: string | undefined, body: string): string | undefined => {
  const cleaned = name
    ?.replace(/[-_\s]*design[-_\s]*analysis$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (cleaned) return cleaned.slice(0, 80);
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.replace(/[*_`]/g, "").trim();
  return heading ? heading.slice(0, 80) : undefined;
};

const rewriteReferences = (text: string, tokens: ReadonlyMap<string, Token>): string =>
  text.replace(/\{([A-Za-z][\w-]*)\.([\w.-]+)\}/g, (all, section: string, name: string) => {
    const token = tokens.get(`${section}.${name}`);
    if (token === undefined) return all;
    return token.type === "textStyle" ? token.path : `var(${cssName(token.path)})`;
  });

const EMPTY_KIT: Kit = { format: 1, name: "x", modes: ["default"], tokens: [] };

export const fromDesignMd = (markdown: string): ImportResult => {
  const { frontMatter, body } = splitFrontMatter(markdown);
  if (frontMatter === undefined) return { ok: false, refusal: "A DESIGN.md starts with front matter between two --- lines." };
  const yaml = parseYaml(frontMatter);
  const tokens: Token[] = [];
  const byReference = new Map<string, Token>();
  const skippedNames: string[] = [];

  for (const [section, entries] of Object.entries(yaml)) {
    if (ABOUT.has(section)) continue;
    const known = SECTIONS[section];
    if (known === undefined || !isMap(entries)) {
      if (isMap(entries)) for (const name of Object.keys(entries)) skippedNames.push(`${section}.${name}`);
      else skippedNames.push(section);
      continue;
    }
    for (const [name, entry] of Object.entries(entries)) {
      const path = `${known.group}/${segmentOf(name)}`;
      const value = known.type === "textStyle" ? textStyleOf(entry) : typeof entry === "string" ? entry : undefined;
      const readable =
        value !== undefined &&
        pathRefusal(path) === null &&
        !tokens.some((token) => token.path === path) &&
        valueRefusal({ path, type: known.type }, value, EMPTY_KIT) === null;
      if (!readable) {
        skippedNames.push(`${section}.${name}`);
        continue;
      }
      const token: Token = { path, type: known.type, value };
      tokens.push(token);
      byReference.set(`${section}.${name}`, token);
      if (known.type === "textStyle" && isMap(entry)) {
        for (const extra of Object.keys(entry)) {
          const named = `${section}.*.${extra}`;
          if (!(TEXT_STYLE_FIELDS as readonly string[]).includes(extra) && !skippedNames.includes(named)) skippedNames.push(named);
        }
      }
    }
  }

  const description = typeof yaml["description"] === "string" ? yaml["description"].trim() : "";
  const prose = [description, body.trim()].filter((part) => part !== "").join("\n\n");
  const guidance = rewriteReferences(prose, byReference);
  if (tokens.length === 0 && guidance === "") return { ok: false, refusal: "This DESIGN.md holds no values and no guidance." };
  const name = kitNameOf(typeof yaml["name"] === "string" ? yaml["name"] : undefined, body);
  return {
    ok: true,
    fragment: {
      ...(name === undefined ? {} : { name }),
      modes: ["default"],
      modeless: true,
      tokens,
      skipped: skippedNames.length,
      skippedNames,
      ...(guidance === "" ? {} : { guidance }),
    },
  };
};

export const skippedList = (names: ReadonlyArray<string>): string => {
  const sections = new Map<string, string[]>();
  for (const name of names) {
    const section = name.split(".")[0]!;
    sections.set(section, [...(sections.get(section) ?? []), name]);
  }
  return [...sections.entries()].flatMap(([section, entries]) => (entries.length > 3 ? [`${section} (${entries.length})`] : entries)).join(", ");
};

export const isDesignMd = (file: { readonly name: string; readonly text: string }): boolean =>
  /\.(md|markdown)$/i.test(file.name) || /^﻿?---\r?\n/.test(file.text);
