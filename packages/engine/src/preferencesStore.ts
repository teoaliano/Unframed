import { readFileSync } from "node:fs";
import type { PreferenceChange } from "@unframed/contracts";
import { UnframedError, unframedError } from "@unframed/contracts";
import { preferenceProblem } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { writeFileAtomic } from "./atomicFile.ts";
import { errorText } from "./log.ts";
import { Config } from "./services.ts";

type Values = Record<string, unknown>;

/**
 * Per-person UI preferences, kept by the engine because the packaged app's origin changes
 * on every launch and `localStorage` does not survive it.
 */
export class PreferencesStore extends Context.Service<
  PreferencesStore,
  {
    /** Every key when `keys` is omitted; otherwise only those of `keys` that have a value. */
    readonly get: (keys?: ReadonlyArray<string>) => Effect.Effect<Values>;
    /** `null` deletes the key. */
    readonly set: (key: string, value: unknown) => Effect.Effect<void, UnframedError>;
    /** The current value of each key first (`null` when absent), then one per change. */
    readonly subscribe: (keys?: ReadonlyArray<string>) => Stream.Stream<PreferenceChange>;
  }
>()("unframed/engine/PreferencesStore") {}

/** A missing or unparsable file reads as `{}`: losing a preference costs one click, refusing to boot costs more. */
const readPreferences = (path: string): Values => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Values) : {};
  } catch {
    return {};
  }
};

export const preferencesStoreLayer = Layer.effect(
  PreferencesStore,
  Effect.gen(function* () {
    const config = yield* Config;
    let values = readPreferences(config.preferencesPath);
    const changes = yield* PubSub.unbounded<PreferenceChange>();
    const writes = yield* Semaphore.make(1);

    const pick = (keys: ReadonlyArray<string> | undefined): Values => {
      if (keys === undefined) return { ...values };
      const picked: Values = {};
      for (const key of keys) if (Object.hasOwn(values, key)) picked[key] = values[key];
      return picked;
    };

    const set = (key: string, value: unknown) =>
      Effect.gen(function* () {
        const problem = preferenceProblem(key, value);
        if (problem !== undefined) return yield* unframedError("bad_request", problem);
        const next: Values = { ...values };
        if (value === null || value === undefined) delete next[key];
        else next[key] = value;
        yield* Effect.tryPromise({
          try: () => writeFileAtomic(config.preferencesPath, `${JSON.stringify(next, null, 2)}\n`),
          catch: (error) => unframedError("internal", `Could not save the preference: ${errorText(error)}`),
        });
        values = next;
        yield* PubSub.publish(changes, { key, value: value ?? null });
      }).pipe(writes.withPermits(1));

    const subscribe = (keys?: ReadonlyArray<string>) =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribe before reading the snapshot, so no change falls between the two.
          const subscription = yield* PubSub.subscribe(changes);
          const initial: PreferenceChange[] =
            keys === undefined
              ? Object.entries(values).map(([key, value]) => ({ key, value }))
              : keys.map((key) => ({ key, value: Object.hasOwn(values, key) ? values[key] : null }));
          const wanted = keys === undefined ? undefined : new Set(keys);
          return Stream.concat(
            Stream.fromIterable(initial),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((change) => wanted === undefined || wanted.has(change.key)),
            ),
          );
        }),
      );

    return PreferencesStore.of({ get: (keys) => Effect.sync(() => pick(keys)), set, subscribe });
  }),
);
