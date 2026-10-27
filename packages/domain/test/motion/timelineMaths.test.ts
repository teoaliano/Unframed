import { describe, expect, it } from "vitest";
import {
  clampDialValue,
  dragDialValue,
  fitZoom,
  frameOf,
  readout,
  rulerStep,
  snapMove,
  snapTime,
  zoomAt,
  zoomButton,
  ZOOM_LIMITS,
} from "../../src/index.ts";

describe("frames", () => {
  it("counts whole frames at 30 fps", () => {
    expect(frameOf(0)).toBe(0);
    expect(frameOf(1)).toBe(30);
    expect(frameOf(0.5)).toBe(15);
    expect(frameOf(0.999)).toBe(29);
  });
});

describe("readouts", () => {
  it.each([
    [0, "0:00.00"],
    [1.5, "0:01.50"],
    [65.25, "1:05.25"],
    [3599.99, "59:59.99"],
  ])("formats %s seconds as %s", (seconds, text) => {
    expect(readout(seconds)).toBe(text);
  });

  it("floors centiseconds rather than rounding them up", () => {
    expect(readout(1.009)).toBe("0:01.00");
  });
});

describe("snapping", () => {
  const px = 100;

  it("snaps to the nearest target within 8 px, the playhead before a clip edge", () => {
    const playhead = { priority: 0, time: 1.0 };
    const clipEdge = { priority: 3, time: 1.02 };
    expect(snapTime(1.03, { targets: [clipEdge, playhead], pxPerSecond: px })).toEqual({ time: 1.0, guide: true });
  });

  it("uses the lower-priority target when no higher one is in reach", () => {
    expect(snapTime(2.04, { targets: [{ priority: 3, time: 2.0 }], pxPerSecond: px })).toEqual({ time: 2.0, guide: true });
  });

  it("falls back to the whole frame when nothing is in reach", () => {
    expect(snapTime(1.02, { targets: [{ priority: 0, time: 5 }], pxPerSecond: px })).toEqual({ time: 1.033, guide: false });
  });

  it("places freely to the millisecond when the free key is held", () => {
    expect(snapTime(1.0334, { targets: [{ priority: 0, time: 1.0 }], pxPerSecond: px, free: true })).toEqual({ time: 1.033, guide: false });
  });

  it("tolerance follows the zoom: 8 px is more seconds when the strip is zoomed out", () => {
    expect(snapTime(1.2, { targets: [{ priority: 0, time: 1 }], pxPerSecond: 10 })).toEqual({ time: 1, guide: true });
    expect(snapTime(1.2, { targets: [{ priority: 0, time: 1 }], pxPerSecond: 400 })).toEqual({ time: 1.2, guide: false });
  });

  it("snaps a move by whichever edge is nearer a target", () => {
    const targets = [{ priority: 0, time: 4.0 }];
    // start at 3.98 (2 px from 4.0) and end at 5.5: the start edge snaps, so the bar moves to start 4.0
    expect(snapMove(3.98, 1.52, { targets, pxPerSecond: px })).toEqual({ start: 4.0, guide: true });
    // the end edge 4.02 is in reach and the start 2.5 is not: the end snaps and the start moves with it
    expect(snapMove(2.5, 1.52, { targets: [{ priority: 0, time: 4.0 }], pxPerSecond: px })).toEqual({ start: 2.48, guide: true });
  });
});

describe("zoom", () => {
  it("multiplies by exp(-deltaY * 0.014) around the cursor", () => {
    const next = zoomAt({ pxPerSecond: 100, scrollLeft: 0 }, { deltaY: -10, cursorX: 200, fit: 10 });
    expect(next.pxPerSecond).toBeCloseTo(100 * Math.exp(0.14), 6);
    // the time under the cursor (2 s) stays under the cursor
    expect(2 * next.pxPerSecond - next.scrollLeft).toBeCloseTo(200, 6);
  });

  it("limits the zoom to 10% of fit at the low end and 1,440 px a second at the high end", () => {
    expect(zoomAt({ pxPerSecond: 100, scrollLeft: 0 }, { deltaY: 1000, cursorX: 0, fit: 50 }).pxPerSecond).toBe(5);
    expect(zoomAt({ pxPerSecond: 1000, scrollLeft: 0 }, { deltaY: -1000, cursorX: 0, fit: 50 }).pxPerSecond).toBe(ZOOM_LIMITS.max);
  });

  it("fits the whole length in the viewport", () => {
    expect(fitZoom(600, 6)).toBe(100);
  });

  it("zooms by 2x steps around the playhead when it is in view, else the centre", () => {
    expect(zoomButton({ pxPerSecond: 100, scrollLeft: 0, viewport: 600, playhead: 2, fit: 50 }, "in").pxPerSecond).toBe(200);
    expect(zoomButton({ pxPerSecond: 100, scrollLeft: 0, viewport: 600, playhead: 2, fit: 50 }, "out").pxPerSecond).toBe(50);
    const far = zoomButton({ pxPerSecond: 100, scrollLeft: 0, viewport: 600, playhead: 90, fit: 50 }, "in");
    expect(far.pxPerSecond).toBe(200);
    expect(far.scrollLeft).toBe(300);
  });
});

describe("ruler step", () => {
  it.each([
    [2000, 1 / 30],
    [200, 0.5],
    [100, 1],
    [60, 5],
    [10, 10],
  ])("keeps labels 64 px apart at %s px a second", (pxPerSecond, step) => {
    expect(rulerStep(pxPerSecond)).toBe(step);
  });
});

describe("dial limits for a drag", () => {
  it("stops a range dial at its min and max", () => {
    expect(dragDialValue({ kind: "range", min: 0, max: 2 }, 3)).toBe(2);
    expect(dragDialValue({ kind: "range", min: 0, max: 2 }, -1)).toBe(0);
  });

  it("rounds a range dial to its step", () => {
    expect(clampDialValue({ kind: "range", min: 0, max: 10, step: 0.5 }, 3.3)).toBe(3.5);
  });

  it("stops a plain number at 0", () => {
    expect(dragDialValue({ kind: "number", value: 1 }, -2)).toBe(0);
    expect(dragDialValue({ kind: "number", value: 1 }, 2.5)).toBe(2.5);
  });
});
