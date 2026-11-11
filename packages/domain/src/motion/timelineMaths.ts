
export const FRAME_RATE = 30;
const SNAP_PIXELS = 8;
const LABEL_PIXELS = 64;

export const ZOOM_LIMITS = {
  minFraction: 0.1,
  max: 1440,
  rate: Math.log(1.2) / 100,
} as const;

export interface SnapTarget {
  readonly priority: number;
  readonly time: number;
}

export const frameOf = (seconds: number): number => Math.floor(seconds * FRAME_RATE + 1e-9);

export const millis = (seconds: number): number => Math.round(seconds * 1000) / 1000;

export const readout = (seconds: number): string => {
  const centiseconds = Math.floor(seconds * 100 + 1e-6);
  const minutes = Math.floor(centiseconds / 6000);
  const secs = Math.floor(centiseconds / 100) % 60;
  const hundredths = centiseconds % 100;
  return `${minutes}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
};

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

interface SnapOptions {
  readonly targets: readonly SnapTarget[];
  readonly pxPerSecond: number;
  readonly free?: boolean;
}

export function snapTime(candidate: number, options: SnapOptions): { time: number; guide: boolean } {
  if (options.free === true) return { time: millis(candidate), guide: false };
  const target = inReach(candidate, options.targets, SNAP_PIXELS / options.pxPerSecond);
  if (target !== null) return { time: target.time, guide: true };
  return { time: millis(Math.round(candidate * FRAME_RATE) / FRAME_RATE), guide: false };
}

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

export const fitZoom = (viewport: number, length: number): number => viewport / length;

interface ZoomView {
  readonly pxPerSecond: number;
  readonly scrollLeft: number;
}

const clampZoom = (pxPerSecond: number, fit: number): number =>
  Math.min(ZOOM_LIMITS.max, Math.max(fit * ZOOM_LIMITS.minFraction, pxPerSecond));

export function zoomAt(view: ZoomView, step: { deltaY: number; cursorX: number; fit: number }): ZoomView {
  const pxPerSecond = clampZoom(view.pxPerSecond * Math.exp(-step.deltaY * ZOOM_LIMITS.rate), step.fit);
  const anchorTime = (view.scrollLeft + step.cursorX) / view.pxPerSecond;
  return { pxPerSecond, scrollLeft: anchorTime * pxPerSecond - step.cursorX };
}

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

export const rulerStep = (pxPerSecond: number): number =>
  RULER_STEPS.find((step) => step * pxPerSecond >= LABEL_PIXELS) ?? 10;

export type DialLimit = { readonly kind: "range"; readonly min: number; readonly max: number; readonly step?: number } | { readonly kind: "number"; readonly value: number };

export function clampDialValue(entry: DialLimit, value: number): number {
  if (entry.kind === "number") return Math.max(0, value);
  const stepped = entry.step !== undefined && entry.step > 0 ? entry.min + Math.round((value - entry.min) / entry.step) * entry.step : value;
  return Math.min(entry.max, Math.max(entry.min, stepped));
}

export const dragDialValue = clampDialValue;
