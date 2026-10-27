/**
 * `node scripts/motionStills.ts <outDir> [composition.html ...]`: renders motion compositions
 * to MP4 with the HyperFrames producer the engine depends on, then extracts stills at 0 s,
 * 1 s and the last frame. Local compute only: no model call, nothing paid.
 *
 * Without composition paths it takes the motions in `assets/fixtures/*.json` (the scripted
 * agent's `motion_write` HTML). Run it once per HyperFrames version on the same machine, each
 * time into a new `outDir`, then compare the stills. Pixel difference for one still:
 * `ffmpeg -i a/0s.png -i b/0s.png -lavfi psnr -f null -`.
 *
 * Chrome comes from `UNFRAMED_CHROME_PATH`, else Google Chrome in /Applications. Needs
 * `ffmpeg` and `ffprobe` on PATH.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { injectTags } from "../packages/domain/src/artifacts/artifactRules.ts";
import { dialsBridgeSource } from "../packages/domain/src/artifacts/dials.ts";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const engineManifest = JSON.parse(await readFile(join(root, "packages/engine/package.json"), "utf8")) as { dependencies: Record<string, string> };
const hyperframesVersion = engineManifest.dependencies["@hyperframes/producer"];

const FPS = 30;
const LAST_FRAME_OFFSET = 1 / FPS;

const [outArg, ...compositionArgs] = process.argv.slice(2);
if (outArg === undefined) {
  process.stderr.write("Usage: node scripts/motionStills.ts <outDir> [composition.html ...]\n");
  process.exit(1);
}
const outDir = resolve(outArg);

const chromePath = process.env.UNFRAMED_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(chromePath)) {
  process.stderr.write(`No Chrome at ${chromePath}. Set UNFRAMED_CHROME_PATH.\n`);
  process.exit(1);
}

// The packages' exports maps do not offer these paths to require, so they are read from the install.
const installed = (path: string): string => join(root, "packages/engine/node_modules", path);
const producer = await import(pathToFileURL(installed("@hyperframes/producer/dist/index.js")).href);
const engine = await import(pathToFileURL(installed("@hyperframes/engine/dist/index.js")).href);
const runtimeSource = installed("@hyperframes/core/dist/hyperframe.runtime.iife.js");
const gsapSource = installed("gsap/dist/gsap.min.js");

/** Motion HTML from the fixtures: any string value that holds a composition root. */
const fixtureCompositions = async (): Promise<Array<{ name: string; html: string }>> => {
  const dir = join(root, "assets/fixtures");
  const found: Array<{ name: string; html: string }> = [];
  const walk = (name: string, value: unknown, path: string[]): void => {
    if (typeof value === "string" && value.includes("data-composition-id")) found.push({ name: `${name}-${path.join("-") || "html"}`, html: value });
    else if (value !== null && typeof value === "object") for (const [key, child] of Object.entries(value)) walk(name, child, [...path, key]);
  };
  for (const file of (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    walk(parse(file).name, JSON.parse(await readFile(join(dir, file), "utf8")), []);
  }
  return found;
};

const compositions: Array<{ name: string; html: string }> =
  compositionArgs.length > 0
    ? await Promise.all(compositionArgs.map(async (path) => ({ name: parse(path).name, html: await readFile(resolve(path), "utf8") })))
    : await fixtureCompositions();

const quietLogger = {
  error: (message: string) => process.stderr.write(`render: ${message}\n`),
  warn: () => {},
  info: () => {},
  debug: () => {},
  isLevelEnabled: (level: string) => level === "error",
};

const probeDuration = async (file: string): Promise<number> => {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.trim());
};

const still = async (video: string, seconds: number, out: string): Promise<void> => {
  await run("ffmpeg", ["-y", "-v", "error", "-ss", String(Math.max(0, seconds)), "-i", video, "-frames:v", "1", out]);
};

await mkdir(outDir, { recursive: true });
const summary: Array<Record<string, unknown>> = [];

for (const composition of compositions) {
  const dir = join(outDir, composition.name);
  const folder = join(dir, "project");
  const entry = `1-${composition.name}.html`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  // The library the app copies beside a motion (no player: a render does not use it), and the tags it injects.
  await writeFile(join(folder, entry), injectTags(composition.html, "motion"), "utf8");
  await copyFile(runtimeSource, join(folder, "hyperframes-runtime.js"));
  await copyFile(gsapSource, join(folder, "gsap.js"));
  await writeFile(join(folder, "unframed-dials.js"), dialsBridgeSource(), "utf8");

  const output = join(dir, "render.mp4");
  const started = Date.now();
  const job = producer.createRenderJob({
    fps: FPS,
    quality: "standard",
    format: "mp4",
    entryFile: entry,
    logger: quietLogger,
    producerConfig: engine.resolveConfig({ chromePath, fps: FPS, quality: "standard", staticFrameDedup: false }),
  });
  await producer.executeRenderJob(job, folder, output, (current: { progress: number }, message: string) => {
    process.stdout.write(`  ${composition.name} ${current.progress}% ${message}\n`);
  });
  if (job.status === "failed") throw new Error(`${composition.name}: ${job.error ?? "The render failed."}`);

  const duration = await probeDuration(output);
  const last = Math.max(0, duration - LAST_FRAME_OFFSET);
  const stills = { "0s.png": 0, "1s.png": 1, "last.png": last };
  for (const [name, seconds] of Object.entries(stills)) await still(output, seconds, join(dir, name));

  summary.push({
    composition: composition.name,
    hyperframes: hyperframesVersion,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    duration,
    bytes: (await stat(output)).size,
    stills: Object.keys(stills),
  });
  process.stdout.write(`${composition.name}: ${duration.toFixed(2)} s, stills in ${dir}\n`);
}

await writeFile(join(outDir, "manifest.json"), `${JSON.stringify({ hyperframes: hyperframesVersion, chromePath: basename(chromePath), renders: summary }, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${join(outDir, "manifest.json")} for @hyperframes ${hyperframesVersion}.\n`);
