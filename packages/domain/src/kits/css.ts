
export interface CssDeclaration {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
  readonly start: number;
  readonly end: number;
}

export interface CssRule {
  readonly selector: string;
  readonly atRules: string[];
  readonly declarations: CssDeclaration[];
  readonly body: { readonly open: number; readonly close: number };
}

const RULE_AT_RULES = /^@(media|supports|layer|container|document)\b/i;

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
          rules.push({ selector: prelude, atRules, declarations: declarationsIn(text, i + 1, bodyEnd), body: { open: i + 1, close: bodyEnd } });
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

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, " ");
