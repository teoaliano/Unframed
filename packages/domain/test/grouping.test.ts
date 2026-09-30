import { describe, expect, it } from "vitest";
import { clampGroupSize, mayBeGroupMember, wrapBox } from "../src/index.ts";

describe("wrapBox", () => {
  it("is the members' bounding box plus 28 left, right and bottom and 56 on top", () => {
    expect(
      wrapBox([
        { x: 100, y: 200, w: 240, h: 140 },
        { x: 400, y: 260, w: 100, h: 200 },
      ]),
    ).toEqual({ x: 72, y: 144, w: 456, h: 344 });
  });

  it("wraps one shape the same way", () => {
    expect(wrapBox([{ x: 0, y: 0, w: 300, h: 100 }])).toEqual({ x: -28, y: -56, w: 356, h: 184 });
  });

  it("grows to the minimum group size to the right and down", () => {
    expect(wrapBox([{ x: 10, y: 10, w: 40, h: 28 }])).toEqual({ x: -18, y: -46, w: 180, h: 112 });
  });

  it("wraps nothing when there are no members", () => {
    expect(wrapBox([])).toBeUndefined();
  });
});

describe("mayBeGroupMember", () => {
  it("lets prompts, images, videos and marks in", () => {
    for (const type of ["text", "image", "video", "draw", "geo", "arrow", "line", "highlight", "note"]) {
      expect(mayBeGroupMember(type)).toBe(true);
    }
  });

  it("keeps groups, pages, motions and tldraw's own group out", () => {
    for (const type of ["frame", "page", "motion", "group"]) {
      expect(mayBeGroupMember(type)).toBe(false);
    }
  });
});

describe("clampGroupSize", () => {
  it("keeps a group between 180 x 96 and 4000 x 4000", () => {
    expect(clampGroupSize({ w: 10, h: 10 })).toEqual({ w: 180, h: 96 });
    expect(clampGroupSize({ w: 5000, h: 4200 })).toEqual({ w: 4000, h: 4000 });
    expect(clampGroupSize({ w: 420, h: 280 })).toEqual({ w: 420, h: 280 });
  });
});
