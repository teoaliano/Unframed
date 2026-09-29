/**
 * What the catalogue knows about the code, read from the source text at load: each module's
 * exports, its cva variants and data-slot parts, and every line elsewhere that uses an export.
 * Nothing here is written by hand, so the catalogue cannot drift from the code.
 */

/** Every source file of the web client, keyed by its path from the package root ("/src/..."). */
const SOURCES = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

export const sourceOf = (module: string): string => SOURCES[module] ?? "";

export const modulesUnder = (folder: string): string[] =>
  Object.keys(SOURCES)
    .filter((path) => path.startsWith(folder) && !path.slice(folder.length).includes("/") && path.endsWith(".tsx"))
    .sort();

const identifier = /^[A-Za-z_$][\w$]*$/;

/** Value exports: `export { A, B as C }`, `export function X`, `export const X`. Type-only exports are left out. */
export const exportsOf = (module: string): string[] => {
  const text = sourceOf(module);
  const names = new Set<string>();
  for (const block of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of block[1]!.split(",")) {
      const item = part.trim();
      if (item === "" || item.startsWith("type ")) continue;
      const name = item.split(/\s+as\s+/).pop()!.trim();
      if (identifier.test(name)) names.add(name);
    }
  }
  for (const match of text.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]!);
  return [...names];
};

/** The object literal starting at the first `{` at or after `from`, braces balanced. */
const objectAt = (text: string, from: number): string | undefined => {
  const open = text.indexOf("{", from);
  if (open < 0) return undefined;
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return text.slice(open + 1, index);
  }
  return undefined;
};

/** The keys at the top level of an object literal's body, skipping strings and nested braces. */
const topKeys = (body: string): string[] => {
  const keys: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;
    if (quote) {
      if (char === quote && body[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      if (depth === 0 && body.slice(start, index).trim() === "") {
        const end = body.indexOf(char, index + 1);
        if (body.slice(end + 1).trimStart().startsWith(":")) {
          keys.push(body.slice(index + 1, end));
          index = end;
          continue;
        }
      }
      quote = char;
    } else if (char === "{" || char === "[" || char === "(") depth++;
    else if (char === "}" || char === "]" || char === ")") depth--;
    else if (depth === 0 && char === ":") {
      const key = body.slice(start, index).trim();
      if (identifier.test(key)) keys.push(key);
    } else if (depth === 0 && char === ",") start = index + 1;
  }
  return keys;
};

export interface VariantAxis {
  readonly name: string;
  readonly options: readonly string[];
  readonly fallback: string | undefined;
}

export interface VariantSet {
  /** The cva call's name, such as `buttonVariants`. */
  readonly recipe: string;
  readonly axes: readonly VariantAxis[];
}

/** Each `const x = cva(...)` in the module, with its axes, their options and defaults. */
export const variantsOf = (module: string): VariantSet[] => {
  const text = sourceOf(module);
  const sets: VariantSet[] = [];
  const calls = [...text.matchAll(/const\s+(\w+)\s*=\s*cva\(/g)];
  calls.forEach((call, position) => {
    const end = calls[position + 1]?.index ?? text.length;
    // Whole-line and block comments go first: their words would read as keys.
    const region = text.slice(call.index, end).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const variantsAt = region.search(/\bvariants\s*:/);
    if (variantsAt < 0) return;
    const body = objectAt(region, variantsAt);
    if (body === undefined) return;
    const defaultsAt = region.search(/\bdefaultVariants\s*:/);
    const defaults = defaultsAt < 0 ? "" : (objectAt(region, defaultsAt) ?? "");
    const axes = topKeys(body).map((name) => {
      const axisAt = body.search(new RegExp(`(^|[\\s,{])${name}\\s*:`));
      const options = topKeys(objectAt(body, axisAt) ?? "");
      const fallback = new RegExp(`\\b${name}\\s*:\\s*["']([^"']+)["']`).exec(defaults)?.[1];
      return { name, options, fallback };
    });
    sets.push({ recipe: call[1]!, axes });
  });
  return sets;
};

/** The `data-slot` names the module renders: its parts, as the tests and the lint see them. */
export const slotsOf = (module: string): string[] => {
  const slots = new Set<string>();
  for (const match of sourceOf(module).matchAll(/data-slot["']?\s*[:=]\s*\{?\s*["']([\w-]+)["']/g)) slots.add(match[1]!);
  return [...slots].sort();
};

export interface Usage {
  readonly file: string;
  readonly line: number;
  readonly names: readonly string[];
  readonly text: string;
}

const withoutExtension = (path: string) => path.replace(/\.(tsx?|mjs|js)$/, "");

const resolve = (from: string, specifier: string): string | undefined => {
  if (specifier.startsWith("~/")) return `/src/${specifier.slice(2)}`;
  if (!specifier.startsWith(".")) return undefined;
  const parts = from.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
};

/** Every line, outside the module itself, that uses one of its exports, one entry per line. */
export const usagesOf = (module: string): Usage[] => {
  const target = withoutExtension(module);
  const usages: Usage[] = [];
  for (const [file, text] of Object.entries(SOURCES)) {
    if (file === module) continue;
    const imported = new Map<string, string>();
    for (const match of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      if (match[1]) continue;
      const resolved = resolve(file, match[3]!);
      if (resolved === undefined || withoutExtension(resolved) !== target) continue;
      for (const part of match[2]!.split(",")) {
        const item = part.trim();
        if (item === "" || item.startsWith("type ")) continue;
        const [original, local = original] = item.split(/\s+as\s+/).map((each) => each.trim());
        imported.set(local!, original!);
      }
    }
    if (imported.size === 0) continue;
    const pattern = new RegExp(`\\b(${[...imported.keys()].join("|")})\\b`, "g");
    const lines = text.split("\n");
    let inImport = false;
    lines.forEach((line, index) => {
      if (/^\s*import\b/.test(line)) inImport = !/from\s*["']/.test(line);
      else if (inImport) {
        if (/from\s*["']/.test(line)) inImport = false;
        return;
      } else {
        const names = [...new Set([...line.matchAll(pattern)].map((match) => imported.get(match[1]!)!))];
        if (names.length > 0) usages.push({ file, line: index + 1, names, text: line.trim() });
      }
    });
  }
  return usages.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
};

/** Opens a file at a line in the editor, through the dev server's own endpoint. */
export const openInEditor = (file: string, line?: number): void => {
  void fetch(`/__open-in-editor?file=${encodeURIComponent(`${file.slice(1)}${line === undefined ? "" : `:${line}`}`)}`);
};
