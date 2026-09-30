import { describe, expect, it } from "vitest";
import { placeResults } from "../src/index.ts";

const anchor = { x: 100, y: 200, w: 300, h: 150 };

describe("where results land", () => {
  it("lays outputs in one row, 40 right of the anchor, 24 apart, top-aligned", () => {
    expect(placeResults(anchor, [{ w: 320, h: 320 }, { w: 320, h: 480 }, { w: 200, h: 100 }], [])).toEqual([
      { x: 440, y: 200 },
      { x: 784, y: 200 },
      { x: 1128, y: 200 },
    ]);
  });

  it("ignores shapes the row does not touch", () => {
    expect(placeResults(anchor, [{ w: 320, h: 320 }], [anchor, { x: 440, y: -400, w: 100, h: 100 }, { x: 761, y: 200, w: 10, h: 10 }])).toEqual([{ x: 440, y: 200 }]);
  });

  it("steps the whole row down by 48 until it is clear", () => {
    const blocker = { x: 500, y: 150, w: 100, h: 150 };
    // The row spans y 200 to 520; it clears the blocker once its top is at or below 300.
    expect(placeResults(anchor, [{ w: 320, h: 320 }], [blocker])).toEqual([{ x: 440, y: 344 }]);
  });

  it("clears every blocker, whichever output it would hit", () => {
    const blockers = [
      { x: 900, y: 200, w: 50, h: 50 },
      { x: 450, y: 500, w: 50, h: 50 },
    ];
    // Two 320 squares span x 440 to 1104; the first blocker hits the second output.
    const placed = placeResults(anchor, [{ w: 320, h: 320 }, { w: 320, h: 320 }], blockers);
    expect(placed).toEqual([
      { x: 440, y: 584 },
      { x: 784, y: 584 },
    ]);
  });

  it("gives up after 200 steps and uses the last position", () => {
    const wall = { x: 0, y: 0, w: 5000, h: 100_000 };
    expect(placeResults(anchor, [{ w: 320, h: 320 }], [wall])).toEqual([{ x: 440, y: 200 + 200 * 48 }]);
  });

  it("answers nothing for no outputs", () => {
    expect(placeResults(anchor, [], [])).toEqual([]);
  });
});
