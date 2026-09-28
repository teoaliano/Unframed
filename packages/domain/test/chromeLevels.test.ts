import { describe, expect, it } from "vitest";
import { gridGap, labelLevel } from "../src/index.ts";

describe("labelLevel", () => {
  it("hides labels below 0.5, shows them on hover up to 0.75, and always from there", () => {
    expect(labelLevel(0.1)).toBe("off");
    expect(labelLevel(0.49)).toBe("off");
    expect(labelLevel(0.5)).toBe("hover");
    expect(labelLevel(0.74)).toBe("hover");
    expect(labelLevel(0.75)).toBe("on");
    expect(labelLevel(4)).toBe("on");
  });
});

describe("gridGap", () => {
  it("is 26 canvas px while that is at least 16 screen px", () => {
    expect(gridGap(1)).toBe(26);
    expect(gridGap(0.7)).toBe(26);
  });

  it("doubles, repeatedly, while the gap is under 16 screen px", () => {
    expect(gridGap(0.5)).toBe(52);
    expect(gridGap(0.2)).toBe(104);
    expect(gridGap(0.1)).toBe(208);
  });

  it("never changes when zooming in", () => {
    expect(gridGap(2)).toBe(26);
    expect(gridGap(4)).toBe(26);
  });
});
