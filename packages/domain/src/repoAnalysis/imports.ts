import type { SourceFiles } from "./types.ts";
import { dirOf, joinPath } from "./text.ts";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte"];

interface AliasConfig {
  readonly dir: string;
  readonly baseUrl: string | undefined;
  readonly paths: ReadonlyArray<{ readonly prefix: string; readonly wildcard: boolean; readonly targets: ReadonlyArray<string> }>;
}

const looseJson = (text: string): unknown => {
  const stripped = text
    .replace(/("(?:[^"\\\n]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match, quoted: string | undefined) => quoted ?? "")
    .replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
};

export const parsedJson = looseJson;

const CONFIG_NAME = /(?:^|\/)(?:tsconfig(?:\.[\w-]+)?|jsconfig)\.json$/;

export const aliasConfigs = (files: SourceFiles): AliasConfig[] => {
  const configs: AliasConfig[] = [];
  for (const [path, text] of files) {
    if (!CONFIG_NAME.test(path)) continue;
    const json = looseJson(text) as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | undefined;
    const options = json?.compilerOptions;
    if (options === undefined) continue;
    const dir = dirOf(path);
    const baseUrl = typeof options.baseUrl === "string" ? joinPath(dir, options.baseUrl) : undefined;
    const paths: Array<AliasConfig["paths"][number]> = [];
    if (typeof options.paths === "object" && options.paths !== null) {
      for (const [pattern, targets] of Object.entries(options.paths as Record<string, unknown>)) {
        if (!Array.isArray(targets)) continue;
        const wildcard = pattern.endsWith("*");
        const base = baseUrl ?? dir;
        paths.push({
          prefix: wildcard ? pattern.slice(0, -1) : pattern,
          wildcard,
          targets: targets.filter((target): target is string => typeof target === "string").map((target) => joinPath(base, target)),
        });
      }
    }
    if (baseUrl !== undefined || paths.length > 0) configs.push({ dir, baseUrl, paths });
  }
  return configs.sort((a, b) => b.dir.length - a.dir.length);
};

const withExtensions = (files: SourceFiles, base: string): string | undefined => {
  if (files.has(base) && /\.[a-z]+$/.test(base)) return base;
  const swapped = base.replace(/\.(?:js|jsx|mjs)$/, "");
  if (swapped !== base) for (const extension of [".ts", ".tsx"]) if (files.has(swapped + extension)) return swapped + extension;
  for (const extension of EXTENSIONS) if (files.has(base + extension)) return base + extension;
  for (const extension of EXTENSIONS) if (files.has(`${base}/index${extension}`)) return `${base}/index${extension}`;
  return undefined;
};

export const resolveImport = (files: SourceFiles, configs: ReadonlyArray<AliasConfig>, from: string, specifier: string): string | undefined => {
  if (specifier.startsWith(".")) return withExtensions(files, joinPath(dirOf(from), specifier));
  if (specifier.startsWith("/")) return withExtensions(files, joinPath("", specifier));
  const owning = configs.filter((config) => config.dir === "" || from.startsWith(`${config.dir}/`));
  for (const config of owning) {
    for (const alias of config.paths) {
      const matches = alias.wildcard ? specifier.startsWith(alias.prefix) : specifier === alias.prefix;
      if (!matches) continue;
      const rest = alias.wildcard ? specifier.slice(alias.prefix.length) : "";
      for (const target of alias.targets) {
        const found = withExtensions(files, target.endsWith("*") ? joinPath("", target.slice(0, -1) + rest) : target);
        if (found !== undefined) return found;
      }
    }
  }
  if (owning.every((config) => config.paths.length === 0)) {
    const fallback = /^[@~]\//.exec(specifier);
    if (fallback !== null) {
      const rest = specifier.slice(2);
      for (const config of owning.length === 0 ? [{ dir: "" }] : owning) {
        const found = withExtensions(files, joinPath(config.dir, `src/${rest}`));
        if (found !== undefined) return found;
      }
      const anywhere = [...files.keys()].find((path) => path.endsWith(`/src/${rest}`) || EXTENSIONS.some((extension) => path.endsWith(`/src/${rest}${extension}`)));
      if (anywhere !== undefined) return withExtensions(files, anywhere.replace(/\.[a-z]+$/, "")) ?? anywhere;
    }
  }
  for (const config of owning) {
    if (config.baseUrl === undefined) continue;
    const found = withExtensions(files, joinPath(config.baseUrl, specifier));
    if (found !== undefined) return found;
  }
  return undefined;
};

const SPECIFIERS = [/(?:import|export)\s+(?:type\s+)?[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g, /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /^\s*import\s+['"]([^'"]+)['"]/gm];

export const importSpecifiers = (source: string): string[] => {
  const found: Array<{ readonly at: number; readonly specifier: string }> = [];
  for (const pattern of SPECIFIERS) for (const match of source.matchAll(pattern)) found.push({ at: match.index, specifier: match[1]! });
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.specifier);
};

export const importClosure = (files: SourceFiles, entry: string, maxFiles = 400): string[] => {
  if (!files.has(entry)) return [];
  const configs = aliasConfigs(files);
  const seen = new Set<string>([entry]);
  const order = [entry];
  for (let at = 0; at < order.length && order.length < maxFiles; at++) {
    const file = order[at]!;
    for (const specifier of importSpecifiers(files.get(file) ?? "")) {
      const resolved = resolveImport(files, configs, file, specifier);
      if (resolved === undefined || seen.has(resolved) || /\.(?:css|scss|pcss)$/.test(resolved)) continue;
      seen.add(resolved);
      order.push(resolved);
      if (order.length >= maxFiles) break;
    }
  }
  return order;
};
