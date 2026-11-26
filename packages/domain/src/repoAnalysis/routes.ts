import type { CodeRoute, CodeStack, SourceFiles } from "./types.ts";
import { aliasConfigs, parsedJson, resolveImport } from "./imports.ts";
import { dirOf, lineAt, matchingClose, objectEntries, sortedPaths, titleCase } from "./text.ts";

type Dependencies = ReadonlySet<string>;

export const dependenciesOf = (files: SourceFiles): Dependencies => {
  const names = new Set<string>();
  for (const [path, text] of files) {
    if (path !== "package.json" && !path.endsWith("/package.json")) continue;
    const json = parsedJson(text) as Record<string, unknown> | undefined;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = json?.[field];
      if (typeof deps === "object" && deps !== null) for (const name of Object.keys(deps)) names.add(name);
    }
  }
  return names;
};

const hasPrefix = (deps: Dependencies, prefix: string): boolean => [...deps].some((name) => name.startsWith(prefix));

export const routePath = (segments: ReadonlyArray<string>): string => {
  const path = `/${segments.filter((segment) => segment !== "").join("/")}`;
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
};

type RouteDraft = Pick<CodeRoute, "path" | "file" | "line" | "source"> & { readonly layouts?: ReadonlyArray<string>; readonly entry?: string };

export const routeOf = (draft: RouteDraft): CodeRoute => {
  const segments = draft.path.split("/").filter((segment) => segment !== "");
  const params = segments.filter((segment) => segment.startsWith(":")).map((segment) => segment.slice(1).replace(/[*?]$/, ""));
  const fixed = segments.filter((segment) => !segment.startsWith(":"));
  return {
    path: draft.path,
    file: draft.file,
    line: draft.line,
    params,
    group: fixed[0] ?? "home",
    name: fixed.length === 0 ? "Home" : titleCase(fixed.at(-1)!),
    source: draft.source,
    layouts: draft.layouts ?? [],
    ...(draft.entry === undefined ? {} : { entry: draft.entry }),
  };
};

const bracketSegment = (segment: string): string | undefined => {
  const optionalRest = /^\[\[\.\.\.(\w+)\]\]$/.exec(segment);
  if (optionalRest !== null) return `:${optionalRest[1]}*`;
  const rest = /^\[\.\.\.(\w+)\]$/.exec(segment);
  if (rest !== null) return `:${rest[1]}*`;
  const optional = /^\[\[(\w+)\]\]$/.exec(segment);
  if (optional !== null) return `:${optional[1]}`;
  const param = /^\[(\w+)\]$/.exec(segment);
  if (param !== null) return `:${param[1]}`;
  return undefined;
};

const folderSegments = (folders: ReadonlyArray<string>): string[] | undefined => {
  const out: string[] = [];
  for (const folder of folders) {
    if (/^\(.*\)$/.test(folder)) continue;
    if (folder.startsWith("@") || folder.startsWith("_")) return undefined;
    out.push(bracketSegment(folder) ?? folder);
  }
  return out;
};

const ancestorFiles = (files: SourceFiles, root: string, folders: ReadonlyArray<string>, name: RegExp): string[] => {
  const found: string[] = [];
  for (let depth = 0; depth <= folders.length; depth++) {
    const dir = [root, ...folders.slice(0, depth)].filter((part) => part !== "").join("/");
    const match = [...files.keys()].filter((path) => dirOf(path) === dir && name.test(path.slice(dir === "" ? 0 : dir.length + 1))).sort()[0];
    if (match !== undefined) found.push(match);
  }
  return found;
};

const nextAppRoutes = (files: SourceFiles): CodeRoute[] => {
  const routes: CodeRoute[] = [];
  for (const path of sortedPaths(files)) {
    const found = /^((?:.*\/)?(?:src\/)?app)\/(?:(.*)\/)?page\.(?:tsx|jsx|ts|js|mdx)$/.exec(path);
    if (found === null || found[1]!.split("/").includes("node_modules")) continue;
    const folders = found[2] === undefined ? [] : found[2].split("/");
    const segments = folderSegments(folders);
    if (segments === undefined) continue;
    routes.push(routeOf({ path: routePath(segments), file: path, line: 1, source: "files", layouts: ancestorFiles(files, found[1]!, folders, /^layout\.(?:tsx|jsx|ts|js)$/) }));
  }
  return routes;
};

