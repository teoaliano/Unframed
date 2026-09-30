import { readdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { chromeCandidates } from "@unframed/domain";
import type { TestRenderer } from "../config.ts";

const versionsIn = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);

/**
 * The Chromium this machine has, for renders, snapshots and the agent's previews: the first
 * candidate that exists, `UNFRAMED_CHROME_PATH` first (skipped when it does not exist).
 */
export const findChrome = async (options: { readonly chromePath: string | undefined; readonly platform: NodeJS.Platform; readonly testRenderer: TestRenderer | undefined }): Promise<string | undefined> => {
  if (options.testRenderer === "no-chrome") return undefined;
  const env = { ...process.env, UNFRAMED_CHROME_PATH: options.chromePath };
  for (const candidate of chromeCandidates({ platform: options.platform, env, home: homedir(), versionsIn })) {
    if (await isFile(candidate)) return candidate;
  }
  return undefined;
};
