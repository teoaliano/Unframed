import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { envUpsert } from "@unframed/domain";
import { writeFileAtomic } from "./atomicFile.ts";

/** Reads `.env` for boot. A missing file is empty; any other failure is the caller's to report. */
export const readEnvFileSync = (path: string): Record<string, string> => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return parseEnvText(text);
};

export const parseEnvText = (text: string): Record<string, string> =>
  parseEnv(text) as Record<string, string>;

/**
 * The only code that writes `.env`. It queues writes on one chain; each reads the
 * current file, applies the upsert and writes. A failed write rejects its own caller and
 * never blocks or fails the next one. Answers the text now on disk.
 */
export const makeEnvWriter = (path: string) => {
  let chain: Promise<unknown> = Promise.resolve();
  return (changes: Readonly<Record<string, string | null>>): Promise<string> => {
    const write = chain.then(async () => {
      let text = "";
      try {
        text = await readFile(path, "utf8");
      } catch (error) {
        // Only a missing file is empty. Treating an unreadable one as empty would drop
        // every other line, the key included.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const next = envUpsert(text, changes);
      await writeFileAtomic(path, next);
      return next;
    });
    chain = write.catch(() => {});
    return write;
  };
};
