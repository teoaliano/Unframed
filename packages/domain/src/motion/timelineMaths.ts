/**
 * Timeline maths (spec 21): frames, the transport's readout, snapping while a bar is dragged,
 * zoom around an anchor, the ruler's step, and the limits a dial drag stops at. Pure functions of
 * numbers, so the strip's pointer code is only the wiring.
 */

export const FRAME_RATE = 30;
/** Within this many pixels a dragged edge snaps to a target. */
const SNAP_PIXELS = 8;
/** Labels on the ruler keep at least this many pixels apart. */
const LABEL_PIXELS = 64;

export const ZOOM_LIMITS = {
  /** The lowest zoom, as a fraction of the zoom that fits the whole length. */
  minFraction: 0.1,
  /** The highest zoom: 48 px a frame. */
  max: 1440,
  /** A wheel or pinch step is exp(-deltaY * rate). */
  rate: 0.014,
} as const;

/** A thing a dragged edge may snap to. Lower priority wins when several are in reach. */
export interface SnapTarget {
  readonly priority: number;
  readonly time: number;
}

/** The whole frame a time is in at 30 fps. */
export const frameOf = (seconds: number): number => Math.floor(seconds * FRAME_RATE + 1e-9);

/** Seconds to the millisecond. */
const millis = (seconds: number): number => Math.round(seconds * 1000) / 1000;

/** `m:ss.cc` for the transport: minutes, seconds and centiseconds, with the centiseconds floored. */
export const readout = (seconds: number): string => {
  const centiseconds = Math.floor(seconds * 100 + 1e-6);
  const minutes = Math.floor(centiseconds / 6000);
  const secs = Math.floor(centiseconds / 100) % 60;
  const hundredths = centiseconds % 100;
  return `${minutes}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
};

/** The nearest target in reach, the highest priority first; null when none is in reach. */
const inReach = (time: number, targets: readonly SnapTarget[], reach: number): SnapTarget | null => {
  const priorities = [...new Set(targets.map((target) => target.priority))].sort((a, b) => a - b);
  for (const priority of priorities) {
    let best: SnapTarget | null = null;
    for (const target of targets) {
      if (target.priority !== priority || Math.abs(target.time - time) > reach) continue;
      if (best === null || Math.abs(target.time - time) < Math.abs(best.time - time)) best = target;
    }
    if (best !== null) return best;
  }
  return null;
};

export interface SnapOptions {
  readonly targets: readonly SnapTarget[];
  readonly pxPerSecond: number;
  /** The Alt (Option) key: place to the millisecond, snapping to nothing. */
  readonly free?: boolean;
}

/** A dragged time snapped to a target within 8 px, else to the whole frame; free to the millisecond. */
export function snapTime(candidate: number, options: SnapOptions): { time: number; guide: boolean } {
  if (options.free === true) return { time: millis(candidate), guide: false };
  const target = inReach(candidate, options.targets, SNAP_PIXELS / options.pxPerSecond);
  if (target !== null) return { time: target.time, guide: true };
  return { time: millis(Math.round(candidate * FRAME_RATE) / FRAME_RATE), guide: false };
}

/** A moved bar: whichever of its two edges is in reach of a target snaps, and the bar moves with it. */
export function snapMove(start: number, duration: number, options: SnapOptions): { start: number; guide: boolean } {
  if (options.free === true) return { start: millis(start), guide: false };
  const reach = SNAP_PIXELS / options.pxPerSecond;
  const startTarget = inReach(start, options.targets, reach);
  const endTarget = inReach(start + duration, options.targets, reach);
  const startDistance = startTarget ? Math.abs(startTarget.time - start) : Infinity;
  const endDistance = endTarget ? Math.abs(endTarget.time - (start + duration)) : Infinity;
  if (startTarget && startDistance <= endDistance) return { start: startTarget.time, guide: true };
  if (endTarget) return { start: millis(endTarget.time - duration), guide: true };
  return { start: snapTime(start, options).time, guide: false };
}

/** The zoom that shows the whole length in the viewport. */
export const fitZoom = (viewport: number, length: number): number => viewport / length;

export interface ZoomView {
  readonly pxPerSecond: number;
  readonly scrollLeft: number;
}

const clampZoom = (pxPerSecond: number, fit: number): number =>
  Math.min(ZOOM_LIMITS.max, Math.max(fit * ZOOM_LIMITS.minFraction, pxPerSecond));

/** A pinch or Ctrl+wheel step, around the time under the cursor, which stays under it. */
export function zoomAt(view: ZoomView, step: { deltaY: number; cursorX: number; fit: number }): ZoomView {
  const pxPerSecond = clampZoom(view.pxPerSecond * Math.exp(-step.deltaY * ZOOM_LIMITS.rate), step.fit);
  const anchorTime = (view.scrollLeft + step.cursorX) / view.pxPerSecond;
  return { pxPerSecond, scrollLeft: anchorTime * pxPerSecond - step.cursorX };
}

/** The zoom buttons: 2x steps around the playhead when it is in view, else around the centre. */
export function zoomButton(view: ZoomView & { readonly viewport: number; readonly playhead: number; readonly fit: number }, direction: "in" | "out"): ZoomView {
  const factor = direction === "in" ? 2 : 0.5;
  const playheadX = view.playhead * view.pxPerSecond - view.scrollLeft;
  const inView = playheadX >= 0 && playheadX <= view.viewport;
  const cursorX = inView ? playheadX : view.viewport / 2;
  const anchorTime = (view.scrollLeft + cursorX) / view.pxPerSecond;
  const pxPerSecond = clampZoom(view.pxPerSecond * factor, view.fit);
  return { pxPerSecond, scrollLeft: anchorTime * pxPerSecond - cursorX };
}

const RULER_STEPS = [1 / FRAME_RATE, 0.1, 0.5, 1, 5, 10];

/** The smallest time step whose labels keep 64 px apart; 10 s when even that is too close. */
export const rulerStep = (pxPerSecond: number): number =>
  RULER_STEPS.find((step) => step * pxPerSecond >= LABEL_PIXELS) ?? 10;

export type DialEntry = { readonly kind: "range"; readonly min: number; readonly max: number; readonly step?: number } | { readonly kind: "number"; readonly value: number };

/** A dial's value after a drag: a range stops at its min and max and rounds to its step; a number stops at 0. */
export function clampDialValue(entry: DialEntry, value: number): number {
  if (entry.kind === "number") return Math.max(0, value);
  const stepped = entry.step !== undefined && entry.step > 0 ? entry.min + Math.round((value - entry.min) / entry.step) * entry.step : value;
  return Math.min(entry.max, Math.max(entry.min, stepped));
}

export const dragDialValue = clampDialValue;
