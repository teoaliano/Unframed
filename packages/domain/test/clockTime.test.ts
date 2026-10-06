import { describe, expect, it } from "vitest";
import { clockTime } from "../src/index.ts";

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
