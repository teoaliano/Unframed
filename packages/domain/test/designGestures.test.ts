import { describe, expect, it } from "vitest";
import {
  cursorOf,
  distanceBetween,
  gapFromDrag,
  handlesOf,
  isLayoutContainer,
  opacityOfDigit,
  paddingFromDrag,
  radiusFromDrag,
  reorderIndex,
  resizeFromDrag,
  zoneAt,
  type LayoutOf,
} from "../src/index.ts";

const header: LayoutOf = {
  box: { x: 0, y: 0, w: 359, h: 48 },
  display: "flex",
  direction: "row",
  padding: { top: 0, right: 8, bottom: 0, left: 14 },
  gap: 4,
  radius: 0,
  text: false,
  children: [
    { x: 14, y: 14, w: 20, h: 20 },
    { x: 38, y: 14, w: 200, h: 20 },
    { x: 242, y: 10, w: 28, h: 28 },
  ],
};

const bubble: LayoutOf = { box: { x: 100, y: 100, w: 265, h: 140 }, display: "block", direction: "row", padding: { top: 12, right: 12, bottom: 12, left: 12 }, gap: 0, radius: 18, text: false, children: [] };

describe("drags", () => {
  it("moves padding one pixel per pixel, inward from each side, never below zero", () => {
    expect(paddingFromDrag("left", 8, { x: 12, y: 0 })).toBe(20);
    expect(paddingFromDrag("right", 8, { x: -6, y: 3 })).toBe(14);
    expect(paddingFromDrag("top", 0, { x: 0, y: 5 })).toBe(5);
    expect(paddingFromDrag("bottom", 10, { x: 0, y: -4 })).toBe(14);
    expect(paddingFromDrag("left", 8, { x: -30, y: 0 })).toBe(0);
  });

  it("moves the gap two pixels per pixel along the main axis", () => {
    expect(gapFromDrag("row", 4, { x: 12, y: 40 })).toBe(28);
    expect(gapFromDrag("column", 8, { x: 40, y: 3 })).toBe(14);
    expect(gapFromDrag("row", 4, { x: -10, y: 0 })).toBe(0);
  });

  it("follows the dragged edge, and a corner sets both sides", () => {
    const box = { x: 0, y: 0, w: 264.8, h: 140 };
    expect(resizeFromDrag({ kind: "edge", side: "left" }, box, { x: 18, y: 5 })).toEqual({ w: 246.8, h: 140 });
    expect(resizeFromDrag({ kind: "edge", side: "bottom" }, { x: 0, y: 0, w: 359, h: 48 }, { x: 0, y: 12 })).toEqual({ w: 359, h: 60 });
    expect(resizeFromDrag({ kind: "corner", corner: "se" }, box, { x: 20, y: 16 })).toEqual({ w: 284.8, h: 156 });
    expect(resizeFromDrag({ kind: "corner", corner: "nw" }, box, { x: 300, y: -10 })).toEqual({ w: 0, h: 150 });
  });

  it("sets the radius from the distance moved inward along the diagonal, up to half the shorter side", () => {
    const box = { x: 0, y: 0, w: 265, h: 140 };
    expect(radiusFromDrag("se", 18, box, { x: -12, y: -12 })).toBe(30);
    expect(radiusFromDrag("nw", 18, box, { x: 10, y: 6 })).toBe(26);
    expect(radiusFromDrag("ne", 18, box, { x: 4, y: -4 })).toBe(14);
    expect(radiusFromDrag("se", 18, box, { x: -200, y: -200 })).toBe(70);
    expect(radiusFromDrag("sw", 4, box, { x: -20, y: 20 })).toBe(0);
  });

  it("finds the slot whose midpoint the pointer passed on the main axis", () => {
    const row = [
      { x: 0, y: 0, w: 20, h: 20 },
      { x: 24, y: 0, w: 100, h: 20 },
      { x: 128, y: 0, w: 28, h: 28 },
      { x: 160, y: 0, w: 28, h: 28 },
      { x: 192, y: 0, w: 28, h: 28 },
    ];
    expect(reorderIndex(row, 2, { x: 176, y: 10 }, "row")).toBe(3);
    expect(reorderIndex(row, 2, { x: 170, y: 10 }, "row")).toBe(2);
    expect(reorderIndex(row, 2, { x: 5, y: 10 }, "row")).toBe(0);
    expect(reorderIndex(row, 2, { x: 500, y: 10 }, "row")).toBe(4);
    const column = [
      { x: 0, y: 0, w: 50, h: 30 },
      { x: 0, y: 30, w: 50, h: 30 },
    ];
    expect(reorderIndex(column, 0, { x: 0, y: 50 }, "column")).toBe(1);
  });

  it("maps digits to opacity, 1 to 10% and 0 to 100%", () => {
    expect(opacityOfDigit("1")).toBe(0.1);
    expect(opacityOfDigit("5")).toBe(0.5);
    expect(opacityOfDigit("0")).toBe(1);
    expect(opacityOfDigit("a")).toBeUndefined();
  });
});

