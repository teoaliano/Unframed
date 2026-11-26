import type { CodeRoute, SourceFiles, StateCase, StateCaseKind, StatesIndex } from "./types.ts";
import { importClosure } from "./imports.ts";

const TEXT_MAX = 160;
const SWITCH_REACH = 60;
const CONDITION = /\bif\s*\(|\?(?![.?])|&&|\|\||\bcase\b|v-if|v-else-if|v-show|\{#if|\{:else if|\bwhen\b|\bunless\b/;
const PATH = "[\\w$]+(?:\\??\\.[\\w$]+)*";

const pathEnding = (line: string, word: string): RegExpExecArray | null => new RegExp(`(?<![\\w$.])((?:[\\w$]+\\??\\.)*${word})\\b`).exec(line);

const cleanPath = (path: string): string => path.replace(/\?\./g, ".");

interface Rule {
  readonly kind: StateCaseKind;
  readonly find: (line: string, conditional: boolean) => string | undefined;
}

const firstWord = (line: string, words: ReadonlyArray<string>, skip?: RegExp): string | undefined => {
  const bare = line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
  for (const word of words) {
    const found = pathEnding(bare, word);
    if (found === null) continue;
    const path = cleanPath(found[1]!);
    if (skip?.test(path)) continue;
    return path;
  }
  return undefined;
};

const tagOf = (line: string, names: RegExp): string | undefined => names.exec(line)?.[1];

const RULES: ReadonlyArray<Rule> = [
  {
    kind: "loading",
    find: (line, conditional) =>
      tagOf(line, /<((?:[\w$]+\.)?(?:Skeleton|Spinner|Loader|Loading)\w*)(?=[\s/>])/) ??
      (/Suspense\s+fallback|\bfallback\s*=\s*\{/.test(line) ? "Suspense fallback" : undefined) ??
      (conditional ? firstWord(line, ["isLoading", "isPending", "isFetching", "loading", "pending", "isInitialLoading"], /^(?:import|console)\b/) : undefined),
  },
  {
    kind: "error",
    find: (line, conditional) =>
      tagOf(line, /<((?:[\w$]+\.)?ErrorBoundary|ErrorState|ErrorMessage|ErrorPage)(?=[\s/>])/) ??
      (/\berrorElement\b/.test(line) ? "errorElement" : undefined) ??
      (conditional && !/\bcatch\s*\(|throw\s+new|new\s+Error\(/.test(line) ? firstWord(line, ["isError", "hasError", "error", "failed", "isFailed"], /^(?:console|Error|err\.message)\b|\.error\(/) : undefined),
  },
  {
    kind: "empty",
    find: (line) => {
      const zero = new RegExp(`(${PATH})\\.length\\s*===?\\s*0`).exec(line) ?? new RegExp(`!\\s*(${PATH})\\.length\\b`).exec(line) ?? new RegExp(`(${PATH})\\.length\\s*>\\s*0\\s*\\?`).exec(line) ?? new RegExp(`(${PATH})\\.length\\s*\\?`).exec(line);
      if (zero !== null) return `${cleanPath(zero[1]!)}.length`;
      return tagOf(line, /<((?:[\w$]+\.)?Empty\w*)(?=[\s/>])/) ?? firstWord(line, ["isEmpty"]);
    },
  },
  {
    kind: "role",
    find: (line) => {
      const role = new RegExp(`(${PATH}\\??\\.role|\\brole)\\s*(?:===?|!==?)`).exec(line);
      if (role !== null) return cleanPath(role[1]!);
      const can = /\bcan\(\s*(['"`][^'"`]*['"`])?/.exec(line);
      if (can !== null) return can[1] === undefined ? "can()" : `can(${can[1]})`;
      return firstWord(line, ["isAdmin", "isOwner", "permissions"]);
    },
  },
  {
    kind: "status",
    find: (line) => {
      const status = new RegExp(`(${PATH})\\s*(?:===?|!==?)\\s*['"\`]`).exec(line);
      return status !== null && /status|state|phase|stage/i.test(status[1]!.split(".").at(-1)!) ? cleanPath(status[1]!) : undefined;
    },
  },
  {
    kind: "auth",
    find: (line) => {
      const signedOut = /!\s*((?:[\w$]+\??\.)*(?:user|session|currentUser|me|viewer|account))\b(?!\s*\.)/.exec(line);
      if (signedOut !== null) return cleanPath(signedOut[1]!);
      return tagOf(line, /<(SignedOut|SignedIn|RequireAuth|Protected\w*)(?=[\s/>])/) ?? firstWord(line, ["isAuthenticated", "isSignedIn", "isLoggedIn", "authenticated"]);
    },
  },
  {
    kind: "dialog",
    find: (line) => {
      const tag = /<((?:[\w$]+\.)?(?:Dialog|Modal|AlertDialog|Sheet|Drawer))(?=[\s/>])/.exec(line) ?? (/\bopen\s*=/.test(line) ? /<((?:[\w$]+\.)?Popover)(?=[\s/>])/.exec(line) : null);
      if (tag === null) return undefined;
      const open = /\bopen\s*=\s*\{([^}]+)\}/.exec(line);
      return open === null ? tag[1] : cleanPath(open[1]!.trim());
    },
  },
  {
    kind: "firstrun",
    find: (line, conditional) => (conditional ? firstWord(line, ["onboarding", "showOnboarding", "hasOnboarded", "firstRun", "isFirstRun", "isNew", "isNewUser", "welcome", "showWelcome"]) : undefined),
  },
];

export const stateCasesOf = (file: string, source: string): StateCase[] => {
  const cases: StateCase[] = [];
  let inComment = false;
  let switchOn: { readonly reads: string; readonly line: number } | undefined;
  source.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (inComment) {
      if (line.includes("*/")) inComment = false;
      return;
    }
    if (line.startsWith("/*") && !line.includes("*/")) {
      inComment = true;
      return;
    }
    if (line === "" || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*") || /^import\b/.test(line) || /^export\s+(?:\*|\{[^}]*\})\s+from\b/.test(line)) return;
    const code = line.replace(/\s\/\/.*$/, "");
    const at = { file, line: index + 1, text: line.length > TEXT_MAX ? line.slice(0, TEXT_MAX) : line };
    const conditional = CONDITION.test(code);
    for (const rule of RULES) {
      const reads = rule.find(code, conditional);
      if (reads !== undefined) cases.push({ kind: rule.kind, reads, ...at });
    }
    const switched = new RegExp(`switch\\s*\\(\\s*(${PATH})\\s*\\)`).exec(code);
    if (switched !== null) switchOn = /status|state|phase|stage|kind|step/i.test(switched[1]!) ? { reads: cleanPath(switched[1]!), line: index } : undefined;
    else if (switchOn !== undefined && index - switchOn.line <= SWITCH_REACH && /^case\s+['"`]/.test(code) && !cases.some((found) => found.line === index + 1 && found.kind === "status")) {
      cases.push({ kind: "status", reads: switchOn.reads, ...at });
    }
  });
  return cases;
};

export const statesIndexOf = (files: SourceFiles, routes: ReadonlyArray<CodeRoute>): StatesIndex => ({
  version: 1,
  routes: routes.map((route) => {
    const closure: string[] = [];
    const seen = new Set<string>();
    for (const entry of [route.entry ?? route.file, ...route.layouts]) {
      for (const file of importClosure(files, entry)) {
        if (seen.has(file)) continue;
        seen.add(file);
        closure.push(file);
      }
    }
    const cases: StateCase[] = [];
    const keys = new Set<string>();
    for (const file of closure) {
      for (const found of stateCasesOf(file, files.get(file) ?? "")) {
        const key = `${found.file}:${found.line}:${found.kind}`;
        if (keys.has(key)) continue;
        keys.add(key);
        cases.push(found);
      }
    }
    return { route: route.path, files: closure.length, cases, prepared: [] };
  }),
});

const segmentsOf = (path: string): string[] => path.split("/").filter((segment) => segment !== "");

const matchScore = (pattern: string, path: string): number | undefined => {
  const want = segmentsOf(pattern);
  const have = segmentsOf(path);
  let score = 0;
  for (let at = 0; at < want.length; at++) {
    const segment = want[at]!;
    if (segment.startsWith(":") && segment.endsWith("*")) return have.length >= at ? score : undefined;
    const value = have[at];
    if (value === undefined) return undefined;
    if (segment.startsWith(":")) score += 1;
    else if (segment === value) score += 100;
    else return undefined;
  }
  return have.length === want.length ? score + 1000 : undefined;
};

export const routeFor = (index: { readonly routes: ReadonlyArray<{ readonly route: string }> }, path: string): string | undefined => {
  const clean = path.split(/[?#]/)[0] ?? "";
  let best: { readonly route: string; readonly score: number } | undefined;
  for (const { route } of index.routes) {
    const score = matchScore(route, clean);
    if (score !== undefined && (best === undefined || score > best.score)) best = { route, score };
  }
  return best?.route;
};

export const mergeStatesIndex = (previous: StatesIndex | undefined, next: StatesIndex): StatesIndex => {
  if (previous === undefined) return next;
  const prepared = new Map(previous.routes.map((route) => [route.route, route.prepared] as const));
  const known = new Set(next.routes.map((route) => route.route));
  const kept = previous.routes.filter((route) => !known.has(route.route) && route.prepared.length > 0).map((route) => ({ route: route.route, files: 0, cases: [], prepared: route.prepared }));
  return { ...next, routes: [...next.routes.map((route) => ({ ...route, prepared: prepared.get(route.route) ?? route.prepared })), ...kept] };
};
