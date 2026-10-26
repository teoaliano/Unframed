/**
 * Style documents: a DESIGN.md on the canvas, a markdown description of a visual system
 * the agent follows. Their size limit, file names, what their canvas card shows, which one
 * a message's selection attaches to its chat, and the line the preamble names it with.
 */
import { selectionOrder } from "../composition.ts";
import type { CanvasShape } from "../canvasShapes.ts";
import { applyArtifactEdits } from "../artifacts/artifactEdits.ts";
import { STYLE_LINE_TEMPLATE } from "./prompts.ts";

/** A style document may be at most this many bytes of markdown (100 KiB). */
export const STYLE_SIZE_LIMIT = 102_400;

export const STYLE_TOO_LARGE_MESSAGE = "A style document is at most 100 KiB of markdown.";

/** A style card's size when it is created. */
export const STYLE_DEFAULT_SIZE = { w: 320, h: 240 } as const;

/** How many colour swatches a card shows at most. */
export const STYLE_SWATCH_MAX = 6;

/** How many characters of opening text a card shows at most. */
export const STYLE_EXCERPT_MAX = 220;

/** Whether a file is a style document by its name or type. */
export const isStyleFile = (file: { readonly name: string; readonly type: string }): boolean =>
  /\.(md|markdown)$/i.test(file.name) || file.type === "text/markdown" || file.type === "text/x-markdown";

