import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isBareFileName,
  resultMetaOf,
  runMarkerOf,
  runOriginId,
  unframedError,
  UnframedError,
  type ImageRunRequest,
  type ImageSidecar,
  type RecipeRef,
  type ResultRecipe,
  type RunEvent,
  type TextCompleteAnswer,
  type TextCompleteRequest,
  type TextRunRequest,
} from "@unframed/contracts";
import { imageDimensions, NO_KEY_MESSAGE, nextRef, placeResults, projectSlug, sidecarFileName, type Box } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { getIndicesAbove, type IndexKey } from "@tldraw/utils";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { CanvasRooms, type ChangeOrigin, type RoomAccess } from "../canvas/rooms.ts";
import { errorText, logError, logInfo } from "../log.ts";
import { MediaStore } from "../media/mediaStore.ts";
import { generateImage, imageRequestBody } from "../openRouter/images.ts";
import type { ReferencePart } from "../openRouter/text.ts";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";
import {
  clearChange,
  fillFor,
  imagePlaceholder,
  isShape,
  PLACEHOLDER_WIDTH,
  placeholderHeight,
  type Landed,
  type LandedClip,
  type LandedText,
  type RunOutcome,
  type Shape,
} from "./placeholders.ts";
import { makeTextRuns } from "./textRuns.ts";
import { extensionFor, mimeForFile, referenceName, resultBase, writeLoneSidecar, writeResultFile, writeSidecar } from "./resultFiles.ts";
import { shapePageBoxes } from "./shapeBounds.ts";
import { readResultSidecar } from "./sidecars.ts";

export const EMPTY_PROMPT_MESSAGE = "Prompt is empty. Select a prompt, or type an instruction.";
export const OUTPUT_COUNT_MESSAGE = "A run makes between 1 and 10 images.";
export const LINK_MESSAGE = "A video link must start with https://.";
export const RECIPE_GONE_MESSAGE = "This result's recipe is no longer in the project folder.";
export const referenceMissingMessage = (file: string) => `Reference file not found in this project: ${file}`;

const MAX_OUTPUTS = 10;
/** The run registry keeps this many runs, for resolving markers. */
const REGISTRY_SIZE = 200;

/** Image runs: acknowledgement, placeholders, upstream calls, files, sidecars, fills, events. */
export class Runs extends Context.Service<
  Runs,
  {
    readonly image: (request: ImageRunRequest) => Effect.Effect<{ runId: string; batchId: string; placeholders: string[] }, UnframedError>;
    /** Spec 05: answers once the run's empty text result is in the room; the answer fills it later. */
    readonly text: (request: TextRunRequest) => Effect.Effect<{ runId: string; batchId: string; placeholders: string[] }, UnframedError>;
    /** Spec 05: one text call that lands nothing. */
    readonly complete: (request: TextCompleteRequest) => Effect.Effect<TextCompleteAnswer, UnframedError>;
    readonly subscribe: (project: string) => Stream.Stream<RunEvent>;
    readonly recipe: (project: string, shapeId: string) => Effect.Effect<ResultRecipe, UnframedError>;
    /** Copies a result's sidecar and the files its recipe names from `from` into `project`, beside `file`. */
    readonly copyRecipe: (project: string, from: string, sidecar: string, file: string) => Effect.Effect<{ sidecar: string }, UnframedError>;
    /** Spec 10: how many runs are still generating, in one project (a name, slugged) or in all. */
    readonly liveRuns: (project?: string) => Effect.Effect<number>;
    /**
     * Spec 09: a motion render joins the run registry as a live run of its project, so its
     * placeholder is resolved like any non-durable run and spec 10's checks count it.
     */
    readonly track: (runId: string, project: string) => { settle: (outcome: RunOutcome<LandedClip>) => void; forget: () => void };
  }
>()("unframed/engine/Runs") {}

type Outcome = RunOutcome<Landed | LandedText | LandedClip>;

interface RunRecord {
  live: boolean;
  /** The project slug. */
  readonly project: string;
  readonly outputs: Map<number, Outcome>;
}

const runOrigin = (runId: string): ChangeOrigin => ({ kind: "server", id: runOriginId(runId) });

const contains = (box: Box, point: { readonly x: number; readonly y: number }) =>
  point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;

/**
 * What the row of results must stay clear of. The engine has no text layout, so a prompt's
 * size is an estimate; a prompt among the run's sources that starts inside the anchor is
 * inside the selection, and only the estimate could put it in the row's way.
 */
