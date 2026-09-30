/** The old-format samples of spec 11, for the engine and browser seams alike. Framework-free. */
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./engineProcess.ts";

export const SAMPLES = join(repoRoot, "assets", "legacy-samples");

/** Copies the samples into `outputDir`, which then stands in for an old output folder. Tests change the copy, never the samples. */
export const copySamples = (outputDir: string): Promise<void> => cp(SAMPLES, outputDir, { recursive: true, filter: (source) => !source.endsWith("README.md") });
