import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  isBareFileName,
  projectFileMarker,
  ResultRecipe,
  unframedError,
  UnframedError,
  type ImageRunRequest,
  type ImageSidecar,
  type RecipeRef,
  type ResultMeta,
  type RunEvent,
  type RunMarker,
} from "@unframed/contracts";
import { imageDimensions, nextRef, placeResults, projectSlug } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { getIndicesAbove, type IndexKey } from "@tldraw/utils";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { CanvasRooms, type CanvasChange, type ChangeOrigin, type RoomAccess } from "../canvas/rooms.ts";
import { errorText, logError, logInfo } from "../log.ts";
import { MediaStore } from "../media/mediaStore.ts";
import { generateImage } from "../openRouter/images.ts";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";
import { extensionFor, mimeForFile, referenceName, resultBase, writeResultFile, writeSidecar } from "./resultFiles.ts";
import { shapePageBounds } from "./shapeBounds.ts";

export const NO_KEY_MESSAGE = "No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).";
export const EMPTY_PROMPT_MESSAGE = "Prompt is empty. Select a prompt, or type an instruction.";
export const OUTPUT_COUNT_MESSAGE = "A run makes between 1 and 10 images.";
export const LINK_MESSAGE = "A video link must start with https://.";
export const RECIPE_GONE_MESSAGE = "This result's recipe is no longer in the project folder.";
export const referenceMissingMessage = (file: string) => `Reference file not found in this project: ${file}`;

const MAX_OUTPUTS = 10;
const PLACEHOLDER_WIDTH = 320;
/** The run registry keeps this many runs, for resolving markers. */
const REGISTRY_SIZE = 200;

/** Image runs: acknowledgement, placeholders, upstream calls, files, sidecars, fills, events. */
export class Runs extends Context.Service<
  Runs,
  {
    readonly image: (request: ImageRunRequest) => Effect.Effect<{ runId: string; batchId: string; placeholders: string[] }, UnframedError>;
    readonly subscribe: (project: string) => Stream.Stream<RunEvent>;
    readonly recipe: (project: string, shapeId: string) => Effect.Effect<ResultRecipe, UnframedError>;
  }
>()("unframed/engine/Runs") {}

/** What landed for one output: enough to fill its placeholder, now or after an undo. */
interface Landed {
  readonly file: string;
  readonly sidecar: string;
  readonly cost: number | null;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly mime: string;
  readonly bytes: number;
}

type Outcome = { readonly ok: true; readonly landed: Landed } | { readonly ok: false; readonly error: string };

interface RunRecord {
  live: boolean;
  readonly outputs: Map<number, Outcome>;
}

type Shape = TLRecord & { type: string; props: Record<string, unknown>; meta: Record<string, unknown> };

const isShape = (record: TLRecord | undefined): record is Shape => record?.typeName === "shape";

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const unframedOf = (shape: Shape): Record<string, unknown> => {
  const value = shape.meta.unframed;
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
};

export const markerOf = (shape: Shape): RunMarker | undefined => {
  const run = unframedOf(shape).run;
  return typeof field(run, "runId") === "string" ? (run as RunMarker) : undefined;
};

const resultOf = (shape: Shape): ResultMeta | undefined => {
  const result = unframedOf(shape).result;
  return typeof field(result, "model") === "string" ? (result as ResultMeta) : undefined;
};

const runOrigin = (runId: string): ChangeOrigin => ({ kind: "server", id: `run:${runId}` });

/** The height of an image placeholder: from the requested `W:H` ratio or exact size, else square. */
const placeholderHeight = (params: ImageRunRequest["params"]): number => {
  const ratio = params.size !== undefined ? /^(\d+)x(\d+)$/.exec(params.size) : params.aspect_ratio !== undefined ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(params.aspect_ratio) : null;
  const w = ratio ? Number(ratio[1]) : 0;
  const h = ratio ? Number(ratio[2]) : 0;
  return w > 0 && h > 0 ? (PLACEHOLDER_WIDTH * h) / w : PLACEHOLDER_WIDTH;
};

/** Only set params are sent; `quality: 'auto'` and `background: 'auto'` are not. */
const sentParams = (params: ImageRunRequest["params"]): Record<string, string> => {
  const sent: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "string" || value === "") continue;
    if ((key === "quality" || key === "background") && value === "auto") continue;
    sent[key] = value;
  }
  return sent;
};

