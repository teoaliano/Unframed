/**
 * The tokens script in a project folder (spec 19): `unframed-tokens.js`, written from the
 * domain's `tokensScript(kit)`. It is a helper file kept current by rewriting, so the rule
 * is "differs from the kit's output", and the write goes through a temp file and a rename.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tokensScript, type Kit } from "@unframed/domain";

export const TOKENS_FILE = "unframed-tokens.js";

/** The document record's kit, or null when the canvas has none. */
export const kitOf = (records: ReadonlyArray<{ readonly typeName?: string; readonly meta?: unknown }>): Kit | null => {
  const document = records.find((record) => record.typeName === "document");
  const kit = (document?.meta as { unframed?: { kit?: unknown } } | undefined)?.unframed?.kit;
  return kit === undefined || kit === null ? null : (kit as Kit);
};

/** Writes are queued, so a later kit always lands after an earlier one, even when two commits race. */
let queue: Promise<void> = Promise.resolve();

const writeOne = async (folder: string, kit: Kit | null): Promise<void> => {
  const text = tokensScript(kit);
  const path = join(folder, TOKENS_FILE);
  const current = await readFile(path, "utf8").catch(() => undefined);
  if (current === text) return;
  await mkdir(folder, { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, "utf8");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
};

/** Writes the tokens script for `kit` into `folder` when the file on disk differs from it. */
export const ensureTokens = (folder: string, kit: Kit | null): Promise<void> => {
  const run = queue.then(() => writeOne(folder, kit));
  queue = run.catch(() => undefined);
  return run;
};

/** Writes started by a room's hooks and not yet finished, so a project removal can wait for them. */
const inflight = new Set<Promise<unknown>>();

/**
 * Writes the script for a project whose folder is found when the write starts: a room's hooks
 * call this, and a removal waits for every call still running (`settleTokens`).
 */
export const ensureTokensFor = (folder: () => Promise<string | undefined>, kit: Kit | null, onError: (error: unknown) => void): void => {
  const run = folder()
    .then((path) => (path === undefined ? undefined : ensureTokens(path, kit)))
    .catch(onError);
  inflight.add(run);
  void run.finally(() => inflight.delete(run));
};

/** Resolves once every tokens write started so far has finished. */
export const settleTokens = async (): Promise<void> => {
  while (inflight.size > 0) await Promise.all([...inflight]);
};
