import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ANALYSIS_FILES,
  ANALYSIS_MAX_FILE_BYTES,
  ANALYSIS_MAX_FILES,
  analysedPath,
  analyseRepository,
  mergeExclude,
  routeFor,
  type CodeMap,
  type DesignSystemIndex,
  type PreparedState,
  type RepoAnalysis,
  type StatesIndex,
} from "@unframed/domain";
import * as Effect from "effect/Effect";
import { gitOutput, type Git } from "./git.ts";

const readJson = async <A>(path: string): Promise<A | undefined> => {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as A;
  } catch {
    return undefined;
  }
};

export const readAnalysis = async (worktree: string): Promise<Partial<RepoAnalysis>> => {
  const [codeMap, designSystem, states] = await Promise.all([
    readJson<CodeMap>(join(worktree, ANALYSIS_FILES.codeMap)),
    readJson<DesignSystemIndex>(join(worktree, ANALYSIS_FILES.designSystem)),
    readJson<StatesIndex>(join(worktree, ANALYSIS_FILES.states)),
  ]);
  return { ...(codeMap === undefined ? {} : { codeMap }), ...(designSystem === undefined ? {} : { designSystem }), ...(states === undefined ? {} : { states }) };
};

const writeJson = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

export const excludeAnalysis = async (gitCommonDir: string, files: ReadonlyArray<string>) => {
  const exclude = join(gitCommonDir, "info", "exclude");
  const existing = await readFile(exclude, "utf8").catch(() => "");
  const merged = mergeExclude(existing, files.map((file) => `/${file}`));
  if (merged === existing) return;
  await mkdir(dirname(exclude), { recursive: true });
  await writeFile(exclude, merged);
};

const sourceFiles = async (worktree: string, listed: ReadonlyArray<string>): Promise<Map<string, string>> => {
  const files = new Map<string, string>();
  for (const path of listed) {
    if (files.size >= ANALYSIS_MAX_FILES) break;
    if (!analysedPath(path)) continue;
    const full = join(worktree, path);
    const info = await stat(full).catch(() => undefined);
    if (info === undefined || !info.isFile() || info.size > ANALYSIS_MAX_FILE_BYTES) continue;
    const text = await readFile(full, "utf8").catch(() => undefined);
    if (text !== undefined) files.set(path, text);
  }
  return files;
};

export const analyseWorktree = (git: Git, input: { readonly worktree: string; readonly gitCommonDir: string }) =>
  Effect.gen(function* () {
    const listed = (gitOutput(yield* git(input.worktree, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])) ?? "").split("\0").filter((path) => path !== "");
    return yield* Effect.promise(async () => {
      const files = await sourceFiles(input.worktree, [...new Set(listed)].sort());
      const previous = await readAnalysis(input.worktree);
      const analysis = analyseRepository(files, previous);
      await writeJson(join(input.worktree, ANALYSIS_FILES.codeMap), analysis.codeMap);
      await writeJson(join(input.worktree, ANALYSIS_FILES.designSystem), analysis.designSystem);
      await writeJson(join(input.worktree, ANALYSIS_FILES.states), analysis.states);
      await excludeAnalysis(input.gitCommonDir, Object.values(ANALYSIS_FILES));
      return { analysis, files: files.size };
    });
  });

export const savePrepared = async (worktree: string, route: string, prepared: ReadonlyArray<PreparedState>): Promise<StatesIndex | undefined> => {
  const path = join(worktree, ANALYSIS_FILES.states);
  const states = await readJson<StatesIndex>(path);
  if (states === undefined) return undefined;
  const pattern = routeFor(states, route) ?? route;
  const known = states.routes.some((entry) => entry.route === pattern);
  const keep = (list: ReadonlyArray<PreparedState>) => [...list.filter((old) => !prepared.some((added) => added.state === old.state)), ...prepared];
  const next: StatesIndex = {
    ...states,
    routes: known ? states.routes.map((entry) => (entry.route === pattern ? { ...entry, prepared: keep(entry.prepared) } : entry)) : [...states.routes, { route: pattern, files: 0, cases: [], prepared: [...prepared] }],
  };
  await writeJson(path, next);
  return next;
};