const pagesRoutes = (files: SourceFiles, extensions: RegExp, skip: (segments: ReadonlyArray<string>) => boolean): CodeRoute[] => {
  const routes: CodeRoute[] = [];
  for (const path of sortedPaths(files)) {
    const found = /^((?:.*\/)?(?:src\/)?pages)\/(.+)$/.exec(path);
    if (found === null || !extensions.test(found[2]!)) continue;
    const parts = found[2]!.replace(extensions, "").split("/");
    if (skip(parts)) continue;
    if (parts.at(-1) === "index") parts.pop();
    const segments = folderSegments(parts);
    if (segments === undefined) continue;
    routes.push(routeOf({ path: routePath(segments), file: path, line: 1, source: "files" }));
  }
  return routes;
};

const svelteKitRoutes = (files: SourceFiles): CodeRoute[] => {
  const routes: CodeRoute[] = [];
  for (const path of sortedPaths(files)) {
    const found = /^((?:.*\/)?src\/routes)\/(?:(.*)\/)?\+page\.svelte$/.exec(path);
    if (found === null) continue;
    const folders = found[2] === undefined ? [] : found[2].split("/");
    const segments = folderSegments(folders);
    if (segments === undefined) continue;
    routes.push(routeOf({ path: routePath(segments), file: path, line: 1, source: "files", layouts: ancestorFiles(files, found[1]!, folders, /^\+layout\.svelte$/) }));
  }
  return routes;
};

