/**
 * Motion renders (spec 09): a composition to an MP4 with HyperFrames' producer and the
 * person's own Chrome, in the engine. Renders are an in-memory map, not a durable store: a
 * render is free local compute on files still on disk, so one lost to a restart costs a
 * click. Each joins spec 03's run registry, so its placeholder is resolved like any
 * non-durable run.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMarkerOf, type RenderStatus } from "@unframed/contracts";
import { compositionSize, nextRef, NO_CHROME_RENDER_MESSAGE, placeResults } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { getIndexAbove, type IndexKey } from "@tldraw/utils";
import type { Applied, CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import { errorText, logError, logInfo } from "../log.ts";
import { clearChange, fillFor, isShape, PLACEHOLDER_WIDTH, videoPlaceholder, type LandedClip, type RunOutcome } from "../runs/placeholders.ts";
import { shapePageBoxes } from "../runs/shapeBounds.ts";
import { ensureLibrary, placeRenderOutput } from "./artifactStore.ts";
import type { TestRenderer } from "./chrome.ts";

export const COMPOSITION_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html?$/;
const TITLE_MAX = 120;

/** One render's work handed to the producer: everything it reads and where it writes. */
export interface ProducerRun {
  /** The project folder, which the composition's relative names resolve against. */
  readonly folder: string;
  readonly entry: string;
  readonly outputPath: string;
  /** `{ unframedDials }` when the render has tuned values, else `null`. */
  readonly variables: Record<string, unknown> | null;
  readonly chromePath: string;
  readonly onProgress: (progress: number, message: string) => void;
}

