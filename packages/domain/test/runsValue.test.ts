import { describe, expect, it } from "vitest";
import { clampRuns, readRunsValue, RUNS_CAP, runsDraft } from "../src/index.ts";

describe("the runs value", () => {
  it("caps a run at 10 outputs", () => {
    expect(RUNS_CAP).toBe(10);
  });

  it.each<[string, string | number, number]>([
    ["a count in range", "4", 4],
    ["the cap", "10", 10],
    ["above the cap", "15", 10],
    ["zero", "0", 1],
    ["nothing typed", "", 1],
    ["letters", "abc", 1],
    ["digits among letters", "a3b", 3],
    ["more than two digits keeps the first two", "123", 10],
    ["a decimal loses its point", "2.6", 10],
    ["a negative loses its sign", "-3", 3],
    ["a number is rounded", 2.6, 3],
    ["a number below one", -4, 1],
    ["a number above the cap", 40, 10],
    ["not a number", Number.NaN, 1],
  ])("clamps %s", (_case, typed, count) => {
    expect(clampRuns(typed)).toBe(count);
  });

  it.each([
    ["digits only", "4x", "4"],
    ["at most two", "123", "12"],
    ["empty stays empty", "", ""],
    ["a decimal", "1.5", "15"],
  ])("keeps a draft of %s", (_case, typed, draft) => {
    expect(runsDraft(typed)).toBe(draft);
  });

  it.each<[string, unknown, number | "free"]>([
    ["a stored count", 4, 4],
    ["Free", "free", "free"],
    ["a count past the cap", 12, 10],
    ["nothing stored", undefined, 1],
    ["something unreadable", { runs: 3 }, 1],
    ["a count as text", "3", 3],
  ])("reads %s", (_case, stored, value) => {
    expect(readRunsValue(stored)).toBe(value);
  });
});
