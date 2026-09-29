/**
 * The changes that could strand paid work (spec 10): a settings update (spec 01's rules
 * with spec 10's steps inserted), removing the key, and renaming or deleting a project.
 * Each reads the job store strictly, touches the job records first and takes the
 * destructive step last, compensating when a later step fails. They run one at a time.
 */
import { mkdir } from "node:fs/promises";
import type { Settings, SettingsPatch } from "@unframed/contracts";
import { UnframedError, unframedError } from "@unframed/contracts";
import { normaliseSettingsPatch } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { errorText } from "./log.ts";
import { OAuth } from "./oauth/oauth.ts";
import { resolveOutputDir } from "./paths.ts";
import { Config } from "./services.ts";
import { SettingsStore } from "./settingsStore.ts";
import { RenderJobs } from "./video/renderJobs.ts";

export const KEY_REMOVED_ERROR =
  "Stopped tracking this render: the OpenRouter key was removed, so its progress can no longer be checked. It may still finish upstream, but nothing here will save the result.";

export interface RemovedKey {
  readonly settings: Settings;
  readonly endedRenders: number;
  readonly renderCleanupError?: string;
}

export class Lifecycle extends Context.Service<
  Lifecycle,
  {
    readonly updateSettings: (patch: SettingsPatch) => Effect.Effect<Settings, UnframedError>;
    /** Removing a key is a security action: it stands even when the job store cannot be read. */
    readonly removeKey: Effect.Effect<RemovedKey, UnframedError>;
  }
>()("unframed/engine/Lifecycle") {}

export const lifecycleLayer = Layer.effect(
  Lifecycle,
  Effect.gen(function* () {
    const config = yield* Config;
    const settings = yield* SettingsStore;
    const oauth = yield* OAuth;
    const renderJobs = yield* RenderJobs;
    const lock = yield* Semaphore.make(1);

    const writeEnv = (changes: Readonly<Record<string, string | null>>, options?: { readonly holdOutputDir?: boolean }) =>
      Effect.mapError(settings.write(changes, options), (error) => unframedError("internal", `Could not write .env: ${error.reason}`));

    const applyChanges = (changes: Readonly<Record<string, string | null>>) =>
      Effect.gen(function* () {
        const outputDir = changes.OUTPUT_DIR;
        if (typeof outputDir === "string") {
          yield* Effect.tryPromise({
            try: () => mkdir(resolveOutputDir(outputDir, config.dataDir), { recursive: true }),
            catch: (error) => unframedError("bad_request", `Cannot use that folder: ${errorText(error)}`),
          });
        }
        yield* writeEnv(changes);
        yield* settings.emit;
        return yield* settings.view;
      });

    const updateSettings = (patch: SettingsPatch) =>
      Effect.gen(function* () {
        const normalised = normaliseSettingsPatch(patch);
        if (!normalised.ok) return yield* unframedError("bad_request", normalised.message);
        const { changes } = normalised;
        // Right after validation, before anything that waits (the lock included): a save
        // made just before a Connect must not cancel the attempt that Connect created after.
        if ("OPENROUTER_API_KEY" in changes) yield* oauth.cancelAttempt;
        return yield* applyChanges(changes).pipe(lock.withPermits(1));
      });

    const removeKeyLocked = Effect.gen(function* () {
      // A delete, not an empty line, so a key the shell environment provides is not shadowed.
      yield* writeEnv({ OPENROUTER_API_KEY: null });
      yield* settings.emit;
      const view = yield* settings.view;
      // The sweep cannot poll without a key, so pending renders would sit stranded for 24 hours.
      return yield* renderJobs.failPending({ error: KEY_REMOVED_ERROR }).pipe(
        Effect.map((endedRenders): RemovedKey => ({ settings: view, endedRenders })),
        Effect.catch((error) =>
          Effect.succeed<RemovedKey>({
            settings: view,
            endedRenders: 0,
            renderCleanupError: `The key was removed, but renders already in progress could not be stopped: ${error.reason}`,
          }),
        ),
      );
    });

    // The attempt is cancelled first, outside the lock: the key is being removed anyway.
    const removeKey = Effect.andThen(oauth.cancelAttempt, removeKeyLocked.pipe(lock.withPermits(1)));

    return Lifecycle.of({ updateSettings, removeKey });
  }),
);
