/**
 * The outside turn rule (spec 14, "Outside turns"). An outside chat has no prompt boundary
 * Unframed can see, so a turn is a run of calls close together in time.
 */

/** Two minutes of quiet unless a test shortens it through `UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS`. */
export const OUTSIDE_TURN_IDLE_MS = 2 * 60 * 1000;

export type OutsideTurnAction = "continue" | "settle-then-open" | "open";

export interface OutsideTurnInput {
  /** Whether the chat has an open outside turn. */
  readonly openTurn: boolean;
  /** When the chat's previous call ended, in epoch ms. Ignored with no open turn. */
  readonly lastCallAt: number | undefined;
  readonly now: number;
  readonly idleMs: number;
  /** Generations the open turn started that have not landed or failed yet. */
  readonly runsInFlight: number;
}

/** What a tool call into the chat does: join the open turn, settle it and open a new one, or open one. */
export const outsideTurn = (input: OutsideTurnInput): OutsideTurnAction => {
  if (!input.openTurn) return "open";
  if (input.runsInFlight > 0) return "continue";
  if (input.lastCallAt !== undefined && input.now - input.lastCallAt <= input.idleMs) return "continue";
  return "settle-then-open";
};

/** Whether the open turn settles now, on the timer alone: no call in the idle time and no run in flight. */
export const outsideTurnSettlesAt = (input: Omit<OutsideTurnInput, "now">): number | undefined => {
  if (!input.openTurn || input.runsInFlight > 0 || input.lastCallAt === undefined) return undefined;
  return input.lastCallAt + input.idleMs;
};
