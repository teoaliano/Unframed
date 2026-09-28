import { setRenderSink } from "./renders.ts";

/** One settled gesture: every frame gap while it ran, and which shape components rendered. */
export interface Gesture {
  readonly kind: "drag" | "wheel" | "keys";
  readonly frameTime: number;
  readonly gaps: number[];
  readonly median: number;
  /** Frames that took longer than one display frame, and longer than two. */
  readonly overOne: number;
  readonly overTwo: number;
  readonly renders: Record<string, number>;
}

const IDLE_FRAMES = 30;
/** A gesture ends this long after its last input, so trailing animation frames count too. */
const SETTLE_MS = 300;
/** A frame counts as late past this share of a display frame, which absorbs timer jitter. */
const LATE = 1.5;

const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/**
 * The `?fps=1` frame meter. It learns the display's frame time from idle frames, then
 * measures each gesture (a drag, a run of wheel events, a run of keys) from its first
 * input until it settles, and shows the last one in a small readout.
 */
const start = () => {
  let frameTime = 0;
  const idle: number[] = [];
  let last = 0;
  let current: { kind: Gesture["kind"]; gaps: number[]; renders: Record<string, number>; lastInput: number; dragging: boolean } | undefined;
  const settled: Gesture[] = [];

  const readout = document.createElement("div");
  readout.setAttribute("data-fps-meter", "");
  readout.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2000;padding:4px 8px;border-radius:6px;font:11px ui-monospace,monospace;pointer-events:none;background:var(--unframed-popover);color:var(--unframed-text-secondary);border:1px solid var(--unframed-border)";
  readout.textContent = "fps: learning";
  document.body.append(readout);

  const finish = () => {
    if (!current) return;
    const gaps = current.gaps;
    const gesture: Gesture = {
      kind: current.kind,
      frameTime,
      gaps,
      median: median(gaps),
      overOne: gaps.filter((gap) => gap > frameTime * LATE).length,
      overTwo: gaps.filter((gap) => gap > frameTime * (1 + LATE)).length,
      renders: current.renders,
    };
    settled.push(gesture);
    current = undefined;
    readout.textContent = `${gesture.kind}: median ${gesture.median.toFixed(1)} ms · over 1 frame ${gesture.overOne} · over 2 ${gesture.overTwo} · ${gaps.length} frames`;
  };

  const input = (kind: Gesture["kind"], dragging?: boolean) => {
    if (frameTime === 0) return;
    if (current && current.kind !== kind && !current.dragging) finish();
    current ??= { kind, gaps: [], renders: {}, lastInput: 0, dragging: false };
    current.lastInput = performance.now();
    if (dragging !== undefined) current.dragging = dragging;
  };

  const tick = (now: number) => {
    if (last !== 0) {
      const gap = now - last;
      if (frameTime === 0) {
        idle.push(gap);
        if (idle.length >= IDLE_FRAMES) {
          frameTime = median(idle);
          readout.textContent = `fps: frame ${frameTime.toFixed(1)} ms`;
        }
      } else if (current) {
        current.gaps.push(gap);
        if (!current.dragging && now - current.lastInput > SETTLE_MS) finish();
      }
    }
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  setRenderSink((shapeId) => {
    if (current) current.renders[shapeId] = (current.renders[shapeId] ?? 0) + 1;
  });

  const options = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", () => input("drag", true), options);
  window.addEventListener("pointermove", (event) => current?.dragging && event.buttons !== 0 && input("drag"), options);
  window.addEventListener("pointerup", () => current?.dragging && input("drag", false), options);
  window.addEventListener("wheel", () => input("wheel"), options);
  window.addEventListener("keydown", () => input("keys"), options);

  (window as Window & { __fps?: unknown }).__fps = {
    dump: (): Gesture[] => settled.slice(),
    frameTime: () => frameTime,
  };
};

start();