/** The change that fills a placeholder: the file as its asset, the file's aspect at its width, the sidecar, no marker. */
const fillChange = (shape: Shape, landed: Landed): CanvasChange => {
  const assetId = `asset:${randomUUID()}`;
  const width = typeof shape.props.w === "number" ? shape.props.w : PLACEHOLDER_WIDTH;
  const height = landed.width && landed.height ? (width * landed.height) / landed.width : typeof shape.props.h === "number" ? shape.props.h : width;
  const { run: _run, ...unframed } = unframedOf(shape);
  const result = resultOf(shape);
  const asset = {
    id: assetId,
    typeName: "asset",
    type: "image",
    props: {
      w: landed.width ?? Math.round(width),
      h: landed.height ?? Math.round(height),
      name: landed.file,
      isAnimated: landed.mime === "image/gif",
      mimeType: landed.mime,
      src: projectFileMarker(landed.file),
      ...(landed.bytes > 0 ? { fileSize: landed.bytes } : {}),
    },
    meta: {},
  } as unknown as TLRecord;
  const filled = {
    ...shape,
    props: { ...shape.props, assetId, h: height, crop: null },
    meta: { ...shape.meta, unframed: { ...unframed, ...(result ? { result: { ...result, sidecar: landed.sidecar, cost: landed.cost } } : {}) } },
  } as unknown as TLRecord;
  return { put: [asset, filled], remove: [] };
};

/** The change that settles a marker whose work did not land: the marker goes, and an empty shape goes too. */
const clearChange = (shape: Shape): CanvasChange => {
  if (shape.props.assetId === null || shape.props.assetId === undefined) return { put: [], remove: [shape.id] };
  const { run: _run, ...unframed } = unframedOf(shape);
  return { put: [{ ...shape, meta: { ...shape.meta, unframed } } as unknown as TLRecord], remove: [] };
};

const plainRecipe = Schema.decodeUnknownOption(ResultRecipe);

