import type { SettingsPatch } from "@unframed/contracts";
import * as Effect from "effect/Effect";
import { errorText, logError } from "./log.ts";
import type { PreferencesStore } from "./preferencesStore.ts";

const MEDIUM_OF_FIELD = { imageModel: "image", textModel: "text", videoModel: "video" } as const;

/**
 * The step spec 03 adds to `settings.update`, after the change is applied: a new default
 * model for a medium clears that medium's stored last-used model, so the new default
 * takes effect. The props stay.
 */
export const clearStoredModels = (preferences: PreferencesStore["Service"], patch: SettingsPatch) =>
  Effect.gen(function* () {
    for (const [name, medium] of Object.entries(MEDIUM_OF_FIELD)) {
      if (patch[name as keyof typeof MEDIUM_OF_FIELD] === undefined) continue;
      const key = `lastUsed.${medium}`;
      const value = (yield* preferences.get([key]))[key];
      if (typeof value !== "object" || value === null || !("model" in value)) continue;
      const { model: _model, ...rest } = value as Record<string, unknown>;
      yield* preferences.set(key, rest).pipe(Effect.catch((error) => Effect.sync(() => logError(`could not clear ${key}: ${errorText(error)}`))));
    }
  });
