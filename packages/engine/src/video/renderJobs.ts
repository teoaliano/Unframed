/**
 * Render jobs (spec 04): starting a paid video render, asking about it, collecting its clip
 * into the project folder and onto the canvas, failing it, forgetting it, and the sweep that
 * lands renders with no tab open. The job store is the durable record; a render
 * placeholder's run marker is the second copy.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  isBareFileName,
  projectFileMarker,
  ResultRecipe,
  resultMetaOf,
  runMarkerOf,
  runOriginId,
  unframedError,
  UnframedError,
  unframedMetaOf,
  type ErrorCode,
  type RenderParams,
  type ResultMeta,
  type VideoPollAnswer,
  type VideoSidecar,
  type VideoStartRequest,
} from "@unframed/contracts";
import {
  classifyVideoStatus,
  GENERATION_FAILED,
  givenUp,
  inputModeOf,
  nextRef,
  NO_KEY_MESSAGE,
  pendingFor,
  projectSlug,
  type FailPendingOptions,
  type RenderJob,
} from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { getIndicesAbove, type IndexKey } from "@tldraw/utils";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { CanvasRooms, type CanvasChange, type ChangeOrigin } from "../canvas/rooms.ts";
import { errorText, logError, logInfo } from "../log.ts";
import { MediaStore } from "../media/mediaStore.ts";
import { clipUrlOf, createVideoJob, downloadClip, readVideoStatus, type CreateFailureReason } from "../openRouter/videos.ts";
import { isShape, type Shape } from "../runs/placeholders.ts";
import { fileStamp, mimeForFile, referenceName, writeResultFile, writeSidecar } from "../runs/resultFiles.ts";
import { referenceMissingMessage } from "../runs/runs.ts";
import { shapePageBoxes } from "../runs/shapeBounds.ts";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";
import { ShareLinks } from "../share/shareLinks.ts";
import { Shutdown } from "../shutdown.ts";
import { failPendingJobsIn, JobStoreError } from "./jobLifecycle.ts";
import { persistJob, readJobsLenient } from "./jobStore.ts";

export const EMPTY_VIDEO_PROMPT = "Prompt is empty. Select at least one prompt, or type an instruction.";
export const LOCAL_CLIP_MESSAGE =
  'Video generation only accepts a reference video as a public https:// link, and this one is a local file. Tick "Share via temporary link while generating" in the Generate tray, or use the clip in a text run instead, which does take local clips.';
export const TUNNEL_MESSAGE = "Could not share the clip: the temporary link did not come up. The tunnel service is best-effort, so trying again usually works";

const SWEEP_MS = 30_000;
const TUNNEL_ATTEMPTS = 3;
const TUNNEL_PROBE_MS = 30_000;
/** A render placeholder or result the engine makes itself: as wide as spec 03's placeholders, 16:9. */
const RESULT_SIZE = { w: 320, h: 180 };
const RESULT_GAP = 40;

export type StartReason = "no_key" | "invalid" | "local_clip" | "share_failed" | CreateFailureReason;

/** A failure of a video RPC: spec 01's error shape, told apart by `details.reason`. */
const refusal = (reason: StartReason, code: ErrorCode, message: string) => unframedError(code, message, { reason });

export class RenderJobs extends Context.Service<
  RenderJobs,
  {
    readonly start: (request: VideoStartRequest) => Effect.Effect<{ jobId: string; status: string; shapeId: string }, UnframedError>;
    readonly poll: (request: { jobId: string; project: string; params: RenderParams }) => Effect.Effect<VideoPollAnswer, UnframedError>;
    readonly forget: (project: string, jobId: string) => Effect.Effect<Record<string, never>, UnframedError>;
    /** The job record's recipe for a render placeholder whose sidecar is not written yet. */
    readonly placeholderRecipe: (project: string, shapeId: string) => Effect.Effect<ResultRecipe | undefined, UnframedError>;
    /**
     * Spec 10: fails the pending jobs of one project (a slug), or with these ids, or all, in
     * the current output folder's store, read strictly. Each failed job loses its share
     * links and its placeholder says why, as every other failure path does. Answers how many.
     */
    readonly failPending: (options: FailPendingOptions) => Effect.Effect<number, JobStoreError>;
  }
>()("unframed/engine/RenderJobs") {}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const numberOrUndefined = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const decodeRecipe = Schema.decodeUnknownOption(ResultRecipe);

