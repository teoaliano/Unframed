const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 10_000;

/**
 * How long the web waits before its next reconnect attempt: 1 s, doubling, capped at
 * 10 s. `attempt` counts failed attempts since the last socket that opened.
 */
export const reconnectDelay = (attempt: number): number => Math.min(INITIAL_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
