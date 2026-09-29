/**
 * The engine seam for spec 11: an engine whose output folder is a copy of the old-format
 * samples in `assets/legacy-samples/`. Tests change the copy, never the samples.
 */
import { createHash } from "node:crypto";
import { cp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir, repoRoot, startEngine, type EngineOptions, type TestEngine } from "./harness.ts";

export const SAMPLES = join(repoRoot, "assets", "legacy-samples");
export const SAMPLE_PROJECTS = ["everything", "legacy-snapshot", "broken-snapshot"] as const;

export interface LegacyEngine {
  readonly engine: TestEngine;
  readonly outputDir: string;
  readonly folder: (project: string) => string;
}

/** A data folder whose output folder holds the samples, before any engine has seen it. */
export const legacyDataDir = async (): Promise<string> => {
  const dataDir = await makeTempDir("unframed-legacy-");
  await cp(SAMPLES, join(dataDir, "output"), { recursive: true, filter: (source) => !source.endsWith("README.md") });
  return dataDir;
};

export const startLegacyEngine = async (options: EngineOptions & { readonly dataDir?: string } = {}): Promise<LegacyEngine> => {
  const dataDir = options.dataDir ?? (await legacyDataDir());
  const engine = await startEngine({ ...options, dataDir, env: { UNFRAMED_TEST_CANVAS: "1", ...options.env } });
  const outputDir = join(dataDir, "output");
  return { engine, outputDir, folder: (project) => join(outputDir, project) };
};

/** Every file under `folder` by its path relative to it, with the SHA-256 of its bytes. */
export const fileDigests = async (folder: string): Promise<Record<string, string>> => {
  const digests: Record<string, string> = {};
  const walk = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path, `${prefix}${entry.name}/`);
      else digests[`${prefix}${entry.name}`] = createHash("sha256").update(await readFile(path)).digest("hex");
    }
  };
  await walk(folder, "");
  return digests;
};

export type AnyRecord = { id: string; typeName: string; type?: string; x?: number; y?: number; parentId?: string; props?: any; meta?: any };

/** The room's records for `project`, read through the engine (which opens, and so imports, it). */
export const canvasRecords = async (engine: TestEngine, project: string): Promise<AnyRecord[]> =>
  (await (await engine.rpc()).call("testCanvas.read", { project })).records as AnyRecord[];

/** The shape whose `@id` is `ref`. */
export const byRef = (records: ReadonlyArray<AnyRecord>, ref: string): AnyRecord | undefined =>
  records.find((record) => record.typeName === "shape" && (record.type === "frame" ? record.props?.name === ref : record.meta?.ref === ref));
