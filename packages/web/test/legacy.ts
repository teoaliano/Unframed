/**
 * Browser-seam helpers for spec 11: the app over an output folder copied from the old-format
 * samples, opening `everything` unless told otherwise. Tests change the copy, never the samples.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { copySamples } from "../../engine/test/legacySamples.ts";
import { videoJobs, type VideoJobs } from "../../engine/test/videoStub.ts";
import { expect } from "./fixtures.ts";
import { startTextGeneration, type TextGeneration } from "./texting.ts";

export interface LegacyApp extends TextGeneration {
  /** The video endpoints: every job the samples hold stays in flight unless a test scripts it. */
  readonly videos: VideoJobs;
  readonly outputDir: string;
  readonly folder: (project: string) => string;
  dispose(): Promise<void>;
}

/**
 * An engine with the generation stubs over a copy of the samples. `prepare` changes the copy
 * before the engine boots. The remembered project is `project`, so the app opens it first.
 */
export const startLegacyApp = async (options: { readonly project?: string; readonly prepare?: (outputDir: string) => Promise<void> } = {}): Promise<LegacyApp> => {
  const dataDir = await mkdtemp(join(tmpdir(), "unframed-legacy-web-"));
  const outputDir = join(dataDir, "output");
  await copySamples(outputDir);
  // The boot sweep must write nothing, or every write prunes the old done and failed records
  // before an import reads them: the other project's job, long unreachable, would be given
  // up on, and every other pending render stays in flight (below).
  const jobsPath = join(outputDir, "jobs.json");
  const jobs = JSON.parse(await readFile(jobsPath, "utf8")) as Array<{ project: string }>;
  await writeFile(jobsPath, `${JSON.stringify(jobs.filter((job) => job.project !== "other-project"), null, 2)}\n`);
  await options.prepare?.(outputDir);
  const videos = videoJobs();
  const generation = await startTextGeneration({ dataDir, extra: [videos.handler] });
  await (await generation.engine.rpc()).call("preferences.set", { key: "project.active", value: options.project ?? "everything" });
  return {
    ...generation,
    videos,
    outputDir,
    folder: (project) => join(outputDir, project),
    dispose: async () => {
      await generation.engine.dispose();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
};

export const IMPORTING = "Importing from the old Unframed…";

export const reportDialog = (page: Page): Locator => page.getByTestId("import-report");

/** The canvas of `project`, once it is on screen. */
export const canvasOf = (page: Page, project: string): Locator => page.locator(`[data-canvas-project="${project}"] .tl-canvas`);

/** Opens the app and waits for `project`'s canvas. */
export const openImported = async (page: Page, engine: TestEngine, project = "everything"): Promise<void> => {
  await page.goto(engine.origin);
  await expect(canvasOf(page, project)).toBeVisible({ timeout: 20_000 });
};
