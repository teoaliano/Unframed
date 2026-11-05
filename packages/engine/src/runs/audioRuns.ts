import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AUDIO_DEFAULT_SIZE,
  resultMetaOf,
  runMarkerOf,
  runOriginId,
  unframedError,
  type AudioRunRequest,
  type AudioSidecar,
  type ResultRecipe,
  type RunEvent,
  UnframedError,
} from "@unframed/contracts";
import { ELEVENLABS_MODEL_ID, ELEVENLABS_VOICE_ID, AUDIO_FORMATS, audioExtension, audioRangeRefusal, DEFAULT_AUDIO_FORMAT, ELEVENLABS_NO_KEY, nextRef, placeResults, projectSlug, speechCall, type Box } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import * as Effect from "effect/Effect";
import type { CanvasRooms, ChangeOrigin } from "../canvas/rooms.ts";
import { speak } from "../elevenLabs/client.ts";
import { errorText, logError, logInfo } from "../log.ts";
import type { SettingsStore } from "../settingsStore.ts";
import { audioPlaceholder, clearChange, fillFor, indexOnTop, isShape, type LandedAudio, type RunOutcome } from "./placeholders.ts";
import { fileStamp, writeResultFile, writeSidecar } from "./resultFiles.ts";
import { applyNodeChange, dropVersion, fillVersion, finishRun, nodeSidecarFields, startVersions, type NodeTarget } from "../nodes/versions.ts";

export interface AudioRunDeps {
  readonly settings: SettingsStore["Service"];
  readonly rooms: CanvasRooms["Service"];
  readonly elevenLabsOrigin: string;
  readonly projectFolder: (project: string) => Effect.Effect<string, UnframedError>;
  readonly register: (runId: string, project: string) => { readonly settle: (outcome: RunOutcome<LandedAudio>) => void; readonly forget: () => void };
  readonly publish: (project: string, event: RunEvent) => Promise<unknown>;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly obstacles: (records: ReadonlyArray<TLRecord>, request: { readonly sources: ReadonlyArray<string>; readonly anchor: Box }) => Box[];
  readonly emptyPromptMessage: string;
}

const origin = (runId: string): ChangeOrigin => ({ kind: "server", id: runOriginId(runId) });

const definedParams = (params: AudioRunRequest["params"]): Record<string, string | number | boolean> =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)) as Record<string, string | number | boolean>;