const recipeOf = (value: unknown): ResultRecipe | undefined => {
  const decoded = decodeRecipe(value);
  return decoded._tag === "Some" ? decoded.value : undefined;
};

/** The recipe a job the store never learned about gets: what its marker's params say. */
const recipeFromParams = (params: RenderParams): ResultRecipe => ({
  medium: "video",
  model: params.model,
  params: {
    ...(params.duration === null ? {} : { duration: params.duration }),
    ...(params.resolution === null ? {} : { resolution: params.resolution }),
    ...(params.size === null ? {} : { size: params.size }),
  },
  selectionPrompt: params.prompt,
  instruction: "",
  references: [],
  sources: [],
});

const fileUrl = (project: string, file: string) => `/api/file/${encodeURIComponent(project)}/${encodeURIComponent(file)}`;

const origin = (jobId: string): ChangeOrigin => ({ kind: "server", id: runOriginId(jobId) });

const markedBy = (records: ReadonlyArray<TLRecord>, jobId: string): Shape | undefined =>
  records.find((record): record is Shape => isShape(record) && runMarkerOf(record)?.runId === jobId);

/** What landed for a render: the clip and its sidecar. */
interface LandedClip {
  readonly file: string;
  readonly sidecar: string;
  readonly cost: number | null;
  readonly bytes: number;
}

/** A video asset for a collected clip. Its size is unknown here: the web takes it from the clip the first time it loads it. */
const clipAsset = (landed: LandedClip): TLRecord =>
  ({
    id: `asset:${randomUUID()}`,
    typeName: "asset",
    type: "video",
    props: { w: 0, h: 0, name: landed.file, isAnimated: true, mimeType: "video/mp4", src: projectFileMarker(landed.file), ...(landed.bytes > 0 ? { fileSize: landed.bytes } : {}) },
    meta: {},
  }) as unknown as TLRecord;

/** Fills a render placeholder by spec 03's lifecycle: the clip, the sidecar and cost in its result meta, no marker. Position and size are kept. */
const fillChange = (shape: Shape, landed: LandedClip): CanvasChange => {
  const asset = clipAsset(landed);
  const { run: _run, runError: _error, ...unframed } = unframedMetaOf(shape);
  const result = resultMetaOf(shape);
  return {
    put: [
      asset,
      {
        ...shape,
        props: { ...shape.props, assetId: asset.id },
        meta: { ...shape.meta, unframed: { ...unframed, ...(result ? { result: { ...result, sidecar: landed.sidecar, cost: landed.cost } } : {}) } },
      } as unknown as TLRecord,
    ],
    remove: [],
  };
};

/** Spec 03's failure step for a durable placeholder: it stays, says why, and loses its marker. */
const failChange = (shape: Shape, error: string): CanvasChange => {
  const { run: _run, ...unframed } = unframedMetaOf(shape);
  return { put: [{ ...shape, meta: { ...shape.meta, unframed: { ...unframed, runError: error } } } as unknown as TLRecord], remove: [] };
};

const topIndexOf = (records: ReadonlyArray<TLRecord>, pageId: string): IndexKey | null =>
  records
    .filter((record) => isShape(record) && (record as unknown as { parentId: string }).parentId === pageId)
    .map((record) => (record as unknown as { index: IndexKey }).index)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .at(-1) ?? null;

/** An empty video shape at `at` carrying `meta`: a render placeholder, or the shape a result fills. */
const videoShape = (records: ReadonlyArray<TLRecord>, id: string, at: { x: number; y: number; w: number; h: number }, unframed: Record<string, unknown>): TLRecord => {
  const pageId = records.find((record) => record.typeName === "page")?.id ?? "page:page";
  return {
    id,
    typeName: "shape",
    type: "video",
    x: at.x,
    y: at.y,
    rotation: 0,
    index: getIndicesAbove(topIndexOf(records, pageId), 1)[0]!,
    parentId: pageId,
    isLocked: false,
    opacity: 1,
    props: { w: at.w, h: at.h, time: 0, playing: false, autoplay: false, url: "", assetId: null, altText: "" },
    meta: { ref: nextRef(records as ReadonlyArray<{ typeName: string; type?: string; meta?: unknown }>), unframed },
  } as unknown as TLRecord;
};

