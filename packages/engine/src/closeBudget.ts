import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { errorText } from "./log.ts";

/**
 * How long closing may run after it begins: the shell waits 2 s after SIGTERM, so the
 * engine abandons whatever is still running at 1.5 s and exits anyway.
 */
export const CLOSE_BUDGET_MS = 1500;

/** Something to run while closing, named for the log. */
export interface Closer {
  readonly name: string;
  readonly close: Effect.Effect<void, unknown>;
}

/** Runs `closer` until `deadline` (epoch ms). Answers why it did not finish, or `undefined` when it did. */
export const closeBy = (closer: Closer, deadline: number): Effect.Effect<string | undefined> =>
  closer.close.pipe(
    Effect.timeoutOption(Math.max(0, deadline - Date.now())),
    Effect.map((finished) => (finished._tag === "Some" ? undefined : "it did not finish in time")),
    Effect.catchCause((cause) => Effect.succeed(errorText(Cause.squash(cause)))),
  );