const HEX = /(?<![\w&#])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;

/** A hex colour in six-digit lowercase form, alpha dropped: `#ABC` and `#aabbccff` are both `#aabbcc`. */
const normalHex = (digits: string): string => {
  const lower = digits.toLowerCase();
  const rgb = lower.length <= 4 ? [...lower.slice(0, 3)].map((digit) => digit + digit).join("") : lower.slice(0, 6);
  return `#${rgb}`;
};

/** A colour in OKLab, where straight-line distance tracks how different two colours look. */
const oklab = (hex: string): readonly [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};

const distance = (a: string, b: string): number => {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

/** Below this OKLab chroma a colour reads as a grey, black or white. */
const NEUTRAL_CHROMA = 0.04;
/** Closer than this in OKLab, two swatches read as the same colour. */
const SAME_COLOUR = 0.1;
/** A card shows at most this many greys, blacks and whites. */
const NEUTRAL_MAX = 2;

const isNeutral = (hex: string): boolean => {
  const [, a, b] = oklab(hex);
  return Math.hypot(a, b) < NEUTRAL_CHROMA;
};

/**
 * The scalar values of a document's YAML front matter by dotted path (`colors.brand.primary`),
 * in the order they appear, quotes taken off. Enough YAML for a DESIGN.md: nested maps, with
 * list items skipped.
 */
const frontMatterValues = (markdown: string): Array<{ readonly path: string; readonly value: string }> => {
  const { frontMatter } = splitFrontMatter(markdown);
  const values: Array<{ path: string; value: string }> = [];
  const stack: Array<{ indent: number; key: string }> = [];
  for (const line of frontMatter.split(/\r?\n/).slice(1)) {
    if (/^\s*(#|-|---\s*$|$)/.test(line)) continue;
    const match = /^(\s*)([^:\s][^:]*?)\s*:(?:\s+(.*))?$/.exec(line);
    if (!match) continue;
    const indent = match[1]!.length;
    while (stack.length > 0 && stack.at(-1)!.indent >= indent) stack.pop();
    const key = match[2]!.replace(/^["']|["']$/g, "");
    const raw = (match[3] ?? "").trim();
    if (raw === "") {
      stack.push({ indent, key });
      continue;
    }
    const value = /^(["'])(.*)\1$/.exec(raw)?.[2] ?? raw;
    values.push({ path: [...stack.map((entry) => entry.key), key].join("."), value });
  }
  return values;
};

/** The colour roles that stand for a style, in the order its card shows them. */
const ROLES = ["primary", "accent", "brand", "canvas", "ink"];
/** Names of colours for a state or a utility, not for the brand: `on-primary`, `primary-hover`, `error`. */
const UTILITY = new Set(["on", "hover", "press", "pressed", "active", "focus", "disabled", "subdued", "success", "error", "warning", "danger", "info", "overlay", "shadow", "hairline", "border", "divider", "selection", "scrim"]);

/**
 * The colour swatches a card shows, up to `max`: first the front matter's role colours
 * (primary, accent, brand, canvas, ink, a plain name before a variant like `ink-mute`), then
 * the colour farthest from those already shown, again and again. A colour too close to one
 * already shown is skipped, and no more than two greys show. A document whose front matter
 * names no colours is read for every hex colour in its text, the first one first.
 */
export const styleSwatches = (markdown: string, max = STYLE_SWATCH_MAX): string[] => {
  const named = frontMatterValues(markdown).flatMap(({ path, value }) => {
    const hex = [...value.matchAll(HEX)][0]?.[1];
    return hex === undefined ? [] : [{ path, segments: path.toLowerCase().split(/[.\-_\s]+/), colour: normalHex(hex) }];
  });
  // A palette under `colors:` is where the colours live; elsewhere a hex is a component's detail.
  const palette = named.filter((entry) => /^(colou?rs?|palette)$/.test(entry.segments[0]!));
  const entries = palette.length > 0 ? palette : named;

  const chosen: string[] = [];
  const take = (colour: string): void => {
    if (chosen.length >= max || chosen.some((shown) => distance(shown, colour) < SAME_COLOUR)) return;
    if (isNeutral(colour) && chosen.filter(isNeutral).length >= NEUTRAL_MAX) return;
    chosen.push(colour);
  };
  const brandEntries = entries.filter((entry) => !entry.segments.some((segment) => UTILITY.has(segment)));
  const roleOf = (entry: (typeof entries)[number]) => ROLES.findIndex((role) => entry.segments.includes(role));
  const exact = (entry: (typeof entries)[number], role: string) => entry.segments.at(-1) === role && entry.segments.slice(1, -1).every((segment) => ROLES.includes(segment));
  // Plain role names first (`ink`), then variants (`ink-secondary`), each role once.
  for (const pass of [true, false]) {
    for (const [index, role] of ROLES.entries()) {
      const entry = brandEntries.find((candidate) => roleOf(candidate) === index && exact(candidate, role) === pass);
      if (entry && !(pass === false && brandEntries.some((candidate) => roleOf(candidate) === index && exact(candidate, role)))) take(entry.colour);
    }
  }

  const pool = entries.length > 0 ? brandEntries.map((entry) => entry.colour) : [...markdown.matchAll(HEX)].map((match) => normalHex(match[1]!));
  const remaining = [...new Set(pool)].filter((colour) => !chosen.includes(colour));
  while (chosen.length < max) {
    const before = chosen.length;
    const ranked = remaining
      .filter((colour) => !chosen.includes(colour))
      .map((colour, order) => ({ colour, order, spread: chosen.length === 0 ? -order : Math.min(...chosen.map((shown) => distance(shown, colour))) }))
      .sort((a, b) => b.spread - a.spread || a.order - b.order);
    for (const { colour } of ranked) {
      take(colour);
      if (chosen.length > before) break;
    }
    if (chosen.length === before) break;
  }
  return chosen;
};

/**
 * A line with its `{colors.canvas}` style token references read as their front matter value.
 * A reference followed by that same value (`{colors.canvas} is #010102`) becomes the value
 * once; one the front matter does not hold is left out.
 */
const resolveReferences = (text: string, values: ReadonlyMap<string, string>): string => {
  if (!text.includes("{")) return text;
  const valueOf = (path: string) => values.get(path);
  return text
    .replace(/\{([A-Za-z][\w-]*(?:\.[\w-]+)+)\}\s*(?:—|–|-|:|=|is)?\s*(#[0-9a-f]{3,8})(?![\w-])/gi, (all, path: string, hex: string) => {
      const value = valueOf(path);
      return value !== undefined && /^#[0-9a-f]{3,8}$/i.test(value) && normalHex(value.slice(1)) === normalHex(hex.slice(1)) ? hex : all;
    })
    .replace(/\{([A-Za-z][\w-]*(?:\.[\w-]+)+)\}/g, (_all, path: string) => valueOf(path) ?? "")
    .replace(/\(\s*\)/g, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s+([),.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
};

/** A markdown line as plain words: heading marks, emphasis, code ticks, links and list bullets taken out. */
const plainLine = (line: string): string =>
  line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The lines of the document after any front matter. */
const bodyLines = (markdown: string): string[] => {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (end > 0) return lines.slice(end + 1);
  }
  return lines;
};

/**
 * A document's YAML front matter (with its `---` lines and the newline after them) and the
 * markdown after it. The markdown window edits only the body and keeps the front matter
 * byte for byte, because a rich-text editor has no place for it.
 */
export const splitFrontMatter = (markdown: string): { readonly frontMatter: string; readonly body: string } => {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  return match ? { frontMatter: match[0], body: markdown.slice(match[0].length) } : { frontMatter: "", body: markdown };
};

/** The document's first level-one heading, as plain words; `undefined` when it has none. */
export const styleHeading = (markdown: string): string | undefined => {
  for (const line of bodyLines(markdown)) {
    if (/^\s{0,3}#\s+\S/.test(line)) return plainLine(line) || undefined;
  }
  return undefined;
};

/**
 * The opening text a card shows: the first lines of prose after the first heading, as plain
 * words with token references resolved, joined with spaces and cut to `STYLE_EXCERPT_MAX` characters. Headings below the
 * first, code fences, tables and rules are skipped.
 */
export const styleExcerpt = (markdown: string): string => {
  const values = new Map(frontMatterValues(markdown).map(({ path, value }) => [path, value]));
  const parts: string[] = [];
  let fenced = false;
  let length = 0;
  for (const line of bodyLines(markdown)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s{0,3}#{1,6}\s/.test(line) || /^\s*\|/.test(line) || /^\s*([-*_]\s*){3,}$/.test(line)) continue;
    const text = resolveReferences(plainLine(line), values);
    if (text === "") continue;
    parts.push(text);
    length += text.length + 1;
    if (length >= STYLE_EXCERPT_MAX) break;
  }
  const joined = parts.join(" ");
  return joined.length > STYLE_EXCERPT_MAX ? `${joined.slice(0, STYLE_EXCERPT_MAX - 1).trimEnd()}…` : joined;
};

/** A style shape's role: `document` only when its props say so, since shapes made before roles are styles. */
export const styleRoleOf = (props: unknown): "style" | "document" =>
  typeof props === "object" && props !== null && (props as { role?: unknown }).role === "document" ? "document" : "style";

/** The role a dropped markdown file takes: a style when it names colours, else a plain document. */
export const droppedStyleRole = (markdown: string): "style" | "document" => (styleSwatches(markdown).length > 0 ? "style" : "document");

/** What a style shape's card shows of its document; written into its props with every new version. */
export const styleCard = (markdown: string): { swatches: string[]; excerpt: string } => ({ swatches: styleSwatches(markdown), excerpt: styleExcerpt(markdown) });

/** The title a dropped or inserted document takes: its first heading, else the file name without its extension. */
export const styleTitleFor = (markdown: string, fileName: string): string => styleHeading(markdown) ?? fileName.replace(/\.[^.]*$/, "");

/** A document a write or an edit may save: non-empty markdown within the size limit, or the refusal. */
export const styleDocument = (markdown: unknown): { markdown: string } | { error: string } => {
  if (typeof markdown !== "string" || markdown.trim() === "") return { error: "markdown must be a non-empty string" };
  if (new TextEncoder().encode(markdown).length > STYLE_SIZE_LIMIT) return { error: `${STYLE_TOO_LARGE_MESSAGE} Nothing was written.` };
  return { markdown };
};

/** `style_edit`: the page edit rules, applied to the style's markdown. */
export const applyStyleEdits = (markdown: string, edits: unknown): { markdown: string } | { error: string } => {
  const edited = applyArtifactEdits(markdown, edits, "style");
  return "error" in edited ? edited : { markdown: edited.html };
};

/**
 * The style a message attaches to its chat: the first style shape in the selection's
 * reading order, a selected group's members included, documents never. `undefined` when
 * none is selected.
 */
export const styleOfSelection = (shapes: ReadonlyArray<CanvasShape>, selected: ReadonlyArray<string>): CanvasShape | undefined =>
  selectionOrder(shapes, selected).find((shape) => shape.kind === "style" && shape.document !== true);

/** The preamble's line naming the chat's style: its id as the agent reads it, its title and its current file. */
export const styleLine = (style: { readonly id: string; readonly title: string; readonly file: string }): string =>
  STYLE_LINE_TEMPLATE.replace("<title>", () => style.title.replace(/"/g, "'"))
    .replace("<id>", () => style.id)
    .replace("<file>", () => style.file);

/** What the work log says when a message attaches a style, and when it replaces the chat's earlier one. */
export const styleAttachedSummary = (title: string, previous?: string): string =>
  previous === undefined ? `Following the style “${title}”` : `Following the style “${title}” in place of “${previous}”`;
