import { MAX_REQUEST_BYTES, tooLargeMessage } from "./httpMessages.ts";

const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 10_000;
const MESSAGE_TOO_BIG = 1009;

/**
 * How long the web waits before its next reconnect attempt: 1 s, doubling, capped at
 * 10 s. `attempt` counts failed attempts since the last socket that opened.
 */
export const reconnectDelay = (attempt: number): number => Math.min(INITIAL_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);

export interface ConnectionFailure {
  readonly code: "bad_request" | "unavailable";
  readonly message: string;
  /** Tells a failure made because the socket went away from one the engine answered. */
  readonly reason: "too_large" | "connection_lost";
}

/** What every call in flight on a socket fails with when the socket closes with `closeCode`. */
export const connectionFailure = (closeCode: number | undefined): ConnectionFailure =>
  closeCode === MESSAGE_TOO_BIG
    ? { code: "bad_request", message: tooLargeMessage(undefined, MAX_REQUEST_BYTES), reason: "too_large" }
    : { code: "unavailable", message: "The connection to the local engine was lost.", reason: "connection_lost" };
