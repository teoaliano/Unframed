import { describe, expect, it } from "vitest";
import { OUTSIDE_TURN_IDLE_MS, outsideTurn, outsideTurnSettlesAt } from "../../src/index.ts";

const idle = 120_000;

describe("the outside turn rule", () => {
  it.each([
    ["no open turn opens one", { openTurn: false, lastCallAt: undefined, now: 0, runsInFlight: 0 }, "open"],
    ["a call within the idle time continues", { openTurn: true, lastCallAt: 0, now: idle, runsInFlight: 0 }, "continue"],
    ["a call after the idle time settles and opens the next", { openTurn: true, lastCallAt: 0, now: idle + 1, runsInFlight: 0 }, "settle-then-open"],
    ["a generation in flight keeps the turn open past the idle time", { openTurn: true, lastCallAt: 0, now: idle * 5, runsInFlight: 1 }, "continue"],
  ] as const)("%s", (_, input, action) => {
    expect(outsideTurn({ ...input, idleMs: idle })).toBe(action);
  });

  it("uses two minutes when no test shortens it", () => {
    expect(OUTSIDE_TURN_IDLE_MS).toBe(120_000);
  });
});

describe("when the open turn settles on the timer", () => {
  it("settles idle time after its last call", () => {
    expect(outsideTurnSettlesAt({ openTurn: true, lastCallAt: 1000, idleMs: idle, runsInFlight: 0 })).toBe(1000 + idle);
  });

  it("never settles while a generation is in flight", () => {
    expect(outsideTurnSettlesAt({ openTurn: true, lastCallAt: 1000, idleMs: idle, runsInFlight: 2 })).toBeUndefined();
  });

  it("has nothing to settle with no open turn", () => {
    expect(outsideTurnSettlesAt({ openTurn: false, lastCallAt: 1000, idleMs: idle, runsInFlight: 0 })).toBeUndefined();
  });
});
