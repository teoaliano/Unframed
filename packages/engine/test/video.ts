/** Engine-seam helpers for render jobs: an engine with a key, scripted video endpoints, a project to render in. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResultRecipe, VideoStartRequest } from "@unframed/contracts";
import { KEY, pngBytes, until } from "./generation.ts";
import { makeTempDir, startEngine, type EngineOptions, type StubHandler, type TestEngine } from "./harness.ts";
import { routes } from "./openRouterStub.ts";
import type { TestRpcClient } from "./rpcClient.ts";
import { videoJobs, type StatusAnswer, type VideoJobs, type VideoRequest } from "./videoStub.ts";

export { KEY, pngBytes, until };

export const MODEL = "bytedance/seedance-2.0";

export interface Rendering {
  readonly engine: TestEngine;
  readonly rpc: TestRpcClient;
  readonly jobs: VideoJobs;
  /** The engine's temp folder (`TMPDIR`), where share copies live. */
  readonly tmp: string;
  /** The project folder of `board`. */
  readonly folder: string;
  /** The output folder, where `jobs.json` lives. */
  readonly output: string;
  readonly stubOrigin: string;
}

export interface RenderingOptions extends EngineOptions {
  readonly key?: boolean;
  readonly extra?: StubHandler[];
  /** Records written to `jobs.json` before the engine boots. */
  readonly seed?: unknown;
  /** Written as `jobs.json` verbatim before boot. */
  readonly seedText?: string;
  /** Files put into the project folder of `board` before boot. */
  readonly files?: Record<string, Buffer>;
  /** How job status requests are answered from boot on, so the boot sweep sees it. */
  readonly status?: (id: string, request: VideoRequest) => StatusAnswer | Promise<StatusAnswer>;
}

/**
 * An engine with a key (unless `key: false`), the test canvas methods on, the loopback
 * tunnel, a project named `board` and its own temp folder. The sweep runs rarely unless
 * `UNFRAMED_TEST_SWEEP_MS` is set.
 */
export const startRendering = async (options: RenderingOptions = {}): Promise<Rendering> => {
  const jobs = videoJobs();
  if (options.status) jobs.status(options.status);
  const dataDir = options.dataDir ?? (await makeTempDir());
  const tmp = await makeTempDir("unframed-tmp-");
  const output = join(dataDir, "output");
  const folder = join(output, "board");
  await mkdir(folder, { recursive: true });
  for (const [name, bytes] of Object.entries(options.files ?? {})) await writeFile(join(folder, name), bytes);
  if (options.seedText !== undefined) await writeFile(join(output, "jobs.json"), options.seedText);
  else if (options.seed !== undefined) await writeFile(join(output, "jobs.json"), `${JSON.stringify(options.seed, null, 2)}\n`);
  const engine = await startEngine({
    dotenv: options.key === false ? "" : `OPENROUTER_API_KEY=${KEY}\n`,
    ...options,
    dataDir,
    env: { UNFRAMED_TEST_CANVAS: "1", UNFRAMED_TEST_TUNNEL: "loopback", UNFRAMED_TEST_SWEEP_MS: "3600000", TMPDIR: tmp, ...options.env },
    stub: routes(jobs.handler, ...(options.extra ?? [])),
  });
  const rpc = await engine.rpc();
  return { engine, rpc, jobs, tmp, folder, output, stubOrigin: engine.stub!.origin };
};

export const recipe = (overrides: Partial<ResultRecipe> = {}): ResultRecipe => ({
  medium: "video",
  model: MODEL,
  params: { inputMode: "reference", duration: 5, shareLocalVideos: true },
  selectionPrompt: "a fox running",
  instruction: "",
  references: [],
  sources: ["shape:prompt"],
  ...overrides,
});

export const startRequest = (overrides: Partial<VideoStartRequest> = {}): VideoStartRequest => ({
  project: "board",
  prompt: "a fox running",
  input_references: [],
  frame_images: [],
  model: MODEL,
  duration: 5,
  landing: { x: 400, y: 20, w: 320, h: 180 },
  recipe: recipe(),
  ...overrides,
});

export const readJobs = async (rendering: Rendering): Promise<any[]> => JSON.parse(await readFile(join(rendering.output, "jobs.json"), "utf8"));

export const jobsText = (rendering: Rendering): Promise<string> => readFile(join(rendering.output, "jobs.json"), "utf8");

export const shareCopies = async (rendering: Rendering): Promise<string[]> => (await readdir(rendering.tmp)).filter((name) => name.startsWith("unframed-share-"));

export const roomShapes = async (rendering: Rendering): Promise<any[]> =>
  ((await rendering.rpc.call("testCanvas.read", { project: "board" })).records as any[]).filter((record) => record.typeName === "shape");

export const roomRecord = async (rendering: Rendering, id: string): Promise<any> =>
  ((await rendering.rpc.call("testCanvas.read", { project: "board" })).records as any[]).find((record) => record.id === id);

/** Polls `check` until it answers something, for asynchronous engine work. */
export const eventually = async <T>(check: () => Promise<T | undefined | false>, what: string, timeoutMs = 10_000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/** A completed status naming a download on the stub that was asked, so it works before the stub's origin is known. */
export const completedHere = (id: string, request: VideoRequest, extra: Record<string, unknown> = {}): StatusAnswer => ({
  kind: "data",
  data: { id, status: "completed", unsigned_urls: [`http://${request.headers.host}/files/${id}.mp4`], usage: { cost: 0.42 }, ...extra },
});

/** A pending record as an older build or a crash left it. */
export const pendingRecord = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  project: "board",
  params: { prompt: "a seeded render", model: MODEL, duration: 5, resolution: null, size: null },
  startedAt: Date.now() - 60_000,
  status: "pending",
  refs: { images: 0, videos: 0, frames: 0 },
  ...overrides,
});