const flatSegment = (segment: string): string | undefined => {
  if (segment === "_index" || segment === "index" || segment === "route") return undefined;
  if (/^\(.*\)$/.test(segment)) return undefined;
  if (segment.startsWith("_")) return undefined;
  const trimmed = segment.replace(/_$/, "");
  if (trimmed === "$") return ":splat*";
  if (trimmed.startsWith("$")) return `:${trimmed.slice(1)}`;
  if (/^\[.*\]$/.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
};

const flatRoutes = (files: SourceFiles): CodeRoute[] => {
  const routes: CodeRoute[] = [];
  for (const path of sortedPaths(files)) {
    const found = /^((?:.*\/)?app)\/routes\/(.+)\.(?:tsx|jsx|ts|js)$/.exec(path);
    if (found === null) continue;
    let name = found[2]!;
    if (name.endsWith("/route")) name = name.slice(0, -"/route".length);
    const segments = name
      .split(/[./]/)
      .map(flatSegment)
      .filter((segment): segment is string => segment !== undefined);
    const root = ["root.tsx", "root.jsx", "root.ts", "root.js"].map((file) => `${found[1]}/${file}`).find((file) => files.has(file));
    routes.push(routeOf({ path: routePath(segments), file: path, line: 1, source: "files", layouts: root === undefined ? [] : [root] }));
  }
  return routes;
};

const tanstackPath = (raw: string): string =>
  routePath(
    raw
      .split("/")
      .map((segment) => (segment === "$" ? ":splat*" : segment.startsWith("$") ? `:${segment.slice(1)}` : segment))
      .filter((segment) => segment !== "" && !segment.startsWith("_") && !/^\(.*\)$/.test(segment)),
  );

const tanstackFileRoutes = (files: SourceFiles): CodeRoute[] => {
  const routes: CodeRoute[] = [];
  for (const path of sortedPaths(files)) {
    const source = files.get(path)!;
    for (const match of source.matchAll(/create(?:Lazy)?FileRoute\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
      routes.push(routeOf({ path: tanstackPath(match[1]!), file: path, line: lineAt(source, match.index), source: "files" }));
    }
  }
  return routes;
};

const ROUTER_FILE = /createBrowserRouter|createHashRouter|createMemoryRouter|<Route[\s>]|useRoutes\(|createRouter\(|RouteObject|RouteRecordRaw|createRoute\(|routes\s*[:=]\s*\[/;

const joinRoute = (parent: string | undefined, path: string): string | undefined => {
  if (path === "*" || path === "/*") return undefined;
  const clean = path.replace(/\/\*$/, "").replace(/\*$/, "");
  const segments = (clean.startsWith("/") || parent === undefined ? clean : `${parent}/${clean}`).split("/").map((segment) => (segment.startsWith("$") ? `:${segment.slice(1)}` : segment.replace(/\?$/, "")));
  return routePath(segments);
};

const componentOf = (files: SourceFiles, path: string, source: string, text: string): string | undefined => {
  const configs = aliasConfigs(files);
  const lazy = /import\(\s*['"]([^'"]+)['"]\s*\)/.exec(text);
  if (lazy !== null) return resolveImport(files, configs, path, lazy[1]!);
  const named = /(?:element\s*[:=]\s*\{?\s*<\s*([A-Z][\w$]*)|[Cc]omponent\s*[:=]\s*\{?\s*([A-Z][\w$]*))/.exec(text);
  const name = named?.[1] ?? named?.[2];
  if (name === undefined) return undefined;
  const lazyConst = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*(?:React\\.)?lazy\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*['"]([^'"]+)['"]`).exec(source);
  if (lazyConst !== null) return resolveImport(files, configs, path, lazyConst[1]!);
  const imported = new RegExp(`import\\s+(?:${name}\\b[^'"]*|[^'"]*\\{[^}]*\\b${name}\\b[^}]*\\}[^'"]*)from\\s*['"]([^'"]+)['"]`).exec(source);
  if (imported !== null) return resolveImport(files, configs, path, imported[1]!);
  return undefined;
};

interface Found {
  readonly start: number;
  readonly end: number;
  readonly path: string | undefined;
  readonly line: number;
  readonly entry: string | undefined;
}

const objectRoutes = (files: SourceFiles, path: string, source: string): Found[] => {
  const found: Found[] = [];
  for (const match of source.matchAll(/(?<![\w$.])(?:path\s*:\s*['"`]([^'"`]*)['"`]|index\s*:\s*true)/g)) {
    let open = -1;
    let depth = 0;
    for (let at = match.index - 1; at >= 0; at--) {
      const char = source[at];
      if (char === "}") depth++;
      else if (char === "{") {
        if (depth === 0) {
          open = at;
          break;
        }
        depth--;
      }
    }
    if (open === -1) continue;
    const close = matchingClose(source, open);
    if (close === -1) continue;
    const entries = objectEntries(source, open);
    const own = entries
      .filter((entry) => entry.key !== "children")
      .map((entry) => `${entry.key}: ${entry.value}`)
      .join("\n");
    found.push({ start: open, end: close, path: match[1], line: lineAt(source, match.index), entry: componentOf(files, path, source, own) });
  }
  return found;
};

const tagEnd = (source: string, from: number): number => {
  let depth = 0;
  for (let at = from; at < source.length; at++) {
    const char = source[at];
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (depth === 0 && (char === '"' || char === "'")) {
      const end = source.indexOf(char, at + 1);
      if (end === -1) return -1;
      at = end;
    } else if (depth === 0 && char === ">") return at;
  }
  return -1;
};

const jsxRoutes = (files: SourceFiles, path: string, source: string): Found[] => {
  const found: Found[] = [];
  const stack: number[] = [];
  const pattern = /<Route(?=[\s>/])|<\/Route\s*>/g;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    if (match[0].startsWith("</")) {
      const index = stack.pop();
      if (index !== undefined) found[index] = { ...found[index]!, end: match.index };
      continue;
    }
    const end = tagEnd(source, match.index + 6);
    if (end === -1) break;
    const tag = source.slice(match.index, end + 1);
    const routePathAttr = /\bpath\s*=\s*(?:["']([^"']*)["']|\{\s*['"`]([^'"`]*)['"`]\s*\})/.exec(tag);
    const selfClosing = source[end - 1] === "/";
    const route: Found = { start: match.index, end: selfClosing ? end : source.length, path: routePathAttr?.[1] ?? routePathAttr?.[2], line: lineAt(source, match.index), entry: componentOf(files, path, source, tag) };
    found.push(route);
    if (!selfClosing) stack.push(found.length - 1);
    pattern.lastIndex = end + 1;
  }
  return found;
};

const nestedRoutes = (path: string, found: ReadonlyArray<Found>): CodeRoute[] => {
  const routes: CodeRoute[] = [];
  const pathOf = new Map<Found, string | undefined>();
  const sorted = [...found].sort((a, b) => a.start - b.start || b.end - a.end);
  for (const route of sorted) {
    const parent = sorted.filter((other) => other !== route && other.start <= route.start && other.end >= route.end && !(other.start === route.start && other.end === route.end)).sort((a, b) => b.start - a.start)[0];
    const parentPath = parent === undefined ? undefined : pathOf.get(parent);
    const full = route.path === undefined ? (parentPath ?? "/") : joinRoute(parentPath, route.path);
    pathOf.set(route, full ?? parentPath);
    if (full === undefined) continue;
    routes.push(routeOf({ path: full, file: path, line: route.line, source: "config", ...(route.entry === undefined ? {} : { entry: route.entry }) }));
  }
  return routes;
};

const configRoutes = (files: SourceFiles): CodeRoute[] => {
  const routes: CodeRoute[] = [];
  for (const path of sortedPaths(files)) {
    if (!/\.(?:tsx|jsx|ts|js|mjs|vue)$/.test(path) || /(?:^|\/)(?:vite|next|tailwind|svelte|nuxt|astro|remix|eslint|postcss|vitest|playwright)\.config\./.test(path)) continue;
    const source = files.get(path)!;
    if (!ROUTER_FILE.test(source)) continue;
    routes.push(...nestedRoutes(path, objectRoutes(files, path, source)), ...nestedRoutes(path, jsxRoutes(files, path, source)));
  }
  return routes;
};

const ENTRIES = ["src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js", "src/index.tsx", "src/index.jsx", "src/index.ts", "src/index.js", "src/App.tsx", "src/App.jsx", "src/App.vue", "main.tsx", "main.ts", "index.tsx", "index.js"];

const entryRoute = (files: SourceFiles): CodeRoute[] => {
  const entry = ENTRIES.find((file) => files.has(file)) ?? [...files.keys()].sort().find((path) => /\/src\/main\.(?:tsx|ts|jsx|js)$/.test(path));
  return entry === undefined ? [] : [routeOf({ path: "/", file: entry, line: 1, source: "files" })];
};

const frameworkOf = (deps: Dependencies): string => {
  if (deps.has("next")) return "next";
  if (hasPrefix(deps, "@remix-run/")) return "remix";
  if (deps.has("@react-router/dev")) return "react-router";
  if (deps.has("@sveltejs/kit")) return "sveltekit";
  if (deps.has("nuxt")) return "nuxt";
  if (deps.has("astro")) return "astro";
  if (deps.has("react-scripts")) return "create-react-app";
  if (deps.has("vite")) return "vite";
  if (deps.has("vue")) return "vue";
  return "unknown";
};

const LIBRARIES: ReadonlyArray<readonly [string, (deps: Dependencies, files: SourceFiles) => boolean]> = [
  ["radix", (deps) => hasPrefix(deps, "@radix-ui/") || deps.has("radix-ui")],
  ["base-ui", (deps) => deps.has("@base-ui-components/react") || deps.has("@base-ui/react")],
  ["shadcn", (_deps, files) => [...files.keys()].some((path) => path === "components.json" || path.endsWith("/components.json"))],
  ["cva", (deps) => deps.has("class-variance-authority")],
  ["mui", (deps) => hasPrefix(deps, "@mui/")],
  ["chakra", (deps) => hasPrefix(deps, "@chakra-ui/")],
  ["headlessui", (deps) => hasPrefix(deps, "@headlessui/")],
  ["tanstack-query", (deps) => deps.has("@tanstack/react-query") || deps.has("@tanstack/vue-query")],
  ["swr", (deps) => deps.has("swr")],
  ["redux", (deps) => deps.has("redux") || deps.has("@reduxjs/toolkit")],
  ["zustand", (deps) => deps.has("zustand")],
  ["trpc", (deps) => hasPrefix(deps, "@trpc/")],
  ["graphql", (deps) => deps.has("graphql") || hasPrefix(deps, "@apollo/") || deps.has("urql")],
];

const stylingOf = (deps: Dependencies, files: SourceFiles): string[] => {
  const paths = [...files.keys()];
  const styling: string[] = [];
  if (deps.has("tailwindcss") || paths.some((path) => /(?:^|\/)tailwind\.config\./.test(path)) || [...files.values()].some((text) => /@import\s+["']tailwindcss["']/.test(text))) styling.push("tailwind");
  if (paths.some((path) => /\.module\.(?:css|scss)$/.test(path))) styling.push("css-modules");
  if (deps.has("sass") || paths.some((path) => path.endsWith(".scss"))) styling.push("sass");
  if (deps.has("styled-components")) styling.push("styled-components");
  if (hasPrefix(deps, "@emotion/")) styling.push("emotion");
  return styling;
};

const routerOf = (deps: Dependencies, framework: string, next: { readonly app: boolean; readonly pages: boolean }): string => {
  if (framework === "next") return next.app ? "next-app" : "next-pages";
  if (framework === "remix" || framework === "react-router") return framework;
  if (framework === "sveltekit" || framework === "nuxt" || framework === "astro") return framework;
  if (deps.has("@tanstack/react-router")) return "tanstack-router";
  if (deps.has("react-router") || deps.has("react-router-dom")) return "react-router";
  if (deps.has("vue-router")) return "vue-router";
  if (deps.has("wouter")) return "wouter";
  return "none";
};

export const discoverRoutes = (files: SourceFiles): { readonly stack: CodeStack; readonly routes: CodeRoute[] } => {
  const deps = dependenciesOf(files);
  const framework = frameworkOf(deps);
  const found: CodeRoute[] = [];
  const app = framework === "next" ? nextAppRoutes(files) : [];
  const pages = framework === "next" ? pagesRoutes(files, /\.(?:tsx|jsx|ts|js|mdx)$/, (parts) => parts[0] === "api" || /^_(?:app|document|error)$/.test(parts.at(-1) ?? "")) : [];
  found.push(...app, ...pages);
  if (framework === "remix" || framework === "react-router") found.push(...flatRoutes(files));
  if (framework === "sveltekit") found.push(...svelteKitRoutes(files));
  if (framework === "nuxt") found.push(...pagesRoutes(files, /\.vue$/, () => false));
  found.push(...pagesRoutes(files, /\.astro$/, () => false));
  found.push(...tanstackFileRoutes(files));
  if (found.length === 0) found.push(...configRoutes(files));
  if (found.length === 0) found.push(...entryRoute(files));
  const byPath = new Map<string, CodeRoute>();
  for (const route of found) if (!byPath.has(route.path)) byPath.set(route.path, route);
  const routes = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const paths = [...files.keys()];
  const stack: CodeStack = {
    framework,
    router: routerOf(deps, framework, { app: app.length > 0, pages: pages.length > 0 }),
    language: paths.some((path) => /\.tsx?$/.test(path) || /(?:^|\/)tsconfig\.json$/.test(path)) ? "ts" : "js",
    styling: stylingOf(deps, files),
    libraries: LIBRARIES.filter(([, test]) => test(deps, files)).map(([name]) => name),
  };
  return { stack, routes };
};
