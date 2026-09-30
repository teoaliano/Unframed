/**
 * Text runs (spec 05), the text medium's mirror of the image run: a placeholder text
 * result, one upstream chat call, fill or remove, sidecar, events. Text completion shares
 * its adapter and sidecar, lands nothing, and fails its call instead of reporting events.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  resultMetaOf,
  runMarkerOf,
  runOriginId,
  unframedError,
  type RecipeRef,
  type ResultRecipe,
  type RunEvent,
  type TextCompleteRequest,
  type TextRunRequest,
  type TextSidecar,
  UnframedError,
} from "@unframed/contracts";
import { NO_KEY_MESSAGE, nextRef, placeResults, projectSlug, type Box } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { getIndicesAbove, type IndexKey } from "@tldraw/utils";
import * as Effect from "effect/Effect";
import type { CanvasRooms, ChangeOrigin } from "../canvas/rooms.ts";
import { errorText, logError, logInfo } from "../log.ts";
import { chatRequestBody, completeText, type ReferencePart, type TextCallOutcome } from "../openRouter/text.ts";
import type { SettingsStore } from "../settingsStore.ts";
import { clearChange, fillFor, isShape, PLACEHOLDER_WIDTH, textPlaceholder, type LandedText, type RunOutcome } from "./placeholders.ts";
import { fileStamp, writeLoneSidecar } from "./resultFiles.ts";

/** What a text run needs from the run service that owns the registry. */
export interface TextRunDeps {
  readonly settings: SettingsStore["Service"];
  readonly rooms: CanvasRooms["Service"];
  readonly openRouterOrigin: string;
  readonly projectFolder: (project: string) => Effect.Effect<string, UnframedError>;
  /** Refuses a missing reference file or a link that is not https. */
  readonly validateReferences: (refs: ReadonlyArray<RecipeRef>, folder: string) => Effect.Effect<void, UnframedError>;
  readonly inline: (folder: string, refs: ReadonlyArray<RecipeRef>) => Promise<ReferencePart[]>;
  /** Registers a live run; `settle` records its one output's outcome and ends it, `forget` drops a run that never started. */
  readonly register: (runId: string, project: string) => {
    readonly settle: (outcome: RunOutcome<LandedText>) => void;
    readonly forget: () => void;
  };
  readonly publish: (project: string, event: RunEvent) => Promise<unknown>;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  /** What a row of results must stay clear of. */
  readonly obstacles: (records: ReadonlyArray<TLRecord>, request: { readonly sources: ReadonlyArray<string>; readonly anchor: Box }) => Box[];
  readonly emptyPromptMessage: string;
}

/** A text placeholder's box for placement: an empty prompt hugs its hint, so its height is the prompt's minimum. */
const PLACEHOLDER_BOX = { w: PLACEHOLDER_WIDTH, h: 28 };

const origin = (runId: string): ChangeOrigin => ({ kind: "server", id: runOriginId(runId) });

const counts = (refs: ReadonlyArray<RecipeRef>) => ({
  images: refs.filter((ref) => ref.kind === "image").length,
  videos: refs.filter((ref) => ref.kind === "video").length,
});

/** `<stamp>-text-<slug of the prompt, or "image">`: the base of a text sidecar. */
const textBase = (startedAt: number, prompt: string) => `${fileStamp(startedAt)}-text-${projectSlug(prompt) || "image"}`;

