import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** The summary lines of every edit version the project holds, one list per version, oldest first by file name. */
export const editSummaries = async (engine: TestEngine, project = "default"): Promise<string[][]> => {
  const names = (await readdir(join(engine.dataDir, "output", project))).filter((name) => name.endsWith(".json")).sort();
  const found: string[][] = [];
  for (const name of names) {
    const sidecar = JSON.parse(await readFile(join(engine.dataDir, "output", project, name), "utf8")) as { source?: string; edits?: string[] };
    if (sidecar.source === "edit") found.push(sidecar.edits ?? []);
  }
  return found;
};

/** The first tween of the composition, as the frame's own timeline holds it now. */
export const tweenPlace = async (page: Page): Promise<{ start: number; duration: number }> => {
  for (const frame of page.frames()) {
    if (!new URL(frame.url()).pathname.endsWith("-intro.html")) continue;
    const place = await frame.evaluate(() => {
      const timelines = (window as unknown as { __timelines?: { main: { getChildren(a: boolean, b: boolean, c: boolean): Array<{ startTime(): number; duration(): number }> } } }).__timelines;
      const tween = timelines?.main.getChildren(true, true, false)[0];
      return tween ? { start: tween.startTime(), duration: tween.duration() } : undefined;
    });
    if (place !== undefined) return place;
  }
  throw new Error("no composition frame");
};
