import type { CodeDialog, CodeFlag, CodeMap, SourceFiles } from "./types.ts";
import { discoverRoutes } from "./routes.ts";
import { lineAt, sortedPaths } from "./text.ts";

const CODE = /\.(?:tsx|jsx|ts|js|mjs|vue|svelte)$/;
const DIALOG_NAME = /^[A-Z]\w*(?:Dialog|Modal|Sheet|Drawer)$/;

export const findDialogs = (files: SourceFiles): CodeDialog[] => {
  const dialogs: CodeDialog[] = [];
  const seen = new Set<string>();
  for (const path of sortedPaths(files)) {
    if (!CODE.test(path) || /(?:^|\/)ui\//.test(path)) continue;
    const source = files.get(path)!;
    const named = /([^/]+)\.(?:vue|svelte)$/.exec(path)?.[1];
    if (named !== undefined && DIALOG_NAME.test(named) && !seen.has(named)) {
      seen.add(named);
      dialogs.push({ name: named, file: path, line: 1 });
    }
    for (const match of source.matchAll(/(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Z]\w*(?:Dialog|Modal|Sheet|Drawer))\b/g)) {
      const name = match[1]!;
      if (seen.has(name)) continue;
      seen.add(name);
      dialogs.push({ name, file: path, line: lineAt(source, match.index + match[0].indexOf(name)) });
    }
  }
  return dialogs;
};

const FLAGGY = /FEATURE|FLAG|ENABLE/i;
const FLAG_PATTERNS: ReadonlyArray<readonly [RegExp, (name: string) => boolean]> = [
  [/import\.meta\.env\.(\w+)/g, (name) => FLAGGY.test(name)],
  [/process\.env\.(\w+)/g, (name) => FLAGGY.test(name)],
  [/\b(?:useFlag|useFeature|useFeatureFlag|useFeatureFlagEnabled|isEnabled|featureOn|isFeatureEnabled)\(\s*['"`]([^'"`]+)['"`]/g, () => true],
  [/\bflags\.(\w+)/g, () => true],
];

export const findFlags = (files: SourceFiles): CodeFlag[] => {
  const flags: CodeFlag[] = [];
  const seen = new Set<string>();
  for (const path of sortedPaths(files)) {
    if (!CODE.test(path)) continue;
    const source = files.get(path)!;
    const sites: Array<{ readonly name: string; readonly at: number }> = [];
    for (const [pattern, keep] of FLAG_PATTERNS) for (const match of source.matchAll(pattern)) if (keep(match[1]!)) sites.push({ name: match[1]!, at: match.index });
    for (const site of sites.sort((a, b) => a.at - b.at)) {
      if (seen.has(site.name)) continue;
      seen.add(site.name);
      flags.push({ name: site.name, file: path, line: lineAt(source, site.at) });
    }
  }
  return flags;
};

export const codeMapOf = (files: SourceFiles): CodeMap => {
  const { stack, routes } = discoverRoutes(files);
  return { version: 1, stack, routes, dialogs: findDialogs(files), flags: findFlags(files), features: [], notes: "" };
};

export const mergeCodeMap = (previous: CodeMap | undefined, next: CodeMap): CodeMap => {
  if (previous === undefined) return next;
  const before = new Map(previous.routes.map((route) => [route.path, route] as const));
  return {
    ...next,
    features: previous.features,
    notes: previous.notes,
    routes: next.routes.map((route) => {
      const kept = before.get(route.path);
      if (kept === undefined) return route;
      return {
        ...route,
        ...(kept.example === undefined ? {} : { example: kept.example }),
        ...(kept.name !== route.name ? { name: kept.name } : {}),
        ...(kept.group !== route.group ? { group: kept.group } : {}),
      };
    }),
  };
};
