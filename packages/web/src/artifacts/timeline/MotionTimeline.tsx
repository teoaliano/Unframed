/**
 * The timeline strip under a motion in the editor (spec 21): the transport row, the ruler and the
 * rows. The strip's frame (its height, its resize by the top border, Hide and Show), its transport,
 * the ruler (scrub, labels, the loop range and the end marker) and the zoom are here. The rows come
 * in the tasks after these.
 */
import { ChevronLeft, ChevronRight, Maximize2, PanelBottom, Pause, Play, Repeat, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { fitZoom, rulerStep, zoomAt, zoomButton } from "@unframed/domain";
import { Button } from "~/components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { Toggle } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";
import { Tip } from "../../chrome/ui.tsx";
import type { EngineConnection } from "../../rpc/engine.ts";
import { TIMELINE_MIN_HEIGHT, clampTimelineHeight, useTimelinePrefs } from "./timelinePrefs.ts";
import { MotionTransport, SPEEDS, readoutParts } from "./transport.ts";

/** The transport row alone, which is what Hide leaves showing. */
const TRANSPORT_HEIGHT = 40;

/** A label on the ruler, in seconds: `0 s`, `0.5 s`, `10 s`. */
const tickLabel = (seconds: number): string => `${Number(seconds.toFixed(2))} s`;

export interface MotionTimelineProps {
  /** The motion's title, which names the region. */
  readonly title: string;
  readonly engine: EngineConnection;
  /** The editor's column height, which caps the strip at 60 % of it. Zero until it is measured. */
  readonly column: number;
  /** The transport the editor made for this motion's player. */
  readonly transport: MotionTransport;
  readonly className?: string;
}

export const MotionTimeline = ({ title, engine, column, transport, className }: MotionTimelineProps) => {
  const [prefs, save] = useTimelinePrefs(engine);
  const { open } = prefs;
  const transportState = useSyncExternalStore(transport.subscribe, transport.getSnapshot);
  const { playing, speed, muted, loop, length, range } = transportState;

  // A resize drag: the start, and the height it has reached. Saved once, on release.
  const drag = useRef<{ startY: number; startHeight: number; latest: number } | null>(null);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const height = open ? clampTimelineHeight(dragging ?? prefs.height, column) : TRANSPORT_HEIGHT;

  // The zoom: null is fit (the whole length in the strip's width, which opens the strip), else pixels a second.
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const fit = width > 0 && length > 0 ? fitZoom(width, length) : 0;
  const pxPerSecond = zoom ?? fit;
  // The clock reads the zoom from here, outside React, and the zoom handlers read the fit the same way.
  const pxRef = useRef(pxPerSecond);
  pxRef.current = pxPerSecond;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  // A zoom moves the scroll too: applied once the track has its new width.
  const pendingScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingScroll.current === null || !scroller.current) return;
    scroller.current.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  });

  // The playhead and the readout are drawn here, by the transport's clock, and not by React (spec 21, the clock).
  const clock = useRef<HTMLSpanElement>(null);
  const frame = useRef<HTMLSpanElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transport.setPainter((time, total) => {
      const parts = readoutParts(time, total);
      if (clock.current) clock.current.textContent = parts.clock;
      if (frame.current) frame.current.textContent = parts.frame;
      if (playhead.current) playhead.current.style.transform = `translateX(${time * pxRef.current}px)`;
    });
    return () => transport.setPainter(undefined);
  }, [transport]);
  // A zoom or a resize moves the playhead's place on the track.
  useEffect(() => {
    transport.repaint();
  }, [transport, pxPerSecond]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);
  // Ctrl or Cmd with the wheel (a trackpad's pinch sends the same) zooms around the cursor. The page is not scrolled.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || fitRef.current <= 0) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const next = zoomAt({ pxPerSecond: pxRef.current, scrollLeft: element.scrollLeft }, { deltaY: event.deltaY, cursorX: event.clientX - rect.left, fit: fitRef.current });
      setZoom(next.pxPerSecond);
      pendingScroll.current = next.scrollLeft;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [open]);

  const zoomBy = (direction: "in" | "out") => {
    const element = scroller.current;
    if (!element || fitRef.current <= 0) return;
    const next = zoomButton({ pxPerSecond: pxRef.current, scrollLeft: element.scrollLeft, viewport: element.clientWidth, playhead: transport.current(), fit: fitRef.current }, direction);
    setZoom(next.pxPerSecond);
    pendingScroll.current = next.scrollLeft;
  };
  const fitToLength = () => {
    setZoom(null);
    pendingScroll.current = 0;
  };

  // Scrubbing: a press or a drag on the ruler seeks by a drag seek while it moves, and commits on release (spec 21, the clock).
  const scrubbing = useRef(false);
  const timeUnder = (clientX: number): number => {
    const element = track.current;
    if (!element || pxRef.current <= 0) return 0;
    const at = (clientX - element.getBoundingClientRect().left) / pxRef.current;
    return Math.min(length, Math.max(0, at));
  };
  const onRulerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || length <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbing.current = true;
    transport.pause();
    transport.seek(timeUnder(event.clientX), "drag");
  };
  const onRulerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) transport.seek(timeUnder(event.clientX), "drag");
  };
  const onRulerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    transport.seek(timeUnder(event.clientX), "commit");
  };

  // A resize drag on the top border.
  const onResizeDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // Pointer capture keeps the moves on the handle while the pointer leaves it.
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: height, latest: height };
    setDragging(height);
  };
  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null) return;
    current.latest = clampTimelineHeight(current.startHeight - (event.clientY - current.startY), column);
    setDragging(current.latest);
  };
  const onResizeUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null) return;
    drag.current = null;
    setDragging(undefined);
    if (current.latest !== prefs.height) save({ height: current.latest, open: true });
  };

  // The loop range shades the ruler between its In and Out (or the ends it does not set).
  const showRange = (range.start !== null || range.end !== null) && length > 0;
  const rangeStart = range.start ?? 0;
  const rangeEnd = range.end ?? length;
  // The ruler's ticks, one step apart on the track, and the track's width: the length at this zoom, or the strip's width when that is more.
  const step = pxPerSecond > 0 ? rulerStep(pxPerSecond) : 1;
  const ticks: number[] = [];
  for (let at = 0; length > 0 && at <= length + 1e-9; at += step) ticks.push(Math.round(at * 1000) / 1000);
  const trackWidth = Math.max(length * pxPerSecond, width);

  return (
    <section
      aria-label={`Timeline for ${title}`}
      data-testid="motion-timeline"
      data-open={open ? "true" : "false"}
      style={{ height }}
      className={cn("relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card", className)}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the timeline"
          aria-valuemin={TIMELINE_MIN_HEIGHT}
          aria-valuenow={height}
          className="absolute inset-x-0 top-0 z-20 h-2 cursor-row-resize touch-none"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
        />
      )}
      <header data-testid="timeline-transport" className="flex h-10 flex-none items-center gap-1 border-b px-2">
        <Tip label={playing ? "Pause (Space)" : "Play (Space)"}>
          <Button variant="ghost" size="icon-sm" aria-label={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => transport.togglePlay()}>
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          </Button>
        </Tip>
        <Tip label="Previous frame (←)">
          <Button variant="ghost" size="icon-sm" aria-label="Previous frame (←)" onClick={() => transport.step(-1)}>
            <ChevronLeft aria-hidden />
          </Button>
        </Tip>
        <Tip label="Next frame (→)">
          <Button variant="ghost" size="icon-sm" aria-label="Next frame (→)" onClick={() => transport.step(1)}>
            <ChevronRight aria-hidden />
          </Button>
        </Tip>
        <div data-testid="timeline-readout" className="ml-2 flex items-baseline gap-2 whitespace-nowrap font-mono text-sm tabular-nums">
          <span ref={clock} />
          <span ref={frame} className="text-muted-foreground" />
        </div>
        <div className="ml-auto flex items-center gap-1">
          {open && (
            <Menu>
              <MenuTrigger render={<Button variant="outline" size="compact" aria-label="Playback speed" />}>{`${speed}x`}</MenuTrigger>
              <MenuPopup align="end" side="top">
                <MenuRadioGroup value={String(speed)} onValueChange={(value) => transport.setSpeed(Number(value))}>
                  {SPEEDS.map((choice) => (
                    <MenuRadioItem key={choice} value={String(choice)} closeOnClick>
                      {`${choice}x`}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
          )}
          {open && (
            <Tip label="Loop (Shift+L)">
              <Toggle aria-label="Loop (Shift+L)" pressed={loop} onPressedChange={(on) => transport.setLoop(on)} size="sm" variant="default">
                <Repeat aria-hidden />
              </Toggle>
            </Tip>
          )}
          {open && (
            <Tip label={muted ? "Unmute (M)" : "Mute (M)"}>
              <Button variant="ghost" size="icon-sm" aria-label={muted ? "Unmute (M)" : "Mute (M)"} onClick={() => transport.setMuted(!muted)}>
                {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
              </Button>
            </Tip>
          )}
          {open && (
            <>
              <Tip label="Zoom out">
                <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => zoomBy("out")}>
                  <ZoomOut aria-hidden />
                </Button>
              </Tip>
              <Tip label="Zoom in">
                <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoomBy("in")}>
                  <ZoomIn aria-hidden />
                </Button>
              </Tip>
              <Tip label="Fit to length">
                <Button variant="ghost" size="icon-sm" aria-label="Fit to length" onClick={fitToLength}>
                  <Maximize2 aria-hidden />
                </Button>
              </Tip>
            </>
          )}
          <Tip label={open ? "Hide timeline" : "Show timeline"}>
            <Button variant="ghost" size="icon-sm" aria-label={open ? "Hide timeline" : "Show timeline"} onClick={() => save({ height: prefs.height, open: !open })}>
              <PanelBottom aria-hidden />
            </Button>
          </Tip>
        </div>
      </header>
      {open && (
        // The time area: its focus is where the transport's keys act, with the ruler and the rows (spec 21, the shortcuts).
        <div data-timeline-focus tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          {/* The scroller scrolls the time (Shift and the wheel) and the rows (the wheel); the ruler stays on top. */}
          <div ref={scroller} data-testid="timeline-scroll" className="relative min-h-0 flex-1 overflow-auto">
            <div ref={track} data-testid="timeline-track" data-px-per-second={pxPerSecond} className="relative flex min-h-full flex-col" style={{ width: trackWidth }}>
              <div
                data-testid="timeline-ruler"
                className="sticky top-0 z-10 h-6 flex-none touch-none border-b bg-card"
                onPointerDown={onRulerDown}
                onPointerMove={onRulerMove}
                onPointerUp={onRulerUp}
                onPointerCancel={onRulerUp}
              >
                {showRange && (
                  <div
                    data-testid="timeline-range"
                    data-in={range.start ?? undefined}
                    data-out={range.end ?? undefined}
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 bg-primary/15"
                    style={{ left: rangeStart * pxPerSecond, width: Math.max(0, rangeEnd - rangeStart) * pxPerSecond }}
                  />
                )}
                {ticks.map((at) => (
                  <span key={at} data-testid="timeline-tick" data-time={at} aria-hidden className="pointer-events-none absolute inset-y-0 border-l pl-1 text-[10px] leading-6 text-muted-foreground" style={{ left: at * pxPerSecond }}>
                    {tickLabel(at)}
                  </span>
                ))}
                {length > 0 && (
                  <span data-testid="timeline-end" className="pointer-events-none absolute inset-y-0 border-l-2 border-foreground pl-1 text-[10px] leading-6 font-medium" style={{ left: length * pxPerSecond }}>
                    {tickLabel(length)}
                  </span>
                )}
              </div>
              <div data-testid="timeline-rows" className="min-h-0 flex-1" />
              {length > 0 && length * pxPerSecond < trackWidth && (
                <div data-testid="timeline-past-end" aria-hidden className="pointer-events-none absolute inset-y-0 bg-background/60" style={{ left: length * pxPerSecond, right: 0 }} />
              )}
              <div ref={playhead} data-testid="timeline-playhead" aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-px bg-primary" />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
