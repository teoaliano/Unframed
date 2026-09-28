import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { errorText, logError } from "./log.ts";

/** A hook still running this long after shutdown began is abandoned, and the engine exits anyway. */
export const HOOK_BUDGET_MS = 1500;

type Hook = { readonly name: string; readonly run: Effect.Effect<void, unknown> };

/**
 * What runs when the engine stops. Later specs register here: flush sync rooms and
 * databases, close the share tunnel, stop the render sweep, end agent sessions.
 */
export class Shutdown extends Context.Service<
  Shutdown,
  {
    readonly register: (name: string, run: Effect.Effect<void, unknown>) => Effect.Effect<void>;
    /** Runs every hook at once. Resolves when all finished or the budget from `startedAt` ran out. */
    readonly runHooks: (startedAt: number) => Effect.Effect<void>;
  }
>()("unframed/engine/Shutdown") {}

export const shutdownLayer = Layer.sync(Shutdown, () => {
  const hooks: Hook[] = [];
  return Shutdown.of({
    register: (name, run) => Effect.sync(() => void hooks.push({ name, run })),
    runHooks: (startedAt) =>
      Effect.forEach(
        [...hooks],
        (hook) =>
          hook.run.pipe(
            Effect.timeoutOption(Math.max(0, startedAt + HOOK_BUDGET_MS - Date.now())),
            Effect.flatMap((finished) =>
              finished._tag === "Some"
                ? Effect.void
                : Effect.sync(() => logError(`shutdown: abandoned ${hook.name}, it did not finish in time`)),
            ),
            Effect.catchCause((cause) =>
              Effect.sync(() => logError(`shutdown: ${hook.name} failed: ${errorText(Cause.squash(cause))}`)),
            ),
          ),
        { concurrency: "unbounded", discard: true },
      ),
  });
});
