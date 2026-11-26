import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { unframedError, type ScreenJsx, type ScreenWrite, type ScreenWriteResult, type UnframedError } from "@unframed/contracts";
import { inspectJsx, worktreeFile, writeJsx, type SpanEdit } from "@unframed/domain/jsx";
import * as Effect from "effect/Effect";

const run = promisify(execFile);

interface Written {
  readonly file: string;
  readonly edit: SpanEdit;
  readonly context: string;
}

interface Applied {
  readonly project: string;
  readonly worktree: string;
  readonly edits: ReadonlyArray<Written>;
}

export const NOT_IN_WORKTREE = (file: string): string => `${file} is not a file in this branch's worktree.`;

const isFile = (path: string): Promise<boolean> => stat(path).then((info) => info.isFile(), () => false);

export const findInWorktree = async (worktree: string, reported: string): Promise<string | undefined> => {
  const relative = worktreeFile(reported, worktree);
  if (relative === undefined || relative.startsWith(".git/")) return undefined;
  if (await isFile(join(worktree, relative))) return relative;
  const listed = await run("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: worktree, maxBuffer: 64 * 1024 * 1024 }).then(
    ({ stdout }) => stdout.split("\n"),
    () => [],
  );
  const matches = listed.filter((path) => path === relative || path.endsWith(`/${relative}`));
  return matches.length === 1 ? matches[0] : undefined;
};

export const makeDirectEdits = (worktreeOf: (project: string, instance: string) => Effect.Effect<string, UnframedError>) => {
  const applied = new Map<string, Applied>();

  const inspect = (input: { project: string; instance: string; file: string; line: number; col: number; tag?: string }): Effect.Effect<ScreenJsx, UnframedError> =>
    Effect.gen(function* () {
      const worktree = yield* worktreeOf(input.project, input.instance);
      const file = yield* Effect.promise(() => findInWorktree(worktree, input.file));
      if (file === undefined) return yield* unframedError("not_found", NOT_IN_WORKTREE(input.file));
      const source = yield* Effect.promise(() => readFile(join(worktree, file), "utf8"));
      const found = inspectJsx(source, file, { line: input.line, col: input.col, ...(input.tag === undefined ? {} : { tag: input.tag }) });
      if (found === undefined) return yield* unframedError("not_found", `No JSX element starts at ${file}:${input.line}:${input.col}.`);
      return { file, ...found, cva: found.cva.map((entry) => ({ name: entry.name, variants: entry.variants.map((variant) => ({ ...variant, options: [...variant.options] })) })) };
    });

  const apply = (input: { project: string; instance: string; changes: ReadonlyArray<ScreenWrite> }): Effect.Effect<{ apply: string; results: ScreenWriteResult[] }, UnframedError> =>
    Effect.gen(function* () {
      const worktree = yield* worktreeOf(input.project, input.instance);
      const results: ScreenWriteResult[] = [];
      const texts = new Map<string, string>();
      const written: Written[] = [];
      for (const change of input.changes) {
        const file = yield* Effect.promise(() => findInWorktree(worktree, change.file));
        if (file === undefined) {
          results.push({ id: change.id, written: false, reason: NOT_IN_WORKTREE(change.file), file: null, line: null });
          continue;
        }
        const source = texts.get(file) ?? (yield* Effect.promise(() => readFile(join(worktree, file), "utf8")));
        const result = writeJsx(source, file, { line: change.line, col: change.col, ...(change.tag === undefined ? {} : { tag: change.tag }) }, change);
        if (!result.ok) {
          results.push({ id: change.id, written: false, reason: result.reason, file, line: change.line });
          continue;
        }
        texts.set(file, result.text);
        let shift = 0;
        for (const edit of [...result.edits].sort((a, b) => a.start - b.start)) {
          const start = edit.start + shift;
          written.push({ file, edit: { ...edit, start, end: start + edit.after.length }, context: result.text.slice(Math.max(0, start - 40), start) });
          shift += edit.after.length - (edit.end - edit.start);
        }
        results.push({ id: change.id, written: true, reason: null, file, line: result.line });
      }
      yield* Effect.tryPromise({
        try: async () => {
          for (const [file, text] of texts) await writeFile(join(worktree, file), text);
        },
        catch: (error) => unframedError("internal", `Could not write the change: ${error instanceof Error ? error.message : String(error)}`),
      });
      const id = randomUUID();
      if (written.length > 0) applied.set(id, { project: input.project, worktree, edits: written });
      return { apply: id, results };
    });

  const revert = (input: { project: string; apply: string }): Effect.Effect<{ reverted: number; kept: string[] }, UnframedError> =>
    Effect.gen(function* () {
      const record = applied.get(input.apply);
      if (record === undefined || record.project !== input.project) return yield* unframedError("not_found", "Those changes can no longer be undone.");
      applied.delete(input.apply);
      return yield* Effect.tryPromise({
        try: async () => {
          const texts = new Map<string, string>();
          const kept: string[] = [];
          let reverted = 0;
          for (const { file, edit, context } of [...record.edits].reverse()) {
            const text = texts.get(file) ?? (await readFile(join(record.worktree, file), "utf8"));
            let at = text.slice(edit.start, edit.end) === edit.after && text.slice(Math.max(0, edit.start - context.length), edit.start) === context ? edit.start : -1;
            if (at === -1) {
              const needle = context + edit.after;
              const first = text.indexOf(needle);
              if (first !== -1 && text.indexOf(needle, first + 1) === -1) at = first + context.length;
            }
            if (at === -1) {
              kept.push(`${file}: ${edit.after === "" ? `removed ${JSON.stringify(edit.before)}` : JSON.stringify(edit.after)}`);
              continue;
            }
            texts.set(file, text.slice(0, at) + edit.before + text.slice(at + edit.after.length));
            reverted += 1;
          }
          for (const [file, text] of texts) await writeFile(join(record.worktree, file), text);
          return { reverted, kept };
        },
        catch: (error) => unframedError("internal", `Could not undo the change: ${error instanceof Error ? error.message : String(error)}`),
      });
    });

  return { inspect, apply, revert };
};