export const makeAudioRuns = (deps: AudioRunDeps) => {
  const { settings, rooms } = deps;

  const validate = (request: AudioRunRequest) =>
    Effect.gen(function* () {
      if ((yield* settings.read).elevenLabsKey === "") return yield* unframedError("unavailable", ELEVENLABS_NO_KEY);
      if (request.prompt.trim() === "") return yield* unframedError("bad_request", deps.emptyPromptMessage);
      if (!ELEVENLABS_VOICE_ID.test(request.voice.id)) return yield* unframedError("bad_request", "That is not an ElevenLabs voice id.");
      if (request.model !== undefined && !ELEVENLABS_MODEL_ID.test(request.model)) return yield* unframedError("bad_request", "That does not look like an ElevenLabs model id.");
      if (request.params.output_format !== undefined && !AUDIO_FORMATS.includes(request.params.output_format)) return yield* unframedError("bad_request", "That audio format is not offered here.");
      const refusal = audioRangeRefusal(request.params);
      if (refusal !== undefined) return yield* unframedError("bad_request", refusal);
    });

  const audio = (request: AudioRunRequest, into?: NodeTarget) =>
    Effect.gen(function* () {
      const folder = yield* deps.projectFolder(request.project);
      const project = projectSlug(request.project);
      yield* validate(request);
      const current = yield* settings.read;
      const model = request.model ?? current.audioModel;
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
      const [at] = placeResults(request.anchor, [AUDIO_DEFAULT_SIZE], deps.obstacles(records, request));
      let versionId: string | undefined;
      const placeholder = audioPlaceholder({
        at: at!,
        index: indexOnTop(records, pageId),
        parentId: pageId,
        ref: nextRef(records),
        marker: { runId, runIndex: 1, startedAt },
        result: { sidecar: null, medium: "audio", model, batchId, runIndex: 1, runCount: 1, cost: null, credits: null, sources: [...request.sources] },
      });
      const shapeId = into !== undefined ? into.shapeId : (placeholder.id as string);

      const run = deps.register(runId, project);
      if (into !== undefined) {
        const started = yield* rooms
          .applyWhen(
            request.project,
            (get) => {
              const made = startVersions(get, into.shapeId, { runId, chainId: into.chainId, claim: into.claim, batchId, count: 1, fingerprint: into.fingerprint, startedAt });
              versionId = made?.ids[0];
              return made?.change;
            },
            origin(runId),
          )
          .pipe(Effect.tapError(() => Effect.sync(run.forget)));
        if (started === undefined) {
          run.forget();
          return yield* unframedError("not_found", "That node is no longer on the canvas.");
        }
      } else yield* rooms.apply(request.project, { put: [placeholder], remove: [] }, origin(runId)).pipe(Effect.tapError(() => Effect.sync(run.forget)));
      yield* Effect.promise(() => deps.publish(project, { type: "started", runId, batchId, count: 1 }));

      const params = definedParams(request.params);
      const call = speechCall({ text: request.prompt, model, params });

      const land = async (bytes: Buffer, credits: number | null, requestId: string | null): Promise<LandedAudio> => {
        const ext = audioExtension(call.query.output_format);
        let base: string;
        try {
          base = await writeResultFile(folder, `${fileStamp(startedAt)}-audio-${projectSlug(request.prompt) || "audio"}`, ext, bytes);
        } catch (error) {
          throw new Error(`Generated the audio but failed to write it: ${errorText(error)}`);
        }
        const file = `${base}.${ext}`;
        const recipe: ResultRecipe = {
          medium: "audio",
          model,
          params: { voice_id: request.voice.id, voice_name: request.voice.name, ...params },
          selectionPrompt: request.selectionPrompt,
          instruction: request.instruction,
          references: [],
          sources: [...request.sources],
          ...(of === undefined ? {} : { of }),
          ...nodeSidecarFields(into, versionId),
        };
        const sidecar: AudioSidecar = {
          kind: "audio",
          prompt: request.prompt,
          model,
          voice: { id: request.voice.id, name: request.voice.name },
          voice_settings: call.body.voice_settings ?? null,
          output_format: call.query.output_format ?? DEFAULT_AUDIO_FORMAT,
          seed: call.body.seed ?? null,
          language_code: call.body.language_code ?? null,
          characters: request.prompt.length,
          billing: "elevenlabs-credits",
          credits,
          requestId,
          batchId,
          runIndex: 1,
          runCount: 1,
          createdAt: new Date().toISOString(),
          file,
          recipe,
          ...nodeSidecarFields(into, versionId),
        };
        let sidecarName: string | null = `${base}.json`;
        await writeSidecar(folder, base, sidecar).catch((error: unknown) => {
          sidecarName = null;
          logError(`could not write the sidecar of ${file}: ${errorText(error)}`);
        });
        logInfo(`audio →  ${request.prompt.length} chars  ${model}  ${credits === null ? "(credits unknown)" : `(${credits} credits)`}`);
        return { kind: "audio", file, sidecar: sidecarName, credits };
      };

      const finish = async () => {
        let outcome: RunOutcome<LandedAudio>;
        try {
          const answer = await speak(deps.elevenLabsOrigin, current.elevenLabsKey, request.voice.id, call);
          outcome = answer.ok ? { ok: true, landed: await land(answer.bytes, answer.credits, answer.requestId) } : { ok: false, error: answer.error };
        } catch (error) {
          outcome = { ok: false, error: errorText(error) };
        }
        run.settle(outcome);
        if (into !== undefined && versionId !== undefined) {
          const id = versionId;
          await applyNodeChange(rooms, deps.runPromise, request.project, (get) => (outcome.ok ? fillVersion(get, into.shapeId, id, { file: outcome.landed.file, fileName: outcome.landed.file }) : dropVersion(get, into.shapeId, id)), runId);
          const errors = outcome.ok ? [] : [outcome.error];
          if (outcome.ok) await deps.publish(project, { type: "output", runId, runIndex: 1, ok: true, shapeId, versionId: id, file: outcome.landed.file, cost: null, credits: outcome.landed.credits });
          else await deps.publish(project, { type: "output", runId, runIndex: 1, ok: false, error: outcome.error, shapeId, versionId: id });
          await applyNodeChange(rooms, deps.runPromise, request.project, (get) => finishRun(get, into.shapeId, runId, errors), runId);
          await deps.publish(project, { type: "finished", runId, succeeded: outcome.ok ? 1 : 0, failed: outcome.ok ? 0 : 1, errors, orphaned: 0, shapeId });
          into.onFinished?.({ succeeded: outcome.ok ? 1 : 0, errors, cost: null });
          return;
        }
        const change = await deps
          .runPromise(
            Effect.map(rooms.read(request.project), (now) => {
              const shape = now.find((record) => record.id === shapeId);
              if (!isShape(shape)) return undefined;
              return outcome.ok ? fillFor(shape, outcome.landed) : runMarkerOf(shape)?.runId === runId ? clearChange(shape) : undefined;
            }),
          )
          .catch(() => undefined);
        if (change) {
          await deps.runPromise(rooms.apply(request.project, change, origin(runId))).catch((error: unknown) =>
            logError(`${runId}: could not update output 1 on the canvas: ${errorText(error)}`),
          );
        }
        if (outcome.ok) {
          const orphaned = change === undefined;
          if (orphaned) logInfo(`${runId}: output 1 landed after its placeholder was deleted → ${join(folder, outcome.landed.file)}`);
          await deps.publish(project, { type: "output", runId, runIndex: 1, ok: true, shapeId, file: outcome.landed.file, cost: null, credits: outcome.landed.credits });
          await deps.publish(project, { type: "finished", runId, succeeded: 1, failed: 0, errors: [], orphaned: orphaned ? 1 : 0 });
          return;
        }
        logError(`${runId}: output 1 failed: ${outcome.error}`);
        await deps.publish(project, { type: "output", runId, runIndex: 1, ok: false, error: outcome.error });
        await deps.publish(project, { type: "finished", runId, succeeded: 0, failed: 1, errors: [outcome.error], orphaned: 0 });
      };
      void finish().catch((error: unknown) => {
        logError(`${runId}: ${errorText(error)}`);
        into?.onFinished?.({ succeeded: 0, errors: [errorText(error)], cost: null });
      });

      return { runId, batchId, placeholders: [versionId ?? shapeId] };
    });

  return { audio };
};
