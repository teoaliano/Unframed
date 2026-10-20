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

/** The first `max` distinct hex colours the document names, in the order they first appear. */
export const styleSwatches = (markdown: string, max = STYLE_SWATCH_MAX): string[] => {
  const seen: string[] = [];
  for (const match of markdown.matchAll(HEX)) {
    const colour = normalHex(match[1]!);
    if (!seen.includes(colour)) seen.push(colour);
    if (seen.length >= max) break;
  }
  return seen;
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
 * words, joined with spaces and cut to `STYLE_EXCERPT_MAX` characters. Headings below the
 * first, code fences, tables and rules are skipped.
 */
export const styleExcerpt = (markdown: string): string => {
  const parts: string[] = [];
  let fenced = false;
  let length = 0;
  for (const line of bodyLines(markdown)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s{0,3}#{1,6}\s/.test(line) || /^\s*\|/.test(line) || /^\s*([-*_]\s*){3,}$/.test(line)) continue;
    const text = plainLine(line);
    if (text === "") continue;
    parts.push(text);
    length += text.length + 1;
    if (length >= STYLE_EXCERPT_MAX) break;
  }
  const joined = parts.join(" ");
  return joined.length > STYLE_EXCERPT_MAX ? `${joined.slice(0, STYLE_EXCERPT_MAX - 1).trimEnd()}…` : joined;
};

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
 * reading order, a selected group's members included. `undefined` when none is selected.
 */
export const styleOfSelection = (shapes: ReadonlyArray<CanvasShape>, selected: ReadonlyArray<string>): CanvasShape | undefined =>
  selectionOrder(shapes, selected).find((shape) => shape.kind === "style");

/** The preamble's line naming the chat's style: its id as the agent reads it, its title and its current file. */
export const styleLine = (style: { readonly id: string; readonly title: string; readonly file: string }): string =>
  STYLE_LINE_TEMPLATE.replace("<title>", () => style.title.replace(/"/g, "'"))
    .replace("<id>", () => style.id)
    .replace("<file>", () => style.file);

/** What the work log says when a message attaches a style, and when it replaces the chat's earlier one. */
export const styleAttachedSummary = (title: string, previous?: string): string =>
  previous === undefined ? `Following the style “${title}”` : `Following the style “${title}” in place of “${previous}”`;