describe("handles", () => {
  it("knows flex and grid containers", () => {
    expect(isLayoutContainer("flex")).toBe(true);
    expect(isLayoutContainer("inline-grid")).toBe(true);
    expect(isLayoutContainer("block")).toBe(false);
  });

  it("puts padding bars on padded sides of 4px or more and gap bars between children", () => {
    const handles = handlesOf(header);
    expect(handles.padding.map((bar) => [bar.side, bar.value])).toEqual([
      ["right", 8],
      ["left", 14],
    ]);
    const left = handles.padding.find((bar) => bar.side === "left")!;
    expect(left.area).toEqual({ x: 0, y: 0, w: 14, h: 48 });
    expect(left.box).toEqual({ x: 5, y: 17, w: 4, h: 14 });
    expect(handles.gaps.map((bar) => [bar.index, bar.value])).toEqual([
      [0, 4],
      [1, 4],
    ]);
    expect(handles.gaps[0]!.area).toEqual({ x: 34, y: 0, w: 4, h: 48 });
    expect(handles.gaps[0]!.box).toEqual({ x: 34, y: 17, w: 4, h: 14 });
    expect(handles.radius).toBe(true);
  });

  it("shows no bars on a block and no radius on text or tiny elements", () => {
    expect(handlesOf(bubble)).toEqual({ padding: [], gaps: [], radius: true });
    expect(handlesOf({ ...bubble, text: true }).radius).toBe(false);
    expect(handlesOf({ ...bubble, box: { x: 0, y: 0, w: 20, h: 100 } }).radius).toBe(false);
  });

  it("tells each zone and its cursor", () => {
    expect(zoneAt(bubble, { x: 50, y: 50 })).toEqual({ kind: "outside" });
    expect(zoneAt(bubble, { x: 200, y: 170 })).toEqual({ kind: "inside" });
    expect(zoneAt(bubble, { x: 102, y: 170 })).toEqual({ kind: "edge", side: "left" });
    expect(zoneAt(bubble, { x: 200, y: 239 })).toEqual({ kind: "edge", side: "bottom" });
    expect(zoneAt(bubble, { x: 101, y: 101 })).toEqual({ kind: "corner", corner: "nw" });
    expect(zoneAt(bubble, { x: 365 - 18, y: 240 - 18 })).toEqual({ kind: "radius", corner: "se" });
    expect(zoneAt(header, { x: 7, y: 24 })).toEqual({ kind: "padding", side: "left" });
    expect(zoneAt(header, { x: 36, y: 24 })).toEqual({ kind: "gap", index: 0, direction: "row" });
    expect(zoneAt(bubble, { x: 96, y: 170 }, 0.5)).toEqual({ kind: "edge", side: "left" });
    expect(cursorOf({ kind: "edge", side: "left" })).toBe("ew-resize");
    expect(cursorOf({ kind: "edge", side: "top" })).toBe("ns-resize");
    expect(cursorOf({ kind: "corner", corner: "se" })).toBe("nwse-resize");
    expect(cursorOf({ kind: "corner", corner: "ne" })).toBe("nesw-resize");
    expect(cursorOf({ kind: "radius", corner: "sw" })).toBe("nwse-resize");
    expect(cursorOf({ kind: "padding", side: "bottom" })).toBe("ns-resize");
    expect(cursorOf({ kind: "gap", index: 0, direction: "row" })).toBe("ew-resize");
    expect(cursorOf({ kind: "gap", index: 0, direction: "column" })).toBe("ns-resize");
    expect(cursorOf({ kind: "inside" })).toBe("default");
  });
});

describe("distances", () => {
  it("measures the gap between two boxes side by side or one above the other", () => {
    expect(distanceBetween({ x: 0, y: 0, w: 10, h: 10 }, { x: 64, y: 0, w: 10, h: 20 })).toEqual({ from: { x: 10, y: 5 }, to: { x: 64, y: 5 }, px: 54 });
    expect(distanceBetween({ x: 0, y: 100, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 51 })).toEqual({ from: { x: 5, y: 100 }, to: { x: 5, y: 51 }, px: 49 });
  });

  it("measures the nearest inner edge when one box holds the other, and nothing when they overlap", () => {
    expect(distanceBetween({ x: 10, y: 20, w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ from: { x: 10, y: 25 }, to: { x: 0, y: 25 }, px: 10 });
    expect(distanceBetween({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBeUndefined();
  });
});
