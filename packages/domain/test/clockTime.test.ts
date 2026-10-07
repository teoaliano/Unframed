import { describe, expect, it } from "vitest";
import { clockTime, resetMoment } from "../src/index.ts";

describe("clock time", () => {
  it("reads hour and minute on a 12-hour clock with am or pm", () => {
    expect(clockTime(new Date(2026, 9, 1, 8, 0))).toBe("8:00 am");
    expect(clockTime(new Date(2026, 9, 1, 15, 5))).toBe("3:05 pm");
    expect(clockTime(new Date(2026, 9, 1, 23, 59))).toBe("11:59 pm");
  });

  it("calls midnight 12 am and noon 12 pm", () => {
    expect(clockTime(new Date(2026, 9, 1, 0, 30))).toBe("12:30 am");
    expect(clockTime(new Date(2026, 9, 1, 12, 0))).toBe("12:00 pm");
  });
});

describe("reset moment", () => {
  // Wednesday 30 September 2026, mid-morning.
  const now = new Date(2026, 8, 30, 10, 0);

  it("is the clock time alone when the reset is today", () => {
    expect(resetMoment(new Date(2026, 8, 30, 20, 5), now)).toBe("at 8:05 pm");
    expect(resetMoment(new Date(2026, 8, 30, 23, 59), now)).toBe("at 11:59 pm");
  });

  it("names the weekday when the reset is one to six days away", () => {
    expect(resetMoment(new Date(2026, 9, 1, 0, 30), now)).toBe("Thursday at 12:30 am");
    expect(resetMoment(new Date(2026, 9, 2, 8, 5), now)).toBe("Friday at 8:05 am");
    expect(resetMoment(new Date(2026, 9, 6, 9, 0), now)).toBe("Tuesday at 9:00 am");
  });

  it("gives the date when the reset is a week or more away, or already past", () => {
    expect(resetMoment(new Date(2026, 9, 7, 9, 0), now)).toBe("on 7 October at 9:00 am");
    expect(resetMoment(new Date(2026, 8, 29, 9, 0), now)).toBe("on 29 September at 9:00 am");
  });
});
