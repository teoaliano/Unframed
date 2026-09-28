import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { errorText } from "./log.ts";

/** How long closing may take before a closer is abandoned: the shutdown sequence's budget. */
export const CLOSE_BUDGET_MS = 1500;

export interface CloserFailure {
  readonly project: string;
  readonly name: string;
  readonly reason: string;
}

type Closer = { readonly name: string; readonly close: Effect.Effect<void, unknown> };

/**
 * Every subsystem that holds a project's resources open registers one closer for that
 * project when it first opens them. Closing a project runs its closers newest first, so
 * a subsystem built on another (a sync room on the database) closes before it. After a
 * close, the next use of the project opens it afresh.
 */
export class OpenProjects extends Context.Service<
  OpenProjects,
  {
    /** Answers a function that forgets this closer, for a subsystem that closes itself. */
    readonly register: (project: string, name: string, close: Effect.Effect<void, unknown>) => Effect.Effect<() => void>;
    /** Runs every closer for the project and reports each one that failed, without stopping the others. */
    readonly close: (project: string) => Effect.Effect<ReadonlyArray<CloserFailure>>;
    readonly closeAll: Effect.Effect<ReadonlyArray<CloserFailure>>;
  }
>()("unframed/engine/OpenProjects") {}

export const openProjectsLayer = Layer.sync(OpenProjects, () => {
  const registry = new Map<string, Closer[]>();

  const register = (project: string, name: string, close: Effect.Effect<void, unknown>) =>
    Effect.sync(() => {
      const closer: Closer = { name, close };
      const closers = registry.get(project) ?? [];
      closers.push(closer);
      registry.set(project, closers);
      return () => {
        const current = registry.get(project);
        if (!current) return;
        const index = current.indexOf(closer);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 0) registry.delete(project);
      };
    });

  const close = (project: string) =>
    Effect.gen(function* () {
      const closers = registry.get(project) ?? [];
      registry.delete(project);
      const deadline = Date.now() + CLOSE_BUDGET_MS;
      const failures: CloserFailure[] = [];
      for (const closer of [...closers].reverse()) {
        const remaining = Math.max(0, deadline - Date.now());
        const outcome = yield* closer.close.pipe(
          Effect.timeoutOption(remaining),
          Effect.map((finished) => (finished._tag === "Some" ? undefined : "did not finish in time")),
          Effect.catchCause((cause) => Effect.succeed(errorText(Cause.squash(cause)))),
        );
        if (outcome !== undefined) failures.push({ project, name: closer.name, reason: outcome });
      }
      return failures;
    });

  const closeAll = Effect.suspend(() =>
    Effect.map(
      Effect.forEach([...registry.keys()], close, { concurrency: "unbounded" }),
      (all) => all.flat(),
    ),
  );

  return OpenProjects.of({ register, close, closeAll });
});
