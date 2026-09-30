import { boxesOverlap, type Box, type Size } from "./grouping.ts";

const GAP_FROM_ANCHOR = 40;
const GAP_BETWEEN = 24;
const STEP_DOWN = 48;
const MAX_STEPS = 200;

/**
 * Where a run's outputs land: one row in run order, left to right, 24 apart, starting 40
 * right of the anchor and top-aligned with it. While the row's bounds hit an existing
 * shape the row moves down 48 at a time, up to 200 steps, and then stays at the last one.
 */
export const placeResults = (anchor: Box, sizes: ReadonlyArray<Size>, existing: ReadonlyArray<Box>): Array<{ x: number; y: number }> => {
  if (sizes.length === 0) return [];
  const left = anchor.x + anchor.w + GAP_FROM_ANCHOR;
  const xs: number[] = [];
  let x = left;
  for (const size of sizes) {
    xs.push(x);
    x += size.w + GAP_BETWEEN;
  }
  const width = x - GAP_BETWEEN - left;
  const height = Math.max(...sizes.map((size) => size.h));
  let y = anchor.y;
  for (let step = 0; step < MAX_STEPS; step++) {
    const row = { x: left, y, w: width, h: height };
    if (!existing.some((box) => boxesOverlap(row, box))) break;
    y += STEP_DOWN;
  }
  return xs.map((at) => ({ x: at, y }));
};