const obstacles = (records: ReadonlyArray<TLRecord>, request: Pick<ImageRunRequest, "sources" | "anchor">): Box[] => {
  const sources = new Set(request.sources);
  return shapePageBoxes(records)
    .filter((shape) => !(shape.type === "text" && sources.has(shape.id) && contains(request.anchor, shape.box)))
    .map((shape) => shape.box);
};

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
      const marker = runMarkerOf(shape);
      // Spec 04 resolves durable markers against its render job store.
      if (!marker || marker.durable) return;
      const run = registry.get(marker.runId);
      const outcome = run?.outputs.get(marker.runIndex);
      if (run && !outcome) return;
      room.change(outcome?.ok ? fillFor(shape, outcome.landed) : clearChange(shape), runOrigin(marker.runId));
    };

    yield* rooms.afterOpen((_project, room) => {
      for (const record of room.read()) if (isShape(record) && runMarkerOf(record)) resolve(record, room);
    });

    // A shape that arrives carrying a marker (an undo restoring a deleted placeholder) is resolved at once.
    yield* rooms.afterCommit((_project, change, room) => {
      for (const id of change.created) {
        const record = change.records.get(id);
        const marker = isShape(record) ? runMarkerOf(record) : undefined;
        if (!marker || change.origin.id === runOriginId(marker.runId)) continue;
        const current = room.get(id);
        if (isShape(current)) resolve(current, room);
      }
    });

    const validate = (request: ImageRunRequest, folder: string) =>
      Effect.gen(function* () {
        if ((yield* settings.read).key === "") return yield* unframedError("unavailable", NO_KEY_MESSAGE);
        if (request.outputs.length < 1 || request.outputs.length > MAX_OUTPUTS) return yield* unframedError("bad_request", OUTPUT_COUNT_MESSAGE);
        if (request.outputs.every((output) => output.prompt.trim() === "")) return yield* unframedError("bad_request", EMPTY_PROMPT_MESSAGE);
        yield* validateReferences(request.outputs.flatMap((output) => output.references), folder);
      });

    const validateReferences = (refs: ReadonlyArray<RecipeRef>, folder: string) =>
      Effect.gen(function* () {
        for (const ref of refs) {
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
    const inline = async (folder: string, refs: ReadonlyArray<RecipeRef>): Promise<ReferencePart[]> =>
      Promise.all(
        refs.map(async (ref): Promise<ReferencePart> => {
          const url = "url" in ref ? ref.url : `data:${mimeForFile(ref.file)};base64,${(await readFile(join(folder, referenceName(ref.file)))).toString("base64")}`;
          return ref.kind === "video" ? { type: "video_url", video_url: { url } } : { type: "image_url", image_url: { url } };
        }),
      );

    const track = (runId: string, project: string) => {
      const run: RunRecord = { live: true, project: projectSlug(project), outputs: new Map() };
      remember(runId, run);
      return {
        settle: (outcome: RunOutcome<Landed | LandedText | LandedClip>) => {
          run.outputs.set(1, outcome);
          run.live = false;
        },
        forget: () => void registry.delete(runId),
      };
    };

    const texts = makeTextRuns({
      settings,
      rooms,
      openRouterOrigin: config.openRouterOrigin,
      projectFolder,
      validateReferences,
      inline,
      register: (runId, project) => track(runId, project),
      publish,
      runPromise,
      obstacles,
      emptyPromptMessage: EMPTY_PROMPT_MESSAGE,
    });

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
          const sidecar = resultMetaOf(records.find((record) => record.id === request.of!.shapeId) ?? {})?.sidecar;
          if (typeof sidecar === "string") of = { sidecar, action: request.of.action };
        }

        const pageId = records.find((record) => record.typeName === "page")?.id ?? "page:page";
        const height = placeholderHeight(request.params);
        const positions = placeResults(
          request.anchor,
          request.outputs.map(() => ({ w: PLACEHOLDER_WIDTH, h: height })),
          obstacles(records, request),
        );
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
          return imagePlaceholder({
            at: positions[index]!,
            height,
            index: indices[index]!,
            parentId: pageId,
            ref,
            marker: { runId, runIndex: index + 1, startedAt },
            result: {
              sidecar: null,
              medium: "image",
              model,
              batchId,
              runIndex: index + 1,
              runCount,
              cost: null,
              sources: [...request.sources],
              ...(request.batchExtraCost === undefined ? {} : { batchExtraCost: request.batchExtraCost }),
            },
          });
        });

        const run: RunRecord = { live: true, project, outputs: new Map() };
        remember(runId, run);
        yield* rooms.apply(request.project, { put: placeholders, remove: [] }, runOrigin(runId)).pipe(
          Effect.tapError(() => Effect.sync(() => registry.delete(runId))),
        );
        yield* PubSub.publish(events, { project, event: { type: "started", runId, batchId, count: runCount } });

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
          const { references } = output;
          const { resolution, quality, aspect_ratio, output_format, background, size } = request.params;
          const sidecar: ImageSidecar = {
            prompt: output.prompt,
            model,
            ...(resolution === undefined ? {} : { resolution }),
            ...(quality === undefined ? {} : { quality }),
            ...(aspect_ratio === undefined ? {} : { aspect_ratio }),
            ...(output_format === undefined ? {} : { output_format }),
            background: background ?? null,
            ...(size === undefined ? {} : { size }),
            referenceCount: references.length,
            references: { images: references.filter((ref) => ref.kind === "image").length, videos: references.filter((ref) => ref.kind === "video").length },
            batchId,
            runIndex,
            runCount,
            cost,
            createdAt: new Date().toISOString(),
            file,
            recipe: {
              medium: "image",
              model,
              params: { ...request.params } as Record<string, string>,
              selectionPrompt: output.selectionPrompt ?? request.selectionPrompt,
              instruction: request.instruction,
              references: [...references],
              sources: [...request.sources],
              ...(of === undefined ? {} : { of }),
            },
            ...(output.free === undefined ? {} : { free: output.free }),
          };
          await writeSidecar(folder, base, sidecar).catch((error: unknown) => logError(`could not write the sidecar of ${file}: ${errorText(error)}`));
          logInfo(`generated → ${join(folder, file)}${cost === null ? "" : `  ($${cost.toFixed(4)})`}`);
          const dimensions = imageDimensions(bytes);
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
          const body = imageRequestBody(model, output.prompt, request.params);
          let outcome: RunOutcome<Landed>;
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
              return outcome.ok ? fillFor(shape, outcome.landed) : runMarkerOf(shape)?.runId === runId ? clearChange(shape) : undefined;
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

        // The run lives in the engine: nothing here waits on the socket that started it.
        void Promise.all(request.outputs.map((_output, index) => settle(index)))
          .then(async (settled) => {
            run.live = false;
            await publish(project, {
              type: "finished",
              runId,
              succeeded: settled.filter((each) => each.ok).length,
              failed: settled.filter((each) => !each.ok).length,
              errors: [...new Set(settled.flatMap((each) => (each.error === undefined ? [] : [each.error])))],
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

    const readSidecar = (folder: string, name: string) =>
      Effect.flatMap(
        Effect.promise(() => readResultSidecar(folder, name)),
        (read) => (read === undefined ? Effect.fail(unframedError("not_found", RECIPE_GONE_MESSAGE)) : Effect.succeed(read)),
      );

    const recipe = (project: string, shapeId: string) =>
      Effect.gen(function* () {
        const folder = yield* projectFolder(project);
        const records = yield* rooms.read(project);
        const result = resultMetaOf(records.find((record) => record.id === shapeId) ?? {});
        if (result?.recipe) return result.recipe;
        if (typeof result?.sidecar !== "string") return yield* unframedError("not_found", RECIPE_GONE_MESSAGE);
        return (yield* readSidecar(folder, result.sidecar)).recipe;
      });

    const copyRecipe = (project: string, from: string, sidecar: string, file: string) =>
      Effect.gen(function* () {
        if (!isBareFileName(sidecar) || !isBareFileName(file)) return yield* unframedError("bad_request", "That is not a file in this project.");
        const source = yield* readSidecar(yield* projectFolder(from), sidecar);
        const targetDir = yield* projectFolder(project);
        const copies = new Map<string, string>();
        const copyOf = (name: string) =>
          Effect.gen(function* () {
            const known = copies.get(name);
            if (known !== undefined) return known;
            const copied = yield* media.copy(project, name, from);
            copies.set(name, copied);
            return copied;
          });
        const references: RecipeRef[] = [];
        for (const ref of source.recipe.references) {
          if ("url" in ref) references.push(ref);
          else if (ref.original === undefined) references.push({ kind: ref.kind, file: yield* copyOf(ref.file) });
          else references.push({ kind: ref.kind, file: yield* copyOf(ref.file), original: yield* copyOf(ref.original) });
        }
        // Spec 05: a text result's only file is its sidecar, so its copy is a new sidecar that never overwrites.
        if (source.recipe.medium === "text") {
          const next = { ...source.sidecar, recipe: { ...source.recipe, references } };
          return yield* Effect.tryPromise({
            try: async () => ({ sidecar: await writeLoneSidecar(targetDir, file.replace(/\.json$/, ""), next) }),
            catch: (error) => unframedError("internal", `Could not copy the recipe: ${errorText(error)}`),
          });
        }
        // The result's sidecar sits beside its image, as a run leaves it, in place of the copy's own.
        const target = sidecarFileName(file);
        const next = { ...source.sidecar, file, recipe: { ...source.recipe, references } };
        yield* Effect.tryPromise({
          try: () => writeFile(join(targetDir, target), `${JSON.stringify(next, null, 2)}\n`),
          catch: (error) => unframedError("internal", `Could not copy the recipe: ${errorText(error)}`),
        });
        return { sidecar: target };
      });

    const liveRuns = (project?: string) =>
      Effect.sync(() => {
        const slug = project === undefined ? undefined : projectSlug(project);
        return [...registry.values()].filter((run) => run.live && (slug === undefined || run.project === slug)).length;
      });

    return Runs.of({ image, text: texts.text, complete: texts.complete, subscribe, recipe, copyRecipe, liveRuns, track });
  }),
);
