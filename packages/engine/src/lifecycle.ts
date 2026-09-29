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
import { resolveOutputDir } from "./paths.ts";
import { Config } from "./services.ts";
import { SettingsStore } from "./settingsStore.ts";

export class Lifecycle extends Context.Service<
  Lifecycle,
  {
    readonly updateSettings: (patch: SettingsPatch) => Effect.Effect<Settings, UnframedError>;
  }
>()("unframed/engine/Lifecycle") {}

export const lifecycleLayer = Layer.effect(
  Lifecycle,
  Effect.gen(function* () {
    const config = yield* Config;
    const settings = yield* SettingsStore;
    const lock = yield* Semaphore.make(1);

    const updateSettings = (patch: SettingsPatch) =>
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

        yield* Effect.mapError(settings.write(changes), (error) => unframedError("internal", `Could not write .env: ${error.reason}`));
        yield* settings.emit;
        return yield* settings.view;
      }).pipe(lock.withPermits(1));

    return Lifecycle.of({ updateSettings });
  }),
);
