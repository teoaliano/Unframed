import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tokensScript, type Kit } from "@unframed/domain";

export const TOKENS_FILE = "unframed-tokens.js";

export const kitOf = (records: ReadonlyArray<{ readonly typeName?: string; readonly meta?: unknown }>): Kit | null => {
  const document = records.find((record) => record.typeName === "document");
  const kit = (document?.meta as { unframed?: { kit?: unknown } } | undefined)?.unframed?.kit;
  return kit === undefined || kit === null ? null : (kit as Kit);
};

let queue: Promise<void> = Promise.resolve();

const writeOne = async (folder: string, kit: Kit | null): Promise<void> => {
  const text = tokensScript(kit);
  const path = join(folder, TOKENS_FILE);
  const current = await readFile(path, "utf8").catch(() => undefined);
  if (current === text) return;
  if (!(await stat(folder).then((info) => info.isDirectory(), () => false))) return;
  const temp = join(dirname(folder), `.${TOKENS_FILE}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, "utf8");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
};

export const ensureTokens = (folder: string, kit: Kit | null): Promise<void> => {
  const run = queue.then(() => writeOne(folder, kit));
  queue = run.catch(() => undefined);
  return run;
};

const inflight = new Set<Promise<unknown>>();

export const ensureTokensFor = (folder: () => Promise<string | undefined>, kit: Kit | null, onError: (error: unknown) => void): void => {
  const write = queue.then(async () => {
    const path = await folder();
    if (path !== undefined) await writeOne(path, kit);
  });
  queue = write.catch(() => undefined);
  const run = write.catch(onError);
  inflight.add(run);
  void run.finally(() => inflight.delete(run));
};

export const settleTokens = async (): Promise<void> => {
  while (inflight.size > 0) await Promise.all([...inflight]);
};
