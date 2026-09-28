import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CLOSE_BUDGET_MS, closeBy, type Closer } from "./closeBudget.ts";
import { logError } from "./log.ts";

/** What runs when the engine stops. Each subsystem that must flush or end something registers a hook. */
export class Shutdown extends Context.Service<
  Shutdown,
  {
    readonly register: (name: string, run: Effect.Effect<void, unknown>) => Effect.Effect<void>;
    /** Runs every hook at once and resolves when all finish or the budget from `startedAt` runs out. */
    readonly runHooks: (startedAt: number) => Effect.Effect<void>;
  }
>()("unframed/engine/Shutdown") {}

export const shutdownLayer = Layer.sync(Shutdown, () => {
  const hooks: Closer[] = [];
  return Shutdown.of({
    register: (name, run) => Effect.sync(() => void hooks.push({ name, close: run })),
    runHooks: (startedAt) =>
      Effect.forEach(
        [...hooks],
        (hook) =>
          Effect.flatMap(closeBy(hook, startedAt + CLOSE_BUDGET_MS), (problem) =>
            problem === undefined ? Effect.void : Effect.sync(() => logError(`shutdown: ${hook.name}: ${problem}`)),
          ),
        { concurrency: "unbounded", discard: true },
      ),
  });
});
