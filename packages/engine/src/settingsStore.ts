import { mkdir } from "node:fs/promises";
import type { Settings, SettingsPatch } from "@unframed/contracts";
import { UnframedError, unframedError } from "@unframed/contracts";
import { effectiveSettings, keyHint, normaliseSettingsPatch, type EffectiveSettings } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { makeEnvWriter, parseEnvText } from "./envFile.ts";
import { errorText } from "./log.ts";
import { resolveOutputDir } from "./paths.ts";
import { Config } from "./services.ts";

/**
 * The person's settings. Callers never see `.env` text: `update` validates, writes and
 * applies, and every later request uses the new values.
 */
export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    /** The live values, key included. Never send these to the web. */
    readonly current: Effect.Effect<EffectiveSettings>;
    /** The resolved absolute output folder. */
    readonly outputDir: Effect.Effect<string>;
    /** What the web may see. */
    readonly view: Effect.Effect<Settings>;
    readonly update: (patch: SettingsPatch) => Effect.Effect<Settings, UnframedError>;
    /** The current settings first, then one value per change. */
    readonly changes: Stream.Stream<Settings>;
  }
>()("unframed/engine/SettingsStore") {}

export const toView = (settings: EffectiveSettings, dataDir: string, previewPort: number): Settings => ({
  hasKey: settings.key !== "",
  keyHint: keyHint(settings.key),
  imageModel: settings.imageModel,
  textModel: settings.textModel,
  videoModel: settings.videoModel,
  outputDir: resolveOutputDir(settings.outputDir, dataDir),
  claudePath: settings.claudePath,
  codexPath: settings.codexPath,
  claudeConfigDir: settings.claudeConfigDir,
  previewPort,
});

export const settingsStoreLayer = (options: {
  readonly fileVars: Record<string, string>;
  readonly processEnv: NodeJS.ProcessEnv;
  readonly previewPort: number;
}) =>
  Layer.effect(
    SettingsStore,
    Effect.gen(function* () {
      const config = yield* Config;
      const state = yield* SubscriptionRef.make(effectiveSettings(options.fileVars, options.processEnv));
      const writeEnv = makeEnvWriter(config.envPath);
      const updates = yield* Semaphore.make(1);
      const view = (settings: EffectiveSettings) => toView(settings, config.dataDir, options.previewPort);

      const update = (patch: SettingsPatch) =>
        Effect.gen(function* () {
          const normalised = normaliseSettingsPatch(patch);
          if (!normalised.ok) return yield* unframedError("bad_request", normalised.message);
          const { changes } = normalised;

          const outputDir = changes.OUTPUT_DIR;
          if (typeof outputDir === "string") {
            yield* Effect.tryPromise({
              try: () => mkdir(resolveOutputDir(outputDir, config.dataDir), { recursive: true }),
              catch: (error) => unframedError("bad_request", `Cannot use that folder: ${errorText(error)}`),
            });
          }

          const text = yield* Effect.tryPromise({
            try: () => writeEnv(changes),
            catch: (error) => unframedError("internal", `Could not write .env: ${errorText(error)}`),
          });

          const next = effectiveSettings(parseEnvText(text), options.processEnv);
          yield* SubscriptionRef.set(state, next);
          return view(next);
        }).pipe(updates.withPermits(1));

      return SettingsStore.of({
        current: SubscriptionRef.get(state),
        outputDir: Effect.map(SubscriptionRef.get(state), (settings) =>
          resolveOutputDir(settings.outputDir, config.dataDir),
        ),
        view: Effect.map(SubscriptionRef.get(state), view),
        update,
        changes: Stream.map(SubscriptionRef.changes(state), view),
      });
    }),
  );
