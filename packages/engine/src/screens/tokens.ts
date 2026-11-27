import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { TokenScale, UnframedError } from "@unframed/contracts";
import { ANALYSIS_FILES, tokenScaleOf, type CssSource, type DesignSystemIndex } from "@unframed/domain";
import * as Effect from "effect/Effect";

const run = promisify(execFile);

const MAX_FILES = 200;
const MAX_BYTES = 1024 * 1024;
const SKIP = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.unframed|\.git)\//;

interface Cached {
  readonly revision: string;
  readonly scale: TokenScale;
}

const git = (worktree: string, args: string[]): Promise<string> => run("git", args, { cwd: worktree, maxBuffer: 64 * 1024 * 1024 }).then(({ stdout }) => stdout, () => "");

const cssFiles = async (worktree: string): Promise<string[]> => {
  const listed = await git(worktree, ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.css"]);
  return listed
    .split("\n")
    .filter((path) => path.endsWith(".css") && !SKIP.test(path))
    .sort()
    .slice(0, MAX_FILES);
};

const stamp = (path: string): Promise<string> => stat(path).then((info) => `${info.mtimeMs}:${info.size}`, () => "missing");

const designSystemOf = async (path: string): Promise<DesignSystemIndex | null> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || !Array.isArray((parsed as { tokens?: unknown }).tokens)) return null;
    const tokens = (parsed as { tokens: unknown[] }).tokens.filter(
      (token): token is DesignSystemIndex["tokens"][number] =>
        token !== null &&
        typeof token === "object" &&
        typeof (token as Record<string, unknown>).name === "string" &&
        typeof (token as Record<string, unknown>).value === "string" &&
        typeof (token as Record<string, unknown>).kind === "string" &&
        typeof (token as Record<string, unknown>).file === "string" &&
        typeof (token as Record<string, unknown>).line === "number" &&
        ((token as Record<string, unknown>).source === "css" || (token as Record<string, unknown>).source === "tailwind"),
    );
    return { version: 1, components: [], tokens };
  } catch {
    return null;
  }
};

export const makeScreenTokens = (worktreeOf: (project: string, instance: string) => Effect.Effect<string, UnframedError>) => {
  const cache = new Map<string, Cached>();

  const scaleOf = async (worktree: string): Promise<Cached> => {
    const files = await cssFiles(worktree);
    const indexPath = join(worktree, ANALYSIS_FILES.designSystem);
    const head = (await git(worktree, ["rev-parse", "HEAD"])).trim();
    const stamps = await Promise.all([...files.map((file) => stamp(join(worktree, file))), stamp(indexPath)]);
    const revision = createHash("sha1")
      .update([head, ...files.map((file, index) => `${file}:${stamps[index]}`), `index:${stamps.at(-1)}`].join("\n"))
      .digest("hex")
      .slice(0, 16);
    const cached = cache.get(worktree);
    if (cached?.revision === revision) return cached;
    const css: CssSource[] = [];
    for (const file of files) {
      const path = join(worktree, file);
      const info = await stat(path).catch(() => undefined);
      if (info === undefined || info.size > MAX_BYTES) continue;
      css.push({ file, text: await readFile(path, "utf8") });
    }
    const next = { revision, scale: tokenScaleOf({ css, designSystem: await designSystemOf(indexPath) }) };
    cache.set(worktree, next);
    return next;
  };

  const read = (input: { project: string; instance: string }): Effect.Effect<{ revision: string; scale: TokenScale }, UnframedError> =>
    Effect.flatMap(worktreeOf(input.project, input.instance), (worktree) => Effect.promise(() => scaleOf(worktree)));

  return { read };
};
