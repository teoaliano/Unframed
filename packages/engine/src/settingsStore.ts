import type { Settings } from "@unframed/contracts";
import { effectiveSettings, keyHint, type EffectiveSettings } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { makeEnvWriter, parseEnvText } from "./envFile.ts";
import { errorText } from "./log.ts";
import { resolveOutputDir } from "./paths.ts";
import { Config } from "./services.ts";

/** A `.env` write that did not land. Nothing in the running process changed. */
export class EnvWriteError extends Data.TaggedError("EnvWriteError")<{ readonly reason: string }> {}

/** The live value each settings variable sets. */
const FIELD_OF: Readonly<Record<string, keyof EffectiveSettings>> = {
  OPENROUTER_API_KEY: "key",
  OPENROUTER_IMAGE_MODEL: "imageModel",
  OPENROUTER_MODEL: "imageModel",
  OPENROUTER_TEXT_MODEL: "textModel",
  OPENROUTER_VIDEO_MODEL: "videoModel",
  OUTPUT_DIR: "outputDir",
  CLAUDE_PATH: "claudePath",
  CODEX_PATH: "codexPath",
  CLAUDE_CONFIG_DIR: "claudeConfigDir",
};

/**
 * The person's settings: the live values and the only code that changes `.env`. Callers
 * never see `.env` text. Spec 01's update rules, and the steps spec 10 inserts into them,
 * live in the lifecycle module, which is built on `write`.
 */
export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    /** The live values, key included. Never send these to the web. */
    readonly read: Effect.Effect<EffectiveSettings>;
    /** The resolved absolute output folder. */
    readonly outputDir: Effect.Effect<string>;
    /** What the web may see. */
    readonly view: Effect.Effect<Settings>;
    /**
     * Queues a `.env` write at the moment it is called, so writes land in call order. Once
     * a write is on disk the running process takes every variable it changed, except the
     * output folder when `holdOutputDir` is set (a folder move switches it later with
     * `useOutputDir`). A variable deleted from the file falls back to the process
     * environment. Nothing is emitted: call `emit`.
     */
    readonly write: (
      changes: Readonly<Record<string, string | null>>,
      options?: { readonly holdOutputDir?: boolean },
    ) => Effect.Effect<EffectiveSettings, EnvWriteError>;
    /** Switches the running process to this output folder, as `.env` spells it. */
    readonly useOutputDir: (outputDir: string) => Effect.Effect<void>;
    /** Publishes the current settings on `subscribe`. */
    readonly emit: Effect.Effect<void>;
    /** The current settings first, then one value per `emit`. */
    readonly subscribe: Stream.Stream<Settings>;
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
      const initial = effectiveSettings(options.fileVars, options.processEnv);
      let live = initial;
      const view = (settings: EffectiveSettings) => toView(settings, config.dataDir, options.previewPort);
      const published = yield* SubscriptionRef.make(view(initial));
      const writeEnv = makeEnvWriter(config.envPath);

      const write = (changes: Readonly<Record<string, string | null>>, writeOptions: { readonly holdOutputDir?: boolean } = {}) => {
        // Queued now, not when the effect runs: the OAuth callback relies on it (spec 10).
        const written = writeEnv(changes).then((text) => {
          const fromFile = effectiveSettings(parseEnvText(text), options.processEnv);
          // Applied inside the write chain, so two writes apply in the order they landed.
          const next: Record<string, string> = { ...live };
          for (const variable of Object.keys(changes)) {
            const field = FIELD_OF[variable];
            if (field === undefined || (field === "outputDir" && writeOptions.holdOutputDir === true)) continue;
            next[field] = fromFile[field];
          }
          live = next as unknown as EffectiveSettings;
          return live;
        });
        written.catch(() => undefined);
        return Effect.tryPromise({ try: () => written, catch: (error) => new EnvWriteError({ reason: errorText(error) }) });
      };

      return SettingsStore.of({
        read: Effect.sync(() => live),
        outputDir: Effect.sync(() => resolveOutputDir(live.outputDir, config.dataDir)),
        view: Effect.sync(() => view(live)),
        write,
        useOutputDir: (outputDir) =>
          Effect.sync(() => {
            live = { ...live, outputDir };
          }),
        emit: Effect.suspend(() => SubscriptionRef.set(published, view(live))),
        subscribe: SubscriptionRef.changes(published),
      });
    }),
  );