/** The seam the test hook replaces: the producer and the Chrome search. */
export interface RenderBackend {
  readonly findChrome: () => Promise<string | undefined>;
  readonly produce: (run: ProducerRun) => Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long each stage of the `ok` stub takes, so a poll every 700 ms sees them. */
const STUB_STAGE_MS = 450;

/**
 * `UNFRAMED_TEST_RENDERER=ok`: 25, 50 and 75 with their messages, then a small fixture MP4,
 * and a last message naming the variables it received. `fail` fails at once.
 */
export const stubBackend = (mode: "ok" | "fail", fixture: string): RenderBackend => ({
  findChrome: async () => "stub-chrome",
  produce: async (run) => {
    if (mode === "fail") {
      await sleep(STUB_STAGE_MS);
      throw new Error("Stub render failed.");
    }
    for (const [progress, message] of [
      [25, "Capturing frames"],
      [50, "Encoding"],
      [75, "Finishing"],
    ] as const) {
      run.onProgress(progress, message);
      await sleep(STUB_STAGE_MS);
    }
    if (existsSync(fixture)) await copyFile(fixture, run.outputPath);
    else await writeFile(run.outputPath, Buffer.from("stub mp4"));
    run.onProgress(75, `variables: ${run.variables === null ? "null" : JSON.stringify(run.variables)}`);
  },
});

/** The producer's own logging, silenced except for errors. */
const quietLogger = {
  error: (message: string) => logError(`render: ${message}`),
  warn: () => {},
  info: () => {},
  debug: () => {},
  isLevelEnabled: (level: string) => level === "error",
};

/** HyperFrames' producer, imported only when a render starts: 30 fps, standard quality, MP4. */
export const producerBackend = (findChrome: () => Promise<string | undefined>): RenderBackend => ({
  findChrome,
  produce: async (run) => {
    const producer = await import("@hyperframes/producer");
    const engine = await import("@hyperframes/engine");
    const job = producer.createRenderJob({
      fps: 30,
      quality: "standard",
      format: "mp4",
      entryFile: run.entry,
      logger: quietLogger,
      producerConfig: engine.resolveConfig({ chromePath: run.chromePath, fps: 30, quality: "standard" }),
      ...(run.variables === null ? {} : { variables: run.variables }),
    });
    await producer.executeRenderJob(job, run.folder, run.outputPath, (current, message) => run.onProgress(current.progress, message));
    if (job.status === "failed") throw new Error(job.error ?? "The render failed.");
  },
});

export class RenderRefused extends Error {
  readonly code: "bad_request" | "not_found" | "internal";
  constructor(code: "bad_request" | "not_found" | "internal", message: string) {
    super(message);
    this.code = code;
  }
}

export interface RendererDeps {
  readonly backend: RenderBackend;
  /** The project folder, or `undefined` when there is none. */
  readonly folder: (project: string) => Promise<string | undefined>;
  readonly slug: (project: string) => string;
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly apply: (project: string, change: CanvasChange, origin: ChangeOrigin) => Promise<Applied>;
  /** Spec 03's run registry. */
  readonly track: (runId: string, project: string) => { settle: (outcome: RunOutcome<LandedClip>) => void; forget: () => void };
  /** Spec 01's open-project registry: answers the closer's unregister function. */
  readonly registerCloser: (project: string, close: () => Promise<void>) => Promise<unknown>;
}

interface Record_ extends RenderStatus {
  readonly project: string;
}

const origin = (id: string): ChangeOrigin => ({ kind: "server", id: `run:${id}` });

const topIndex = (records: ReadonlyArray<TLRecord>, pageId: string): IndexKey | null =>
  records
    .filter((record) => isShape(record) && (record as unknown as { parentId: string }).parentId === pageId)
    .map((record) => (record as unknown as { index: IndexKey }).index)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .at(-1) ?? null;

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export class Renderer {
  private readonly renders = new Map<string, Record_>();
  /** Projects whose closer is registered with the open-project registry. */
  private readonly tracked = new Set<string>();
  private readonly deps: RendererDeps;

  constructor(deps: RendererDeps) {
    this.deps = deps;
  }

  private update(id: string, change: Partial<RenderStatus>): void {
    const current = this.renders.get(id);
    if (!current) return;
    const progress = change.progress === undefined ? current.progress : Math.max(current.progress, Math.min(change.progress, change.status === "done" ? 100 : 99));
    this.renders.set(id, { ...current, ...change, progress });
  }

  private async track(project: string): Promise<void> {
    if (this.tracked.has(project)) return;
    this.tracked.add(project);
    await this.deps.registerCloser(project, async () => {
      this.tracked.delete(project);
      for (const [id, render] of this.renders) if (render.project === project) this.renders.delete(id);
    });
  }

  async start(input: { project: string; file: string; title?: string | undefined; dials?: unknown; shapeId: string }): Promise<{ id: string; status: "queued"; placeholder: string }> {
    if (!COMPOSITION_FILE.test(input.file)) throw new RenderRefused("bad_request", "Which composition? Pass its .html file name.");
    const project = this.deps.slug(input.project);
    const folder = await this.deps.folder(input.project);
    if (folder === undefined) throw new RenderRefused("not_found", `There is no project named "${project}".`);
    const path = join(folder, input.file);
    if (!(await stat(path).then((info) => info.isFile(), () => false))) throw new RenderRefused("not_found", `No file ${input.file} in this project.`);
    try {
      await ensureLibrary(folder);
    } catch (error) {
      throw new RenderRefused("internal", `Could not prepare the motion library: ${errorText(error)}`);
    }
    const title = (input.title ?? "").slice(0, TITLE_MAX);
    const dials = isPlainObject(input.dials) ? input.dials : null;
    const startedAt = Date.now();
    const id = `r-${startedAt.toString(36)}-${[...randomBytes(6)].map((byte) => (byte % 36).toString(36)).join("")}`;

    const size = compositionSize(await readFile(path, "utf8").catch(() => ""));
    const records = await this.deps.read(project);
    const pageId = records.find((record) => record.typeName === "page")?.id ?? "page:page";
    const boxes = shapePageBoxes(records);
    const anchor = boxes.find((entry) => entry.id === input.shapeId)?.box ?? { x: 0, y: 0, w: 0, h: 0 };
    const height = (PLACEHOLDER_WIDTH * size.h) / size.w;
    const [at] = placeResults(anchor, [{ w: PLACEHOLDER_WIDTH, h: height }], boxes.map((entry) => entry.box));
    const placeholder = videoPlaceholder({
      at: at!,
      size: { w: PLACEHOLDER_WIDTH, h: height },
      index: getIndexAbove(topIndex(records, pageId)),
      parentId: pageId,
      ref: nextRef(records as ReadonlyArray<{ typeName: string; type?: string; meta?: unknown }>),
      marker: { runId: id, runIndex: 1, startedAt },
    });

    const run = this.deps.track(id, project);
    try {
      await this.deps.apply(project, { put: [placeholder], remove: [] }, origin(id));
    } catch (error) {
      run.forget();
      throw new RenderRefused("internal", `Could not start the render: ${errorText(error)}`);
    }
    await this.track(project);
    this.renders.set(id, { id, project, file: input.file, status: "queued", progress: 0, message: "", output: null, error: null });
    void this.run({ id, project, folder, file: input.file, title, dials, placeholder: placeholder.id, size, run });
    return { id, status: "queued", placeholder: placeholder.id };
  }

  private async run(job: {
    id: string;
    project: string;
    folder: string;
    file: string;
    title: string;
    dials: Record<string, unknown> | null;
    placeholder: string;
    size: { w: number; h: number };
    run: { settle: (outcome: RunOutcome<LandedClip>) => void };
  }): Promise<void> {
    let outcome: RunOutcome<LandedClip>;
    const temp = await mkdtemp(join(tmpdir(), "unframed-render-"));
    try {
      this.update(job.id, { status: "rendering" });
      const chromePath = await this.deps.backend.findChrome();
      if (chromePath === undefined) throw new Error(NO_CHROME_RENDER_MESSAGE);
      const outputPath = join(temp, "render.mp4");
      await this.deps.backend.produce({
        folder: job.folder,
        entry: job.file,
        outputPath,
        variables: job.dials !== null && Object.keys(job.dials).length > 0 ? { unframedDials: job.dials } : null,
        chromePath,
        onProgress: (progress, message) => this.update(job.id, { progress, message }),
      });
      const placed = await placeRenderOutput(job.folder, { from: outputPath, of: job.file, title: job.title, dials: job.dials });
      outcome = { ok: true, landed: { kind: "clip", file: placed.file, bytes: placed.bytes, w: job.size.w, h: job.size.h } };
    } catch (error) {
      outcome = { ok: false, error: errorText(error) };
    } finally {
      await rm(temp, { recursive: true, force: true }).catch(() => undefined);
    }
    job.run.settle(outcome);

    try {
      const shape = (await this.deps.read(job.project)).find((record) => record.id === job.placeholder);
      if (isShape(shape) && runMarkerOf(shape)?.runId === job.id) {
        await this.deps.apply(job.project, outcome.ok ? fillFor(shape, outcome.landed) : clearChange(shape), origin(job.id));
      } else if (outcome.ok) {
        logInfo(`${job.id}: output 1 landed after its placeholder was deleted → ${join(job.folder, outcome.landed.file)}`);
      }
    } catch (error) {
      logError(`${job.id}: could not update the render's placeholder: ${errorText(error)}`);
    }
    if (outcome.ok) this.update(job.id, { status: "done", progress: 100, output: outcome.landed.file });
    else {
      logError(`${job.id}: render failed: ${outcome.error}`);
      this.update(job.id, { status: "failed", error: outcome.error });
    }
  }

  status(project: string, id: string): RenderStatus {
    const render = this.renders.get(id);
    if (!render || render.project !== this.deps.slug(project)) throw new RenderRefused("not_found", "No such render.");
    const { project: _project, ...status } = render;
    return status;
  }
}