export const makeTextRuns = (deps: TextRunDeps) => {
  const { settings, rooms } = deps;

  const validate = (request: { readonly prompt: string; readonly references?: ReadonlyArray<RecipeRef> | undefined }, folder: string) =>
    Effect.gen(function* () {
      if ((yield* settings.read).key === "") return yield* unframedError("unavailable", NO_KEY_MESSAGE);
      if (request.prompt.trim() === "") return yield* unframedError("bad_request", deps.emptyPromptMessage);
      yield* deps.validateReferences(request.references ?? [], folder);
    });

  /** One chat call with its references inlined, logged. Never rejects. */
  const chatOnce = async (folder: string, key: string, model: string, prompt: string, references: ReadonlyArray<RecipeRef>, system?: string): Promise<TextCallOutcome> => {
    let outcome: TextCallOutcome;
    try {
      outcome = await completeText(deps.openRouterOrigin, key, chatRequestBody(model, prompt, await deps.inline(folder, references), system));
    } catch (error) {
      outcome = { ok: false, error: errorText(error) };
    }
    if (outcome.ok) {
      const { images, videos } = counts(references);
      logInfo(`text →  ${outcome.text.length} chars  (sent ${images} image, ${videos} video refs)${outcome.cost === null ? "" : `  ($${outcome.cost.toFixed(4)})`}`);
    }
    return outcome;
  };

  /**
   * Writes a text call's sidecar and answers its name; a failure is logged and never fails
   * the call. With no sidecar written the answer is `null`, so a result never points at
   * another run's file.
   */
  const writeSidecar = async (folder: string, startedAt: number, sidecar: TextSidecar): Promise<string | null> => {
    const base = textBase(startedAt, sidecar.prompt);
    try {
      return await writeLoneSidecar(folder, base, sidecar);
    } catch (error) {
      logError(`could not write the text sidecar ${base}.json: ${errorText(error)}`);
      return null;
    }
  };

  const sidecarOf = (prompt: string, model: string, text: string, references: ReadonlyArray<RecipeRef>, batchId: string | null, cost: number | null): TextSidecar => ({
    kind: "text",
    prompt,
    model,
    result: text,
    referenceCount: references.length,
    references: counts(references),
    batchId,
    cost,
    createdAt: new Date().toISOString(),
  });

  const complete = (request: TextCompleteRequest) =>
    Effect.gen(function* () {
      const folder = yield* deps.projectFolder(request.project);
      yield* validate(request, folder);
      const current = yield* settings.read;
      const model = request.model ?? current.textModel;
      const references = request.references ?? [];
      const startedAt = Date.now();
      const outcome = yield* Effect.promise(() => chatOnce(folder, current.key, model, request.prompt, references, request.system));
      if (!outcome.ok) return yield* unframedError("upstream", outcome.error);
      yield* Effect.promise(() => writeSidecar(folder, startedAt, sidecarOf(request.prompt, model, outcome.text, references, request.batchId ?? null, outcome.cost)));
      return { text: outcome.text, cost: outcome.cost };
    });

  const text = (request: TextRunRequest) =>
    Effect.gen(function* () {
      const folder = yield* deps.projectFolder(request.project);
      const project = projectSlug(request.project);
      yield* validate(request, folder);
      const current = yield* settings.read;
      const model = request.model ?? current.textModel;
      const startedAt = Date.now();
      const runId = `run-${startedAt}-${randomUUID().slice(0, 8)}`;
      const batchId = `b-${startedAt}`;

      const records = yield* rooms.read(request.project);
      let of: ResultRecipe["of"];
      if (request.of) {
        const sidecar = resultMetaOf(records.find((record) => record.id === request.of!.shapeId) ?? {})?.sidecar;
        if (typeof sidecar === "string") of = { sidecar, action: request.of.action };
      }
      const pageId = records.find((record) => record.typeName === "page")?.id ?? "page:page";
      const [at] = placeResults(request.anchor, [PLACEHOLDER_BOX], deps.obstacles(records, request));
      const topIndex = records
        .filter((record) => isShape(record) && (record as unknown as { parentId: string }).parentId === pageId)
        .map((record) => (record as unknown as { index: IndexKey }).index)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .at(-1);
      const placeholder = textPlaceholder({
        at: at!,
        index: getIndicesAbove(topIndex ?? null, 1)[0]!,
        parentId: pageId,
        ref: nextRef(records),
        marker: { runId, runIndex: 1, startedAt },
        result: { sidecar: null, medium: "text", model, batchId, runIndex: 1, runCount: 1, cost: null, sources: [...request.sources] },
      });
      const shapeId = placeholder.id as string;

      const run = deps.register(runId, project);
      yield* rooms.apply(request.project, { put: [placeholder], remove: [] }, origin(runId)).pipe(Effect.tapError(() => Effect.sync(run.forget)));
      yield* Effect.promise(() => deps.publish(project, { type: "started", runId, batchId, count: 1 }));

      const finish = async () => {
        const outcome = await chatOnce(folder, current.key, model, request.prompt, request.references);
        let landed: LandedText | undefined;
        if (outcome.ok) {
          const recipe: ResultRecipe = {
            medium: "text",
            model,
            params: {},
            selectionPrompt: request.selectionPrompt,
            instruction: request.instruction,
            references: [...request.references],
            sources: [...request.sources],
            ...(of === undefined ? {} : { of }),
          };
          const sidecar = await writeSidecar(folder, startedAt, { ...sidecarOf(request.prompt, model, outcome.text, request.references, batchId, outcome.cost), recipe });
          landed = { kind: "text", text: outcome.text.replace(/\r\n/g, "\n").trim(), sidecar, cost: outcome.cost };
          run.settle({ ok: true, landed });
        } else {
          run.settle({ ok: false, error: outcome.error });
        }
        const change = await deps
          .runPromise(
            Effect.map(rooms.read(request.project), (now) => {
              const shape = now.find((record) => record.id === shapeId);
              if (!isShape(shape)) return undefined;
              return landed ? fillFor(shape, landed) : runMarkerOf(shape)?.runId === runId ? clearChange(shape) : undefined;
            }),
          )
          .catch(() => undefined);
        if (change) {
          await deps.runPromise(rooms.apply(request.project, change, origin(runId))).catch((error: unknown) =>
            logError(`${runId}: could not update output 1 on the canvas: ${errorText(error)}`),
          );
        }
        if (landed) {
          const orphaned = change === undefined;
          if (orphaned) logInfo(`${runId}: output 1 landed after its placeholder was deleted → ${join(folder, landed.sidecar ?? "")}`);
          await deps.publish(project, { type: "output", runId, runIndex: 1, ok: true, shapeId, file: landed.sidecar ?? "", cost: landed.cost });
          await deps.publish(project, { type: "finished", runId, succeeded: 1, failed: 0, errors: [], orphaned: orphaned ? 1 : 0 });
          return;
        }
        const error = outcome.ok ? "" : outcome.error;
        logError(`${runId}: output 1 failed: ${error}`);
        await deps.publish(project, { type: "output", runId, runIndex: 1, ok: false, error });
        await deps.publish(project, { type: "finished", runId, succeeded: 0, failed: 1, errors: [error], orphaned: 0 });
      };
      // The run lives in the engine: nothing here waits on the socket that started it.
      void finish().catch((error: unknown) => logError(`${runId}: ${errorText(error)}`));

      return { runId, batchId, placeholders: [shapeId] };
    });

  return { text, complete };
};
