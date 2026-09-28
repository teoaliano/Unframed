import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

declare const __UNFRAMED_BUNDLE__: boolean | undefined;

/**
 * The repository root when run from a clone, the bundle root when run from the published
 * bundle (`server/index.js` sits one level below it).
 */
export const installRoot = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = typeof __UNFRAMED_BUNDLE__ === "boolean" && __UNFRAMED_BUNDLE__;
  return bundled ? resolve(here, "..") : resolve(here, "../../..");
};

/**
 * `UNFRAMED_DATA_DIR` when set, else the install root. The read path and the write path
 * both use this one function: writing `.env` somewhere the next boot does not read loses
 * the key silently.
 */
export const resolveDataDir = (env: NodeJS.ProcessEnv, root: string): string => {
  const value = env.UNFRAMED_DATA_DIR?.trim();
  return value ? resolve(value) : root;
};

/** `OUTPUT_DIR` against the data folder. An absolute path passes through unchanged. */
export const resolveOutputDir = (outputDir: string, dataDir: string): string => resolve(dataDir, outputDir);

export const envFilePath = (dataDir: string): string => join(dataDir, ".env");

/** A file name from a request, reduced to its basename so it cannot leave its folder. `undefined` when none is left. */
export const fileNameOf = (name: string): string | undefined => {
  const base = basename(name);
  return base === "" || base === "." || base === ".." ? undefined : base;
};

export const preferencesFilePath = (dataDir: string): string => join(dataDir, "preferences.json");
