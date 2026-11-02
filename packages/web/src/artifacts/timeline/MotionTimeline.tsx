/**
 * The timeline strip under a motion in the editor (spec 21): the transport row, the ruler and the
 * rows. This file holds the strip's frame: its height, its resize by the top border, and Hide and
 * Show. The transport, the ruler and the rows are filled in by the tasks that follow it.
 */
import { PanelBottom } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { Tip } from "../../chrome/ui.tsx";
import type { EngineConnection } from "../../rpc/engine.ts";
import { TIMELINE_MIN_HEIGHT, clampTimelineHeight, useTimelinePrefs } from "./timelinePrefs.ts";

/** The transport row alone, which is what Hide leaves showing. */
const TRANSPORT_HEIGHT = 40;

export interface MotionTimelineProps {
  /** The motion's title, which names the region. */
  readonly title: string;
  readonly engine: EngineConnection;
  /** The height of the centre column, which caps the strip at 60 % of it. Zero until it is measured. */
  readonly column: number;
  readonly className?: string;
}

export const MotionTimeline = ({ title, engine, column, className }: MotionTimelineProps) => {
  const [prefs, save] = useTimelinePrefs(engine);
  const { open } = prefs;
  // A resize drag: the start, and the height it has reached. Saved once, on release.
  const drag = useRef<{ startY: number; startHeight: number; latest: number } | null>(null);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const height = open ? clampTimelineHeight(dragging ?? prefs.height, column) : TRANSPORT_HEIGHT;

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
        <div className="ml-auto flex items-center">
          <Tip label={open ? "Hide timeline" : "Show timeline"}>
            <Button variant="ghost" size="icon-sm" aria-label={open ? "Hide timeline" : "Show timeline"} onClick={() => save({ height: prefs.height, open: !open })}>
              <PanelBottom aria-hidden />
            </Button>
          </Tip>
        </div>
      </header>
      {open && <div data-testid="timeline-ruler" className="h-6 flex-none border-b" />}
      {open && <div data-testid="timeline-rows" className="min-h-0 flex-1" />}
    </section>
  );
};
