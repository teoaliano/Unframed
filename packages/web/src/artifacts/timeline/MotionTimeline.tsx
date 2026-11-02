/**
 * The timeline strip under a motion in the editor (spec 21): the transport row, the ruler and the
 * rows. The strip's frame (its height, its resize by the top border, Hide and Show) and its
 * transport are here. The ruler's scrub and zoom, and the rows, come in the tasks after these.
 */
import { ChevronLeft, ChevronRight, PanelBottom, Pause, Play, Repeat, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
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
  // A resize drag: the start, and the height it has reached. Saved once, on release.
  const drag = useRef<{ startY: number; startHeight: number; latest: number } | null>(null);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const height = open ? clampTimelineHeight(dragging ?? prefs.height, column) : TRANSPORT_HEIGHT;

  // The playhead and the readout are drawn here, by the transport's clock, and not by React (spec 21, the clock).
  const clock = useRef<HTMLSpanElement>(null);
  const frame = useRef<HTMLSpanElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const areaWidth = useRef(0);
  useEffect(() => {
    transport.setPainter((time, length) => {
      const parts = readoutParts(time, length);
      if (clock.current) clock.current.textContent = parts.clock;
      if (frame.current) frame.current.textContent = parts.frame;
      if (playhead.current) playhead.current.style.transform = `translateX(${length > 0 ? (time / length) * areaWidth.current : 0}px)`;
    });
    return () => transport.setPainter(undefined);
  }, [transport]);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const measure = () => {
      areaWidth.current = element.clientWidth;
      transport.repaint();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, transport]);

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

  const { playing, speed, muted, loop } = transportState;
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
          className="absolute inset-x-0 top-0 z-10 h-2 cursor-row-resize touch-none"
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
              <Toggle aria-label="Loop (Shift+L)" pressed={loop} onPressedChange={(on) => transport.setLoop(on)} size="sm" variant="default" className="size-8 p-0">
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
          <Tip label={open ? "Hide timeline" : "Show timeline"}>
            <Button variant="ghost" size="icon-sm" aria-label={open ? "Hide timeline" : "Show timeline"} onClick={() => save({ height: prefs.height, open: !open })}>
              <PanelBottom aria-hidden />
            </Button>
          </Tip>
        </div>
      </header>
      {open && (
        // The time area: its focus is where the transport's keys act, with the ruler and the rows (spec 21, the shortcuts).
        <div ref={area} data-timeline-focus tabIndex={-1} className="relative flex min-h-0 flex-1 flex-col outline-none">
          <div data-testid="timeline-ruler" className="h-6 flex-none border-b" />
          <div data-testid="timeline-rows" className="min-h-0 flex-1" />
          <div ref={playhead} data-testid="timeline-playhead" aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-px bg-primary" />
        </div>
      )}
    </section>
  );
};