export const runsLayer = Layer.effect(
  Runs,
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    const rooms = yield* CanvasRooms;
    const media = yield* MediaStore;
    const config = yield* Config;
    const events = yield* PubSub.unbounded<{ readonly project: string; readonly event: RunEvent }>();
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);

    const registry = new Map<string, RunRecord>();
    const remember = (runId: string, record: RunRecord) => {
      registry.set(runId, record);
      while (registry.size > REGISTRY_SIZE) registry.delete(registry.keys().next().value!);
    };

    const publish = (project: string, event: RunEvent) => runPromise(PubSub.publish(events, { project, event }));

    const projectFolder = (project: string) =>
      Effect.flatMap(
        Effect.promise(() => media.folder(project)),
        (folder) => (folder === undefined ? Effect.fail(unframedError("not_found", `There is no project named "${projectSlug(project)}".`)) : Effect.succeed(folder)),
      );

    /** Resolves one marker: leave a live run's, fill a landed output's, clear the rest. */
    const resolve = (shape: Shape, room: RoomAccess) => {
      const marker = markerOf(shape);
      // Spec 04 resolves durable markers against its render job store.
      if (!marker || marker.durable) return;
      const run = registry.get(marker.runId);
      const outcome = run?.outputs.get(marker.runIndex);
      if (run && !outcome) return;
      const change = outcome?.ok ? fillChange(shape, outcome.landed) : clearChange(shape);
      room.change(change, runOrigin(marker.runId));
    };

    yield* rooms.afterOpen((_project, room) => {
      for (const record of room.read()) if (isShape(record) && markerOf(record)) resolve(record, room);
    });

    yield* rooms.afterCommit((_project, change, room) => {
      for (const id of change.created) {
        const record = change.records.get(id);
        if (!isShape(record)) continue;
        const marker = markerOf(record);
        if (!marker || change.origin.id === `run:${marker.runId}`) continue;
        const current = room.get(id);
        if (isShape(current)) resolve(current, room);
      }
    });

    const validate = (request: ImageRunRequest, folder: string) =>
      Effect.gen(function* () {
        if ((yield* settings.read).key === "") return yield* unframedError("unavailable", NO_KEY_MESSAGE);
        if (request.outputs.length < 1 || request.outputs.length > MAX_OUTPUTS) return yield* unframedError("bad_request", OUTPUT_COUNT_MESSAGE);
        if (request.outputs.every((output) => output.prompt.trim() === "")) return yield* unframedError("bad_request", EMPTY_PROMPT_MESSAGE);
        for (const ref of request.outputs.flatMap((output) => output.references)) {
          if ("url" in ref) {
            if (!ref.url.startsWith("https://")) return yield* unframedError("bad_request", LINK_MESSAGE);
            continue;
          }
          const name = referenceName(ref.file);
          const present = yield* Effect.promise(() =>
            stat(join(folder, name)).then(
              (info) => info.isFile(),
              () => false,
            ),
          );
          if (!present || !isBareFileName(name)) return yield* unframedError("not_found", referenceMissingMessage(name));
        }
      });

    /** Each project file becomes a data URL at this boundary; links are sent as given. */
    const inline = async (folder: string, refs: ReadonlyArray<RecipeRef>) =>
      Promise.all(
        refs.map(async (ref) => {
          const url = "url" in ref ? ref.url : `data:${mimeForFile(ref.file)};base64,${(await readFile(join(folder, referenceName(ref.file)))).toString("base64")}`;
          return ref.kind === "video" ? { type: "video_url", video_url: { url } } : { type: "image_url", image_url: { url } };
        }),
      );

    const image = (request: ImageRunRequest) =>
      Effect.gen(function* () {
        const folder = yield* projectFolder(request.project);
        const project = projectSlug(request.project);
        yield* validate(request, folder);
        const current = yield* settings.read;
        const model = request.model ?? current.imageModel;
        const startedAt = Date.now();
        const runId = `run-${startedAt}-${randomUUID().slice(0, 8)}`;
        const batchId = request.batchId ?? `b-${startedAt}`;
        const runCount = request.outputs.length;

        const records = yield* rooms.read(request.project);
        let of: ResultRecipe["of"];
        if (request.of) {
          const source = records.find((record) => record.id === request.of!.shapeId);
          const sidecar = isShape(source) ? resultOf(source)?.sidecar : undefined;
          if (typeof sidecar === "string") of = { sidecar, action: request.of.action };
        }

        const page = records.find((record) => record.typeName === "page");
        const pageId = page?.id ?? "page:page";
        const height = placeholderHeight(request.params);
        const sizes = request.outputs.map(() => ({ w: PLACEHOLDER_WIDTH, h: height }));
        const positions = placeResults(request.anchor, sizes, shapePageBounds(records, new Set(request.sources)));
        const topIndex = records
          .filter((record) => isShape(record) && (record as unknown as { parentId: string }).parentId === pageId)
          .map((record) => (record as unknown as { index: IndexKey }).index)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          .at(-1);
        const indices = getIndicesAbove(topIndex ?? null, runCount);
        const minted: Array<{ typeName: string; type: string; meta: { ref: string } }> = [];
        const placeholders = request.outputs.map((_output, index) => {
          const ref = nextRef([...records, ...minted]);
          minted.push({ typeName: "shape", type: "image", meta: { ref } });
          const marker: RunMarker = { runId, runIndex: index + 1, startedAt };
          const result: ResultMeta = {
            sidecar: null,
            medium: "image",
            model,
            batchId,
            runIndex: index + 1,
            runCount,
            cost: null,
            sources: [...request.sources],
          };
          return {
            id: `shape:${randomUUID()}`,
            typeName: "shape",
            type: "image",
            x: positions[index]!.x,
            y: positions[index]!.y,
            rotation: 0,
            index: indices[index]!,
            parentId: pageId,
            isLocked: false,
            opacity: 1,
            props: { w: PLACEHOLDER_WIDTH, h: height, playing: true, url: "", assetId: null, crop: null, flipX: false, flipY: false, altText: "" },
            meta: { ref, unframed: { run: marker, result } },
          } as unknown as TLRecord;
        });

        const run: RunRecord = { live: true, outputs: new Map() };
        remember(runId, run);
        yield* rooms.apply(request.project, { put: placeholders, remove: [] }, runOrigin(runId)).pipe(
          Effect.tapError(() => Effect.sync(() => registry.delete(runId))),
        );
        yield* PubSub.publish(events, { project, event: { type: "started", runId, batchId, count: runCount } });

        const recipeFor = (references: ReadonlyArray<RecipeRef>): ResultRecipe => ({
          medium: "image",
          model,
          params: { ...request.params } as Record<string, string>,
          selectionPrompt: request.selectionPrompt,
          instruction: request.instruction,
          references: [...references],
          sources: [...request.sources],
          ...(of === undefined ? {} : { of }),
        });

        const land = async (index: number, bytes: Buffer, mediaType: string | undefined, cost: number | null): Promise<Landed> => {
          const output = request.outputs[index]!;
          const runIndex = index + 1;
          const ext = extensionFor(mediaType, request.params.output_format);
          let base: string;
          try {
            base = await writeResultFile(folder, resultBase({ startedAt, prompt: output.prompt, runIndex, runCount }), ext, bytes);
          } catch (error) {
            throw new Error(`Generated the image but failed to write it: ${errorText(error)}`);
          }
          const file = `${base}.${ext}`;
          const dimensions = imageDimensions(bytes);
          const references = output.references;
          const sidecar: ImageSidecar = {
            prompt: output.prompt,
            model,
            ...(request.params.resolution === undefined ? {} : { resolution: request.params.resolution }),
            ...(request.params.quality === undefined ? {} : { quality: request.params.quality }),
            ...(request.params.aspect_ratio === undefined ? {} : { aspect_ratio: request.params.aspect_ratio }),
            ...(request.params.output_format === undefined ? {} : { output_format: request.params.output_format }),
            background: request.params.background ?? null,
            ...(request.params.size === undefined ? {} : { size: request.params.size }),
            referenceCount: references.length,
            references: { images: references.filter((ref) => ref.kind === "image").length, videos: references.filter((ref) => ref.kind === "video").length },
            batchId,
            runIndex,
            runCount,
            cost,
            createdAt: new Date().toISOString(),
            file,
            recipe: recipeFor(references),
          };
          await writeSidecar(folder, base, sidecar).catch((error: unknown) => logError(`could not write the sidecar of ${file}: ${errorText(error)}`));
          const path = join(folder, file);
          logInfo(`generated → ${path}${cost === null ? "" : `  ($${cost.toFixed(4)})`}`);
          return {
            file,
            sidecar: `${base}.json`,
            cost,
            width: dimensions?.w,
            height: dimensions?.h,
            mime: mediaType?.split(";")[0]?.trim() || mimeForFile(file),
            bytes: bytes.length,
          };
        };

        const settle = async (index: number): Promise<{ ok: boolean; error?: string; orphaned?: boolean }> => {
          const output = request.outputs[index]!;
          const runIndex = index + 1;
          const shapeId = placeholders[index]!.id;
          const body: Record<string, unknown> = { model, prompt: output.prompt, ...sentParams(request.params) };
          let outcome: Outcome;
          try {
            if (output.references.length > 0) body.input_references = await inline(folder, output.references);
            const answer = await generateImage(config.openRouterOrigin, current.key, body);
            outcome = answer.ok ? { ok: true, landed: await land(index, answer.bytes, answer.mediaType, answer.cost) } : { ok: false, error: answer.error };
          } catch (error) {
            outcome = { ok: false, error: errorText(error) };
          }
          run.outputs.set(runIndex, outcome);
          const change = await runPromise(
            Effect.map(rooms.read(request.project), (now) => {
              const shape = now.find((record) => record.id === shapeId);
              if (!isShape(shape)) return undefined;
              return outcome.ok ? fillChange(shape, outcome.landed) : markerOf(shape)?.runId === runId ? clearChange(shape) : undefined;
            }),
          ).catch(() => undefined);
          if (change) {
            await runPromise(rooms.apply(request.project, change, runOrigin(runId))).catch((error: unknown) =>
              logError(`${runId}: could not update output ${runIndex} on the canvas: ${errorText(error)}`),
            );
          }
          if (outcome.ok) {
            const orphaned = change === undefined;
            if (orphaned) logInfo(`${runId}: output ${runIndex} landed after its placeholder was deleted → ${join(folder, outcome.landed.file)}`);
            await publish(project, { type: "output", runId, runIndex, ok: true, shapeId, file: outcome.landed.file, cost: outcome.landed.cost });
            return { ok: true, orphaned };
          }
          logError(`${runId}: output ${runIndex} failed: ${outcome.error}`);
          await publish(project, { type: "output", runId, runIndex, ok: false, error: outcome.error });
          return { ok: false, error: outcome.error };
        };

        void Promise.all(request.outputs.map((_output, index) => settle(index)))
          .then(async (settled) => {
            run.live = false;
            const errors = [...new Set(settled.flatMap((each) => (each.error === undefined ? [] : [each.error])))];
            await publish(project, {
              type: "finished",
              runId,
              succeeded: settled.filter((each) => each.ok).length,
              failed: settled.filter((each) => !each.ok).length,
              errors,
              orphaned: settled.filter((each) => each.orphaned).length,
            });
          })
          .catch((error: unknown) => logError(`${runId}: ${errorText(error)}`));

        return { runId, batchId, placeholders: placeholders.map((placeholder) => placeholder.id as string) };
      });

    const subscribe = (project: string) =>
      Stream.unwrap(
        Effect.map(PubSub.subscribe(events), (subscription) =>
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((item) => item.project === projectSlug(project)),
            Stream.map((item) => item.event),
          ),
        ),
      );

    const recipe = (project: string, shapeId: string) =>
      Effect.gen(function* () {
        const folder = yield* projectFolder(project);
        const records = yield* rooms.read(project);
        const shape = records.find((record) => record.id === shapeId);
        const result = isShape(shape) ? resultOf(shape) : undefined;
        if (result?.recipe) return result.recipe;
        const sidecar = result?.sidecar;
        if (typeof sidecar !== "string" || !isBareFileName(sidecar)) return yield* unframedError("not_found", RECIPE_GONE_MESSAGE);
        const text = yield* Effect.promise(() => readFile(join(folder, sidecar), "utf8").catch(() => undefined));
        let parsed: unknown;
        try {
          parsed = text === undefined ? undefined : JSON.parse(text);
        } catch {
          parsed = undefined;
        }
        const decoded = plainRecipe(field(parsed, "recipe"));
        if (decoded._tag === "None") return yield* unframedError("not_found", RECIPE_GONE_MESSAGE);
        return decoded.value;
      });

    return Runs.of({ image, subscribe, recipe });
  }),
);
