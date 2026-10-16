import { describe, expect, it } from "vitest";
import { NO_PRICE_REFUSAL, periodStart, spendLimitProblem, spendRefusal, spentSince } from "../../src/index.ts";

const now = new Date(2026, 9, 14, 15, 30); // Wednesday, 14 October 2026, local time
const made = new Date(2026, 9, 1, 9, 0);

describe("the spend limit a person types", () => {
  it.each([
    [{ usd: undefined, period: undefined }, undefined],
    [{ usd: 5, period: "day" as const }, undefined],
    [{ usd: 0, period: "day" as const }, "Enter an amount above zero, or leave it empty for no limit."],
    [{ usd: -1, period: "day" as const }, "Enter an amount above zero, or leave it empty for no limit."],
    [{ usd: 0.001, period: "day" as const }, "Enter an amount above zero, or leave it empty for no limit."],
    [{ usd: 5, period: undefined }, "Choose a period for the limit."],
  ])("checks %j", (limit, problem) => {
    expect(spendLimitProblem(limit)).toBe(problem);
  });
});

describe("period boundaries, in local time", () => {
  it("starts a day at midnight, a week on Monday, a month on the first, and a lifetime at the connection's start", () => {
    expect(periodStart("day", now, made)).toEqual(new Date(2026, 9, 14));
    expect(periodStart("week", now, made)).toEqual(new Date(2026, 9, 12));
    expect(periodStart("month", now, made)).toEqual(new Date(2026, 9, 1));
    expect(periodStart("lifetime", now, made)).toEqual(made);
  });

  it("starts the week on Monday when the day is a Monday", () => {
    expect(periodStart("week", new Date(2026, 9, 12, 8), made)).toEqual(new Date(2026, 9, 12));
  });
});

describe("spend in a period", () => {
  it("sums the entries that fall in the period, reserved or landed", () => {
    const entries = [
      { runId: "a", at: new Date(2026, 9, 13, 23).toISOString(), usd: 1, state: "landed" as const },
      { runId: "b", at: new Date(2026, 9, 14, 10).toISOString(), usd: 0.5, state: "reserved" as const },
    ];
    expect(spentSince(entries, periodStart("day", now, made))).toBe(0.5);
    expect(spentSince(entries, periodStart("week", now, made))).toBe(1.5);
  });
});

describe("whether a paid call may start", () => {
  it("lets any call through with no limit", () => {
    expect(spendRefusal({ limit: null, spent: 99, reserved: 0, estimate: null })).toBeUndefined();
  });

  it("refuses a call with no exact price when an amount is set", () => {
    expect(spendRefusal({ limit: { usd: 5, period: "day" }, spent: 0, reserved: 0, estimate: null })).toBe(NO_PRICE_REFUSAL);
  });

  it("refuses the call that would pass the limit, with the amounts and the period", () => {
    expect(spendRefusal({ limit: { usd: 5, period: "day" }, spent: 4.2, reserved: 0.5, estimate: 0.4 })).toBe(
      "This connection has spent $4.20 of its $5.00 limit per day, and this run would pass it. Raise the limit in Unframed's Settings, or wait until the period starts again. A dry run still works.",
    );
  });

  it("lets a call that lands exactly on the limit through", () => {
    expect(spendRefusal({ limit: { usd: 5, period: "lifetime" }, spent: 4.6, reserved: 0, estimate: 0.4 })).toBeUndefined();
  });

  it("names a lifetime limit as for its whole life", () => {
    expect(spendRefusal({ limit: { usd: 1, period: "lifetime" }, spent: 1, reserved: 0, estimate: 0.1 })).toContain("limit for its whole life");
  });
});