const resultMeta = (model: string, startedAt: number, sources: ReadonlyArray<string>): ResultMeta => ({
  sidecar: null,
  medium: "video",
  model,
  batchId: `b-${startedAt}`,
  runIndex: 1,
  runCount: 1,
  cost: null,
  sources: [...sources],
});

export const renderJobsLayer = Layer.effect(
  RenderJobs,
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    const rooms = yield* CanvasRooms;
    const media = yield* MediaStore;
    const config = yield* Config;
    const shares = yield* ShareLinks;
    const shutdown = yield* Shutdown;
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);

    const outputDir = () => runPromise(settings.outputDir);
    const currentKey = async () => (await runPromise(settings.read)).key;

    /** Job id to the share tokens minted for it; revoked when the job becomes done or failed. */
    const sharesByJob = new Map<string, string[]>();
    /** What each job this process started sent, for a job the store never learned about. */
    const refsByJob = new Map<string, RenderJob["refs"]>();
    /** Jobs being downloaded right now, by the poll or the sweep: never twice. */
    const collecting = new Set<string>();

    const revokeShares = async (jobId: string) => {
      const tokens = sharesByJob.get(jobId) ?? [];
      sharesByJob.delete(jobId);
      for (const token of tokens) await shares.revoke(token);
    };

    const readRoom = (project: string) => runPromise(rooms.read(project)).catch(() => undefined);
    const applyRoom = (project: string, change: CanvasChange, jobId: string) =>
      runPromise(rooms.apply(project, change, origin(jobId))).then(
        () => true,
        (error: unknown) => {
          logError(`${jobId}: could not change the canvas: ${errorText(error)}`);
          return false;
        },
      );

    /** What failing a job does besides its record: its shares go, and its placeholder says why and loses its marker. */
    const markFailed = async (job: RenderJob, error: string) => {
      await revokeShares(job.id);
      const project = job.project ?? "";
      const records = await readRoom(project);
      const shape = records && markedBy(records, job.id);
      if (shape) await applyRoom(project, failChange(shape, error), job.id);
    };

    const failJob = async (record: RenderJob, error: string) => {
      await revokeShares(record.id);
      const dir = await outputDir();
      const failed = await persistJob(dir, record.id, {
        status: "failed",
        error,
        resolvedAt: Date.now(),
        ...(record.project === undefined ? {} : { project: record.project }),
        ...(record.params === undefined ? {} : { params: record.params }),
      });
      await markFailed(failed, error);
      return failed;
    };

    /** The only path from a completed job to files, a record and a canvas result. */
    const collect = async (record: RenderJob, data: unknown, key: string): Promise<RenderJob> => {
      const url = clipUrlOf(data);
      if (url === undefined) throw new Error("Job completed without a video URL.");
      const bytes = await downloadClip(url, key);
      const dir = await outputDir();
      // A rename may have landed during the download (spec 10 repoints pending records).
      const stored = (await readJobsLenient(dir)).find((job) => job.id === record.id);
      // Resolved during the download (spec 10 fails the records of a deleted project): its outcome stands.
      if (stored !== undefined && stored.status !== "pending") return stored;
      const current = stored ?? record;
      const project = current.project ?? "";
      // A project whose folder is gone (moved with the output folder, or removed by hand)
      // still gets its paid clip: the folder is made again, and no room is touched (step 7).
      // Failing here instead would retry, and download the clip again, on every sweep.
      let folder = await media.folder(project);
      const hadFolder = folder !== undefined;
      if (folder === undefined) {
        if (projectSlug(project) === "") throw new Error(`There is no project named "${project}".`);
        folder = join(dir, projectSlug(project));
        await mkdir(folder, { recursive: true });
      }
      const params = current.params ?? record.params;
      const base = await writeResultFile(folder, `${fileStamp(Date.now())}-${projectSlug(params.prompt) || "video"}`, "mp4", bytes);
      const file = `${base}.mp4`;
      const recipe = recipeOf(current.recipe) ?? recipeOf(record.recipe) ?? recipeFromParams(params);
      const usage = field(data, "usage");
      const cost = numberOrUndefined(field(usage, "cost")) ?? numberOrUndefined(field(data, "cost")) ?? null;
      const aspect = recipe.params.aspect_ratio;
      const audio = recipe.params.generate_audio;
      const sidecar: VideoSidecar = {
        kind: "video",
        prompt: params.prompt,
        model: params.model,
        duration: params.duration,
        resolution: params.resolution,
        size: params.size,
        aspect_ratio: typeof aspect === "string" ? aspect : null,
        generate_audio: typeof audio === "boolean" ? audio : null,
        inputMode: inputModeOf(recipe.params),
        references: current.refs ?? record.refs ?? null,
        usage: typeof usage === "object" && usage !== null ? usage : null,
        cost,
        createdAt: new Date().toISOString(),
        file,
        jobId: record.id,
        recipe,
      };
      await writeSidecar(folder, base, sidecar).catch((error: unknown) => logError(`sidecar not written: ${errorText(error)}`));
      const done = await persistJob(dir, record.id, {
        project,
        status: "done",
        savedPath: join(folder, file),
        cost,
        resolvedAt: Date.now(),
        ...(record.params === undefined ? {} : { params: record.params }),
        ...(record.refs === undefined ? {} : { refs: record.refs }),
      });
      await revokeShares(record.id);

      const landed: LandedClip = { file, sidecar: `${base}.json`, cost, bytes: bytes.length };
      const records = hadFolder ? await readRoom(project) : undefined;
      if (records) {
        const shape = markedBy(records, record.id);
        if (shape) await applyRoom(project, fillChange(shape, landed), record.id);
        else if (done.landing?.shapeId === undefined && done.forgotten !== true) {
          // A record from before placeholders: the result lands at its spot, else right of everything.
          const boxes = shapePageBoxes(records).map((each) => each.box);
          const at = done.landing ?? {
            x: boxes.length === 0 ? 0 : Math.max(...boxes.map((box) => box.x + box.w)) + RESULT_GAP,
            y: boxes.length === 0 ? 0 : Math.min(...boxes.map((box) => box.y)),
            ...RESULT_SIZE,
          };
          const shape = videoShape(records, `shape:${randomUUID()}`, at, { result: resultMeta(params.model, done.startedAt, recipe.sources) });
          const filled = fillChange(shape as unknown as Shape, landed);
          await applyRoom(project, filled, record.id);
        } else logInfo(`${record.id}: output 1 landed after its placeholder was deleted → ${join(folder, file)}`);
      }
      return done;
    };

    const completedAnswer = (record: RenderJob): VideoPollAnswer => {
      const savedPath = record.savedPath ?? "";
      return { status: "completed", cost: record.cost ?? null, savedPath, url: fileUrl(record.project ?? "", basename(savedPath)) };
    };

    const findJob = async (id: string) => (await readJobsLenient(await outputDir())).find((job) => job.id === id);

    // video.start

    /** A local clip is a video reference that is not an `https://` link; only one naming a project file can be shared. */
    type Inlined = { readonly entries: Record<string, unknown>[]; readonly local: Array<{ readonly index: number; readonly url: string; readonly file: string | undefined }> };

    const start = async (request: VideoStartRequest) => {
      const key = await currentKey();
      if (key === "") throw refusal("no_key", "unavailable", NO_KEY_MESSAGE);
      const project = projectSlug(request.project);
      const folder = await media.folder(project);
      if (folder === undefined) throw refusal("invalid", "not_found", `There is no project named "${project}".`);

      const projectFile = async (url: string): Promise<string | undefined> => {
        if (!url.startsWith("project-file:")) return undefined;
        const name = referenceName(url.slice("project-file:".length));
        const present = isBareFileName(name) && (await stat(join(folder, name)).then((info) => info.isFile(), () => false));
        if (!present) throw refusal("invalid", "not_found", referenceMissingMessage(name));
        return name;
      };

      // Image markers become data URLs at this boundary; a local clip stays a file until it is shared.
      const inline = async (value: unknown, frames: boolean): Promise<Inlined> => {
        const entries: Record<string, unknown>[] = [];
        const local: Inlined["local"] = [];
        for (const entry of Array.isArray(value) ? value : []) {
          const video = field(entry, "type") === "video_url";
          const url = field(field(entry, video ? "video_url" : "image_url"), "url");
          if (typeof url !== "string") continue;
          const name = await projectFile(url);
          const frameType = field(entry, "frame_type");
          if (video && !frames) {
            if (!url.startsWith("https://")) local.push({ index: entries.length, url, file: name });
            entries.push({ type: "video_url", video_url: { url } });
            continue;
          }
          const sent = name === undefined ? url : `data:${mimeForFile(name)};base64,${(await readFile(join(folder, name))).toString("base64")}`;
          entries.push({ type: "image_url", image_url: { url: sent }, ...(frames && typeof frameType === "string" ? { frame_type: frameType } : {}) });
        }
        return { entries, local };
      };

      const references = await inline(request.input_references, false);
      const frames = await inline(request.frame_images, true);
      if (request.prompt.trim() === "") throw refusal("invalid", "bad_request", EMPTY_VIDEO_PROMPT);
      if (references.local.length > 0 && request.shareLocalVideos !== true) throw refusal("local_clip", "bad_request", LOCAL_CLIP_MESSAGE);

      const tokens: string[] = [];
      const revokeMinted = async () => {
        for (const token of tokens) await shares.revoke(token);
      };
      if (references.local.length > 0) {
        try {
          for (const clip of references.local) {
            if (clip.file === undefined) throw new Error(`${clip.url} is not a file in this project.`);
            tokens.push(await shares.mint(join(folder, clip.file)));
          }
          let base: string | undefined;
          for (let attempt = 1; attempt <= TUNNEL_ATTEMPTS && base === undefined; attempt++) {
            if (attempt > 1) await shares.closeTunnel();
            const candidate = await shares.ensureTunnel().catch(() => undefined);
            if (candidate !== undefined && (await shares.waitUntilPublic(`${candidate}/share/${tokens[0]}`, TUNNEL_PROBE_MS))) base = candidate;
            else logInfo(`tunnel attempt ${attempt} never came up; retrying`);
          }
          if (base === undefined) {
            await revokeMinted();
            throw refusal("share_failed", "upstream", TUNNEL_MESSAGE);
          }
          references.local.forEach((clip, index) => {
            references.entries[clip.index] = { type: "video_url", video_url: { url: `${base}/share/${tokens[index]}` } };
          });
        } catch (error) {
          if (error instanceof UnframedError) throw error;
          await revokeMinted();
          throw refusal("share_failed", "upstream", `Could not share the clip: ${errorText(error)}`);
        }
      }

      const model = request.model ?? (await runPromise(settings.read)).videoModel;
      const payload: Record<string, unknown> = { model, prompt: request.prompt };
      if (request.duration) payload.duration = request.duration;
      if (request.size) payload.size = request.size;
      if (request.resolution) payload.resolution = request.resolution;
      if (request.aspect_ratio) payload.aspect_ratio = request.aspect_ratio;
      if (request.generate_audio !== undefined && request.generate_audio !== null) payload.generate_audio = request.generate_audio;
      if (references.entries.length > 0) payload.input_references = references.entries;
      if (frames.entries.length > 0) payload.frame_images = frames.entries;
      const refs = {
        images: references.entries.filter((entry) => entry.type === "image_url").length,
        videos: references.entries.filter((entry) => entry.type === "video_url").length,
        frames: frames.entries.length,
      };
      logInfo(`video job →  ${model}  (sent ${refs.images} image, ${refs.videos} video refs, ${refs.frames} frames)`);

      const created = await createVideoJob(config.openRouterOrigin, key, payload);
      if (!created.ok) {
        await revokeMinted();
        throw refusal(created.reason, "upstream", created.message);
      }
      const jobId = created.id;
      sharesByJob.set(jobId, tokens);
      refsByJob.set(jobId, refs);

      // Written before the call answers: a crash one moment later still leaves the render recoverable.
      const startedAt = Date.now();
      const shapeId = `shape:${randomUUID()}`;
      const params: RenderParams = {
        prompt: request.prompt,
        model,
        duration: request.duration ?? null,
        resolution: request.resolution ?? null,
        size: request.size ?? null,
      };
      const dir = await outputDir();
      await persistJob(dir, jobId, {
        project,
        params,
        startedAt,
        status: "pending",
        refs,
        landing: { ...request.landing, shapeId },
        recipe: request.recipe,
      }).catch((error: unknown) => logError(`job store write failed: ${errorText(error)}`));

      const records = (await readRoom(project)) ?? [];
      const placeholder = videoShape(records, shapeId, request.landing, {
        run: { runId: jobId, runIndex: 1, startedAt, durable: { params } },
        result: resultMeta(model, startedAt, request.recipe.sources),
      });
      if (!(await applyRoom(project, { put: [placeholder], remove: [] }, jobId))) {
        // No placeholder: the collector puts the result at the landing spot instead.
        await persistJob(dir, jobId, { landing: request.landing }).catch((error: unknown) => logError(`job store write failed: ${errorText(error)}`));
      }
      return { jobId, status: created.status ?? "pending", shapeId };
    };

    // video.poll

    const poll = async ({ jobId, project, params }: { jobId: string; project: string; params: RenderParams }): Promise<VideoPollAnswer> => {
      // Answering from the store needs no key: that is how a tab learns its render ended after the key was removed.
      const stored = await findJob(jobId);
      if (stored?.status === "done") return completedAnswer(stored);
      if (stored?.status === "failed") return { status: "failed", error: stored.error ?? GENERATION_FAILED };
      const key = await currentKey();
      if (key === "") throw refusal("no_key", "unavailable", "No OpenRouter key yet.");
      const read = await readVideoStatus(config.openRouterOrigin, key, jobId);
      if (!read.answered) throw read.network ? refusal("unreachable", "upstream", `Could not reach OpenRouter: ${read.cause}`) : refusal("upstream", "upstream", read.message);
      const built: RenderJob = stored ?? { id: jobId, project: projectSlug(project), params, startedAt: Date.now(), status: "pending", refs: refsByJob.get(jobId) ?? null };
      const status = classifyVideoStatus(read.data);
      if (status.kind === "failed") {
        try {
          await failJob(built, status.message);
        } catch (error) {
          throw refusal("upstream", "upstream", `The render failed upstream (${status.message}), but recording that failed too: ${errorText(error)}`);
        }
        return { status: "failed", error: status.message };
      }
      if (status.kind === "rendering") return { status: status.status, progress: status.progress };
      if (collecting.has(jobId)) return { status: "pending", progress: null };
      collecting.add(jobId);
      try {
        // Read the store again: the first read was before a network round trip.
        const fresh = await findJob(jobId);
        if (fresh?.status === "done") return completedAnswer(fresh);
        if (fresh?.status === "failed") return { status: "failed", error: fresh.error ?? GENERATION_FAILED };
        const landed = await collect(fresh ?? built, read.data, key);
        return landed.status === "done" ? completedAnswer(landed) : { status: "failed", error: landed.error ?? GENERATION_FAILED };
      } catch (error) {
        throw refusal("upstream", "upstream", errorText(error));
      } finally {
        collecting.delete(jobId);
      }
    };

    // video.forget

    const forget = async (projectName: string, jobId: string) => {
      const project = projectSlug(projectName);
      const dir = await outputDir();
      if ((await readJobsLenient(dir)).some((job) => job.id === jobId)) await persistJob(dir, jobId, { forgotten: true });
      const records = await readRoom(project);
      const shape = records && markedBy(records, jobId);
      if (shape) await applyRoom(project, { put: [], remove: [shape.id] }, jobId);
      return {};
    };

    // The sweep: lands renders with no tab open.

    const visit = async (job: RenderJob, key: string, dir: string) => {
      const read = await readVideoStatus(config.openRouterOrigin, key, job.id);
      if (!read.answered) {
        if (givenUp(job, Date.now())) {
          const why = read.message || "no answer";
          await failJob(job, `Stopped checking after 24 hours with no answer about this render. The last attempt said: ${why}`);
          logInfo(`video job ${job.id} gave up: unreachable for 24h (${why})`);
        } else if (job.unreachableSince === undefined) await persistJob(dir, job.id, { unreachableSince: Date.now() });
        return;
      }
      // Any answer, even "queued", resets the clock.
      if (job.unreachableSince !== undefined) await persistJob(dir, job.id, { unreachableSince: undefined });
      const status = classifyVideoStatus(read.data);
      if (status.kind === "failed") {
        await failJob(job, status.message);
        return;
      }
      if (status.kind === "rendering" || collecting.has(job.id)) return;
      collecting.add(job.id);
      try {
        const fresh = (await readJobsLenient(dir)).find((each) => each.id === job.id);
        if (fresh && fresh.status !== "pending") return;
        const done = await collect(fresh ?? job, read.data, key);
        if (done.status === "done") logInfo(`video job ${job.id} collected by the sweep → ${done.savedPath}`);
      } catch (error) {
        logError(`sweep could not collect ${job.id}: ${errorText(error)}`);
      } finally {
        collecting.delete(job.id);
      }
    };

    let sweeping = false;
    const sweep = async () => {
      if (sweeping) return;
      sweeping = true;
      try {
        const key = await currentKey();
        if (key === "") return;
        const dir = await outputDir();
        // One at a time, never in parallel; one job's failure never skips the jobs behind it.
        for (const job of pendingFor(await readJobsLenient(dir))) {
          try {
            await visit(job, key, dir);
          } catch (error) {
            logError(`sweep failed for ${job.id}: ${errorText(error)}`);
          }
        }
      } catch (error) {
        logError(`sweep failed: ${errorText(error)}`);
      } finally {
        sweeping = false;
      }
    };

    const timer = setInterval(() => void sweep(), config.testSweepMs ?? SWEEP_MS);
    timer.unref();
    void sweep();
    yield* shutdown.register("render sweep", Effect.sync(() => clearInterval(timer)));

    // Durable markers are resolved against the store when a room opens and when an undo restores one.

    const resolveDurable = async (project: string, ids: ReadonlyArray<string>) => {
      const jobs = await readJobsLenient(await outputDir());
      const records = await readRoom(project);
      if (!records) return;
      for (const id of ids) {
        const shape = records.find((record): record is Shape => record.id === id && isShape(record));
        const marker = shape ? runMarkerOf(shape) : undefined;
        if (!shape || !marker?.durable) continue;
        const job = jobs.find((each) => each.id === marker.runId);
        // Pending: the sweep and the tab's poll land it. No record: the poll can still collect it from the marker.
        if (job?.status === "failed") await applyRoom(project, failChange(shape, job.error ?? GENERATION_FAILED), job.id);
        else if (job?.status === "done" && job.savedPath !== undefined) {
          const file = basename(job.savedPath);
          const size = await stat(job.savedPath).then(
            (info) => info.size,
            () => 0,
          );
          await applyRoom(project, fillChange(shape, { file, sidecar: `${file.replace(/\.[^.]+$/, "")}.json`, cost: job.cost ?? null, bytes: size }), job.id);
        }
      }
    };

    const durableIds = (records: ReadonlyArray<TLRecord>) => records.filter((record) => isShape(record) && runMarkerOf(record)?.durable !== undefined).map((record) => record.id);

    yield* rooms.afterOpen((project, room) => {
      const ids = durableIds(room.read());
      if (ids.length > 0) void resolveDurable(project, ids).catch((error: unknown) => logError(`canvas ${project}: ${errorText(error)}`));
    });

    yield* rooms.afterCommit((project, change) => {
      const ids = change.created.filter((id) => {
        const record = change.records.get(id);
        const marker = isShape(record) ? runMarkerOf(record) : undefined;
        return marker?.durable !== undefined && change.origin.id !== runOriginId(marker.runId);
      });
      if (ids.length > 0) void resolveDurable(project, ids).catch((error: unknown) => logError(`canvas ${project}: ${errorText(error)}`));
    });

    const placeholderRecipe = async (projectName: string, shapeId: string) => {
      const project = projectSlug(projectName);
      const records = (await readRoom(project)) ?? [];
      const shape = records.find((record) => record.id === shapeId);
      const marker = shape && isShape(shape) ? runMarkerOf(shape) : undefined;
      const jobs = await readJobsLenient(await outputDir());
      const job = jobs.find((each) => (marker ? each.id === marker.runId : each.landing?.shapeId === shapeId));
      return job ? recipeOf(job.recipe) : undefined;
    };

    // Records first, in one strict write: once it lands the renders are failed, and nothing after it may say otherwise.
    const failPending = async (options: FailPendingOptions) => {
      const failed = await failPendingJobsIn(await outputDir(), options);
      for (const job of failed) {
        await markFailed(job, options.error).catch((error: unknown) => logError(`${job.id}: ${errorText(error)}`));
      }
      return failed.length;
    };

    const attempt = <A>(run: () => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (error) => (error instanceof UnframedError ? error : unframedError("internal", `Something went wrong: ${errorText(error)}`)),
      });

    return RenderJobs.of({
      start: (request) => attempt(() => start(request)),
      poll: (request) => attempt(() => poll(request)),
      forget: (project, jobId) => attempt(() => forget(project, jobId)),
      placeholderRecipe: (project, shapeId) => attempt(() => placeholderRecipe(project, shapeId)),
      failPending: (options) => Effect.tryPromise({ try: () => failPending(options), catch: (error) => new JobStoreError({ reason: errorText(error) }) }),
    });
  }),
);
