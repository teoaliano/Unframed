/**
 * A small stylesheet scanner for the kit's rules: the rules of one `<style>` text with their
 * selectors, their at-rule context and their declarations, each value with its offsets so a
 * change keeps every other byte. It reads what the kit needs (comments, strings, brackets and
 * the block at-rules that hold rules), and nothing more.
 */

export interface CssDeclaration {
  /** As written, custom properties case kept, other properties lower-cased. */
  readonly property: string;
  /** The value without `!important`, trimmed. */
  readonly value: string;
  readonly important: boolean;
  /** Offsets of the value in the text: `text.slice(start, end)` is `value`. */
  readonly start: number;
  readonly end: number;
}

export interface CssRule {
  /** The selector text as written, trimmed. */
  readonly selector: string;
  /** The block at-rules the rule sits in, outermost first, as written (`@media (…)`). */
  readonly atRules: string[];
  readonly declarations: CssDeclaration[];
}

/** The at-rules whose bodies hold style rules. Others (`@keyframes`, `@font-face`) are skipped. */
const RULE_AT_RULES = /^@(media|supports|layer|container|document)\b/i;

/** The index of the bracket that closes the one at `open`, skipping strings and comments; -1 when none. */
const closing = (text: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i = skipComment(text, i);
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const skipString = (text: string, from: number): number => {
  const quote = text[from]!;
  for (let i = from + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i;
  }
  return text.length - 1;
};

const skipComment = (text: string, from: number): number => {
  const end = text.indexOf("*/", from + 2);
  return end === -1 ? text.length - 1 : end + 1;
};

/** Reads the declarations between `start` and `end` (exclusive) of the text. */
const declarationsIn = (text: string, start: number, end: number): CssDeclaration[] => {
  const out: CssDeclaration[] = [];
  let depth = 0;
  let pieceStart = start;
  const flush = (pieceEnd: number) => {
    const raw = text.slice(pieceStart, pieceEnd);
    const colon = raw.indexOf(":");
    if (colon > 0) {
      const property = raw.slice(0, colon).trim();
      const name = property.startsWith("--") ? property : property.toLowerCase();
      const valueStart = pieceStart + colon + 1;
      const rawValue = text.slice(valueStart, pieceEnd);
      const importantAt = rawValue.search(/!\s*important\s*$/i);
      const body = importantAt === -1 ? rawValue : rawValue.slice(0, importantAt);
      const leading = body.length - body.trimStart().length;
      const value = body.trim();
      if (name !== "" && value !== "") {
        const from = valueStart + leading;
        out.push({ property: name, value, important: importantAt !== -1, start: from, end: from + value.length });
      }
    }
    pieceStart = pieceEnd + 1;
  };
  for (let i = start; i < end; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i = skipComment(text, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ";" && depth === 0) flush(i);
  }
  flush(end);
  return out;
};

/** The rules of a stylesheet text, in document order. Rules inside block at-rules are included, each with its at-rules. */
export const parseStylesheet = (text: string): CssRule[] => {
  const rules: CssRule[] = [];
  const walk = (from: number, to: number, atRules: string[]) => {
    let i = from;
    let preludeStart = from;
    while (i < to) {
      const ch = text[i]!;
      if (ch === '"' || ch === "'") {
        i = skipString(text, i);
        i++;
        continue;
      }
      if (ch === "/" && text[i + 1] === "*") {
        i = skipComment(text, i) + 1;
        continue;
      }
      if (ch === ";") {
        i++;
        preludeStart = i;
        continue;
      }
      if (ch === "{") {
        const prelude = stripComments(text.slice(preludeStart, i)).trim();
        const close = closing(text, i);
        const bodyEnd = close === -1 ? to : Math.min(close, to);
        if (prelude.startsWith("@")) {
          if (RULE_AT_RULES.test(prelude)) walk(i + 1, bodyEnd, [...atRules, prelude]);
        } else if (prelude !== "") {
          rules.push({ selector: prelude, atRules, declarations: declarationsIn(text, i + 1, bodyEnd) });
        }
        i = bodyEnd + 1;
        preludeStart = i;
        continue;
      }
      if (ch === "}") {
        i++;
        preludeStart = i;
        continue;
      }
      i++;
    }
  };
  walk(0, text.length, []);
  return rules;
};

/** The text with its comments taken out, so a prelude reads as its selector. */
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, " ");
