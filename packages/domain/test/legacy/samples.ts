/** The old-format sample files in `assets/legacy-samples/`, read only. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SAMPLES = fileURLToPath(new URL("../../../../assets/legacy-samples/", import.meta.url));

/** A sample file's text, or `null` when there is none. */
export const sampleText = (path: string): string | null => {
  const full = join(SAMPLES, path);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
};

export const sampleBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(join(SAMPLES, path)));

export const sampleFiles = (project: string): string[] => readdirSync(join(SAMPLES, project), { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
