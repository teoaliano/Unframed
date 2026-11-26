const OPEN = "{[(";
const CLOSE = "}])";

export const lineAt = (source: string, index: number): number => {
  let line = 1;
  for (let at = source.indexOf("\n"); at !== -1 && at < index; at = source.indexOf("\n", at + 1)) line++;
  return line;
};

const skipString = (source: string, at: number): number => {
  const quote = source[at];
  for (let next = at + 1; next < source.length; next++) {
    const char = source[next];
    if (char === "\\") {
      next++;
      continue;
    }
    if (char === quote) return next;
    if (char === "\n" && quote !== "`") return next;
  }
  return source.length;
};

const skipComment = (source: string, at: number): number => {
  if (source[at + 1] === "/") {
    const end = source.indexOf("\n", at);
    return end === -1 ? source.length : end;
  }
  if (source[at + 1] === "*") {
    const end = source.indexOf("*/", at + 2);
    return end === -1 ? source.length : end + 1;
  }
  return at;
};

const isQuote = (char: string | undefined): boolean => char === '"' || char === "'" || char === "`";

const commentStart = (source: string, at: number): boolean => source[at] === "/" && (source[at + 1] === "/" || source[at + 1] === "*") && source[at - 1] !== ":";

export const matchingClose = (source: string, open: number): number => {
  let depth = 0;
  for (let at = open; at < source.length; at++) {
    const char = source[at]!;
    if (isQuote(char)) {
      at = skipString(source, at);
      continue;
    }
    if (commentStart(source, at)) {
      at = skipComment(source, at);
      continue;
    }
    if (OPEN.includes(char)) depth++;
    else if (CLOSE.includes(char)) {
      depth--;
      if (depth === 0) return at;
    }
  }
  return -1;
};

export interface Segment {
  readonly text: string;
  readonly at: number;
}

export const splitTopLevel = (source: string, start: number, end: number, separators: string): Segment[] => {
  const segments: Segment[] = [];
  let depth = 0;
  let from = start;
  for (let at = start; at < end; at++) {
    const char = source[at]!;
    if (isQuote(char)) {
      at = Math.min(skipString(source, at), end);
      continue;
    }
    if (commentStart(source, at)) {
      at = Math.min(skipComment(source, at), end);
      continue;
    }
    if (OPEN.includes(char)) depth++;
    else if (CLOSE.includes(char)) depth--;
    else if (depth === 0 && separators.includes(char)) {
      segments.push({ text: source.slice(from, at), at: from });
      from = at + 1;
    }
  }
  segments.push({ text: source.slice(from, end), at: from });
  return segments;
};

const KEY = /^\s*(?:readonly\s+)?(?:(["'])([^"'\n]+)\1|([A-Za-z_$][\w$]*))\??\s*(:|\()/;

export interface Entry {
  readonly key: string;
  readonly at: number;
  readonly value: string;
  readonly valueAt: number;
}

export const entriesOf = (source: string, open: number, separators = ",;\n"): Entry[] => {
  const close = matchingClose(source, open);
  if (close === -1) return [];
  const entries: Entry[] = [];
  for (const segment of splitTopLevel(source, open + 1, close, separators)) {
    const found = KEY.exec(segment.text);
    if (found === null) continue;
    const key = found[2] ?? found[3]!;
    const offset = found[0].length;
    const valueAt = segment.at + (found[4] === ":" ? offset : offset - 1);
    const leading = segment.text.length - segment.text.trimStart().length;
    entries.push({ key, at: segment.at + leading, value: segment.text.slice(valueAt - segment.at).trim(), valueAt });
  }
  return entries;
};

export const objectEntries = (source: string, open: number): Entry[] => entriesOf(source, open, ",");

export const firstBrace = (source: string, from: number): number => {
  for (let at = from; at < source.length; at++) {
    const char = source[at]!;
    if (char === "{") return at;
    if (!/\s/.test(char)) return -1;
  }
  return -1;
};

export const sourceExtension = (path: string): string => {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(dot) : "";
};

export const normalisePath = (path: string): string => {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
};

export const dirOf = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
};

export const joinPath = (dir: string, relative: string): string => normalisePath(dir === "" ? relative : `${dir}/${relative}`);

export const sortedPaths = (files: ReadonlyMap<string, string>): string[] => [...files.keys()].sort();
