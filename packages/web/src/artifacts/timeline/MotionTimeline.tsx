/**
 * The timeline strip under a motion in the editor (spec 21): the transport row, the ruler and the
 * rows. The strip's frame (its height, its resize by the top border, Hide and Show), its transport,
 * the ruler (scrub, labels, the loop range and the end marker), the zoom and the rows are here.
 * The rows' label column sits beside the time area; the time area's origin is the track's left edge
 * after that column, so the ruler and the playhead share one coordinate system with the bars.
 */
import { ChevronDown, ChevronLeft, ChevronRight, Code, Film, Layers, Lock, Maximize2, Minus, PanelBottom, Pause, Play, Repeat, Square, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { clampDialValue, dialAt, fitZoom, rulerStep, snapMove, snapTime, zoomAt, zoomButton, type DialSchema, type Kit, type Owner, type SnapTarget, type Tween, type TweenRef } from "@unframed/domain";
import type { SourceEdit } from "@unframed/contracts";
import type { ChipElement } from "@unframed/domain";
import type { MotionTimelineReading } from "@unframed/contracts";
import { Button } from "~/components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { Toggle } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";
import { Tip } from "../../chrome/ui.tsx";
import type { EngineConnection } from "../../rpc/engine.ts";
import { messageOf } from "../../agent/store.ts";
import type { EditSession } from "../editor/editSession.ts";
import { TIMELINE_MIN_HEIGHT, clampTimelineHeight, useTimelinePrefs } from "./timelinePrefs.ts";
import { buildRows, channelsOf, dialLimitOf, groupOfKey, numberOf, selectOptionsOf, staggerEachOf, type BarView, type RowView } from "./rows.ts";
import { DEFAULT_EASE, easeChoices, kitEasings, type EaseValue } from "./ease.ts";
import { resolve, scriptValue } from "@unframed/domain";
import { ValuesPanel, type PanelControl, type PanelField, type ValuesPanelProps } from "./ValuesPanel.tsx";
import { carriedDialsOf, carriedTimingOf, clipNoteOf, type ClipOf } from "./clips.ts";
import { MotionTransport, SPEEDS, readoutParts } from "./transport.ts";
import { bareUnitOf, propertyLabel } from "./properties.ts";

/** The transport row alone, which is what Hide leaves showing. */
const TRANSPORT_HEIGHT = 40;

/** The label column beside the time area: 160 px (spec 21, Layout). */
const LABEL_WIDTH = 160;

/** Under this strip width the label column is 24 px of icons, each name in a tooltip (spec 21, Layout). */
const COMPACT_WIDTH = 900;
const COMPACT_LABEL = 24;

/** A bar's edge within this many pixels is its stretch handle (spec 21, Editing on the strip). */
const EDGE_PIXELS = 6;

/** Rows this far above and below the view stay mounted, so a short scroll shows no gap (spec 21, Layout). */
const VIEW_OVERSCAN = 240;

/** A press that moves less than this many pixels is a click, not a drag (spec 21, Rows, lanes and diamonds). */
const DRAG_PIXELS = 3;

/** A colour as a CSS colour text, the forms the values panel draws a swatch for. */
const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|[a-z]+$)/i;

/** The props the values panel takes, without its close handler. */
type PanelProps = Omit<ValuesPanelProps, "onClose" | "className">;

/** A tween's duration is at least one frame at 30 fps (spec 21, Motion edits). */
const MIN_DURATION = 0.033;
/** One frame at 30 fps: what an arrow key moves a bar by (Shift moves ten). */
const FRAME_SECONDS = 1 / 30;

/** Seconds to the millisecond, as the writer keeps them. */
const round = (seconds: number): number => Math.round(seconds * 1000) / 1000;

type GestureMode = "move" | "start" | "end";

/**
 * Each bar's lane within its row. A bar that overlaps an earlier bar in time takes the next lane down, so neither covers the other
 * and each can be pressed (spec 21, Rows). A row with no overlap has one lane, as before.
 */
const laneOf = (bars: readonly BarView[]): { readonly lane: readonly number[]; readonly lanes: number } => {
  const order = bars.map((_, index) => index).sort((a, b) => bars[a]!.start - bars[b]!.start);
  const ends: number[] = [];
  const lane = new Array<number>(bars.length).fill(0);
  for (const index of order) {
    const bar = bars[index]!;
    let slot = ends.findIndex((end) => end <= bar.start + 1e-9);
    if (slot < 0) {
      slot = ends.length;
      ends.push(0);
    }
    ends[slot] = bar.start + bar.duration;
    lane[index] = slot;
  }
  return { lane, lanes: Math.max(1, ends.length) };
};

/** A bar drag in progress: which bar, what it changes, and where it began. */
interface Gesture {
  readonly mode: GestureMode;
  readonly bar: BarView;
  readonly target: string;
  readonly ref: TweenRef;
  readonly channels: string[];
  readonly startX: number;
  readonly startY: number;
  /** Whether the press has moved far enough to be a drag. A bar's press is one from the start; a diamond's is once it moves. */
  moved: boolean;
  /** The bar's own start and end, stagger offset included. */
  readonly origin: number;
  readonly end: number;
  /** The bar's stagger offset: a tween's start is its bar's start less this. */
  readonly offset: number;
  /** The last change sent, so a move that stays put sends nothing. */
  last: string;
}

/** A clip drag in progress: which clip, what it changes, where it began, and the dial values it began with (spec 21, Clips). */
interface ClipGesture {
  readonly mode: GestureMode;
  readonly clip: string;
  readonly startX: number;
  /** The clip's start and end as drawn when the drag began. */
  readonly origin: number;
  readonly end: number;
  readonly dials: Readonly<Record<string, unknown>>;
  /** The zoom at the press: the strip may refit while the frame rebuilds, and the drag keeps the scale it began with. */
  readonly pxPerSecond: number;
}

/** The hint under a drag, as the platform names the key (spec 21, Snapping). */
const freeHint = (): string => (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "Hold Option to place freely" : "Hold Alt to place freely");

/** A label on the ruler, in seconds: `0 s`, `0.5 s`, `10 s`. */
const tickLabel = (seconds: number): string => `${Number(seconds.toFixed(2))} s`;

export interface MotionTimelineProps {
  /** The motion's title, which names the region. */
  readonly title: string;
  /** The editor's Esc asks the strip to close its values panel first: the strip sets this to a closer that answers whether it closed one (spec 21, Esc). */
  readonly closePanel: { current: (() => boolean) | undefined };
  readonly engine: EngineConnection;
  readonly project: string;
  /** The motion's file: its reading is asked for by name, and asked again when the file changes. */
  readonly file: string;
  /** The editor's edit session: the selection, the burst's pending timing, the live tweens and the tree. */
  readonly session: EditSession;
  /** The dial values the frame runs, by path, so a dial-owned timing is drawn where the dial puts it. */
  readonly dials: Readonly<Record<string, unknown>>;
  /** The parameters the motion declares: a dial-owned timing stops at their limits (spec 21, Dial-owned timing). */
  readonly schema: DialSchema | undefined;
  /** The locked elements of the shape. */
  readonly locked: readonly string[];
  /** The editor's column height, which caps the strip at 60 % of it. Zero until it is measured. */
  readonly column: number;
  /** The transport the editor made for this motion's player. */
  readonly transport: MotionTransport;
  /** Ask the agent to make a value editable: the element's chip, with the tween's call as its excerpt, goes into the composer (spec 18). */
  readonly onAsk: (field: string, elements: ChipElement[]) => void;
  /** The project kit and the artifact's mode, which the ease picker offers its easing tokens from (spec 19). */
  readonly kit: Kit | null;
  readonly mode: string | undefined;
  /** The Design tab's Show on timeline request: the element and the property it shows, with a count that makes each request new (spec 21). */
  readonly reveal?: { readonly element: string; readonly property: string; readonly nonce: number } | undefined;
  readonly className?: string;
}

/** The motion's reading as this strip holds it: the file it is for, and either the reading or why it could not be read. */
const NO_EDITS: readonly SourceEdit[] = [];

interface ReadingState {
  readonly file: string;
  readonly value?: MotionTimelineReading;
  readonly error?: string;
}

/** What a dragged edge snaps to (spec 21, Snapping), by priority: the playhead, the In and Out, the end, clip edges, then other bars' edges. */
const snapTargets = (rows: readonly RowView[], exclude: number, playhead: number, range: { start: number | null; end: number | null }, length: number): SnapTarget[] => {
  const targets: SnapTarget[] = [{ priority: 0, time: playhead }];
  if (range.start !== null) targets.push({ priority: 1, time: range.start });
  if (range.end !== null) targets.push({ priority: 1, time: range.end });
  if (length > 0) targets.push({ priority: 2, time: length });
  for (const row of rows) if (row.kind === "clip" && row.span !== null) targets.push({ priority: 3, time: row.span.start }, { priority: 3, time: row.span.start + row.span.duration });
  for (const row of rows) {
    for (const bar of row.bars) {
      if (bar.tween < 0 || bar.tween === exclude || bar.copy) continue;
      targets.push({ priority: 4, time: bar.start }, { priority: 4, time: bar.start + bar.duration });
    }
  }
  return targets;
};

const toggled = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/** One of the loop range's handles on the ruler: a thin bar a pointer can take hold of, labelled for its side. */
const LoopHandle = ({
  label,
  testId,
  at,
  onDown,
  onMove,
  onUp,
}: {
  readonly label: string;
  readonly testId: string;
  readonly at: number;
  readonly onDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) => (
  <div
    data-testid={testId}
    aria-label={label}
    role="presentation"
    className="absolute inset-y-0 z-[5] w-3 -translate-x-1/2 cursor-ew-resize touch-none"
    style={{ left: at }}
    onPointerDown={onDown}
    onPointerMove={onMove}
    onPointerUp={onUp}
    onPointerCancel={onUp}
  >
    <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary" />
  </div>
);

/** One row: its label beside the time area, its bars, and its diamonds. A lane is a thinner row under its element. */
const RowLine = ({
  row,
  compact,
  pxPerSecond,
  timeWidth,
  selected,
  selectedTween,
  onToggle,
  onSelectElement,
  cursorOf,
  onBarDown,
  onBarKey,
  barLabel,
  keyframeLabel,
  onBarMove,
  onBarUp,
  onDiamondDown,
  onDiamondClick,
  onOpenValues,
  clipNote,
  onClipDown,
  onClipMove,
  onClipUp,
}: {
  readonly row: RowView;
  /** The label column is icons only, each name in a tooltip (spec 21, Layout). */
  readonly compact: boolean;
  readonly pxPerSecond: number;
  readonly timeWidth: number;
  readonly selected: boolean;
  readonly selectedTween: number | null;
  readonly onToggle: () => void;
  readonly onSelectElement: (id: string) => void;
  readonly cursorOf: (bar: BarView) => string;
  readonly onBarDown: (bar: BarView, event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onBarKey: (bar: BarView, event: ReactKeyboardEvent<HTMLElement>) => void;
  /** A bar's accessible name, and a keyframe's, named for their element, group and time. */
  readonly barLabel: (bar: BarView) => string;
  readonly keyframeLabel: (bar: BarView, at: number) => string;
  readonly onBarMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onBarUp: (event: ReactPointerEvent<HTMLElement>) => void;
  /** A press on a keyframe: the bar's gesture at the point pressed, or none, and a click, which opens the values panel. */
  readonly onDiamondDown: (bar: BarView, event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDiamondClick: (bar: BarView, fraction: number, event: ReactMouseEvent<HTMLElement>) => void;
  readonly onOpenValues: (bar: BarView, fraction: number | null) => void;
  /** A clip row's note: the sentence its bar shows, or null when it may move. Undefined for every other row. */
  readonly clipNote?: string | null | undefined;
  readonly onClipDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onClipMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onClipUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) => {
  const runtime = row.kind === "runtime";
  const name = row.name;
  const lanes = laneOf(row.bars);
  return (
    <div
      data-testid="timeline-row"
      data-row-kind={row.kind}
      data-row-name={name}
      data-row-key={row.element ?? row.key}
      data-selected={selected ? "true" : undefined}
      data-hidden={row.hidden ? "true" : undefined}
      title={runtime ? "Made by the agent's code while the motion runs." : undefined}
      className={cn("flex flex-none", selected && "bg-accent/40", runtime && "text-muted-foreground", row.hidden && "opacity-50")}
      style={{ height: row.height }}
    >
      {compact ? (
        <div className="sticky left-0 z-10 flex flex-none items-center justify-center overflow-hidden border-b border-r bg-card text-xs" style={{ width: COMPACT_LABEL }}>
          {row.locked && <Lock aria-hidden data-testid="timeline-lock" aria-label="Locked. Unlock it in Layers to edit it." className="absolute bottom-0 right-0 size-2.5 text-muted-foreground" />}
          {/* An element row has two 12 px controls side by side: its disclosure chevron, when it has lanes, and its select. */}
          <div className="flex items-center">
            {row.expandable && (
              <Tip label={name}>
                <Button variant="ghost" size="icon-micro" className="-my-1.5 h-6 w-3" aria-label={`${row.expanded ? "Collapse" : "Expand"} ${name}`} onClick={onToggle}>
                  {row.expanded ? <ChevronDown aria-hidden className="size-2.5" /> : <ChevronRight aria-hidden className="size-2.5" />}
                </Button>
              </Tip>
            )}
            {row.kind === "element" && row.element !== null ? (
              <Tip label={name}>
                <Button variant="ghost" size="icon-micro" className="-my-1.5 h-6 w-3" aria-label={`Select ${name}`} onClick={() => onSelectElement(row.element!)}>
                  <Square aria-hidden className="size-2.5" />
                </Button>
              </Tip>
            ) : !row.expandable ? (
              <Tip label={name}>
                <span role="img" aria-label={name} className="inline-flex size-3 items-center justify-center text-muted-foreground">
                  {row.kind === "clip" ? <Film aria-hidden className="size-2.5" /> : row.kind === "composition" ? <Layers aria-hidden className="size-2.5" /> : row.kind === "runtime" ? <Code aria-hidden className="size-2.5" /> : <Minus aria-hidden className="size-2.5" />}
                </span>
              </Tip>
            ) : null}
          </div>
        </div>
      ) : (
      <div className="sticky left-0 z-10 flex w-40 flex-none items-center gap-1 border-b border-r bg-card pr-1 text-xs" style={{ paddingLeft: 4 + row.depth * 12 }}>
        {row.expandable ? (
          <Button variant="ghost" size="icon-tiny" className="size-6" aria-label={`${row.expanded ? "Collapse" : "Expand"} ${name}`} onClick={onToggle}>
            {row.expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          </Button>
        ) : (
          <span className="size-4 flex-none" />
        )}
        {row.kind === "element" && row.element !== null ? (
          <Button variant="ghost" size="xs" className="h-6" aria-label={`Select ${name}`} onClick={() => onSelectElement(row.element!)}>
            <span className="truncate">{name}</span>
          </Button>
        ) : (
          <span className={cn("truncate", row.kind === "composition" && "font-medium", row.kind === "clip" && "font-medium")}>{name}</span>
        )}
        {row.locked && <Lock aria-hidden data-testid="timeline-lock" aria-label="Locked. Unlock it in Layers to edit it." className="ml-auto size-3 flex-none text-muted-foreground" />}
      </div>
      )}
      <div className="relative flex-none border-b" style={{ width: timeWidth, height: row.height }}>
        {row.span !== null && (
          <div
            data-testid="timeline-clip-bar"
            data-start={row.span.start}
            data-duration={row.span.duration}
            title={clipNote ?? undefined}
            onPointerDown={(event) => {
              event.stopPropagation();
              onClipDown?.(event);
            }}
            onPointerMove={onClipMove}
            onPointerUp={onClipUp}
            onPointerCancel={onClipUp}
            className={cn("absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-muted-foreground/40", clipNote === undefined || clipNote === null ? "cursor-grab" : "cursor-not-allowed")}
            style={{ left: row.span.start * pxPerSecond, width: Math.max(row.span.duration * pxPerSecond, 2) }}
          />
        )}
        {row.bars.map((bar, index) => {
          const thin = (row.kind === "element" && !row.expanded) || lanes.lanes > 1;
          const chosen = bar.tween >= 0 && bar.tween === selectedTween;
          // Each lane's centre sits at its share of the row: one lane is the middle, as before.
          const centre = ((lanes.lane[index] ?? 0) + 0.5) / lanes.lanes;
          return (
            <div
              key={`${bar.tween}:${bar.target}:${bar.group ?? ""}:${index}`}
              data-testid="timeline-bar"
              data-tween={bar.tween}
              data-target={bar.target}
              data-start={bar.start}
              data-duration={bar.duration}
              data-copy={bar.copy ? "true" : undefined}
              data-stagger={bar.stagger ?? undefined}
              data-selected={chosen ? "true" : undefined}
              role="button"
              tabIndex={0}
              aria-label={barLabel(bar)}
              title={bar.readOnly ?? undefined}
              onKeyDown={(event) => onBarKey(bar, event)}
              onPointerDown={(event) => {
                event.stopPropagation();
                onBarDown(bar, event);
              }}
              onPointerMove={onBarMove}
              onPointerUp={onBarUp}
              onPointerCancel={onBarUp}
              // The click that ends a drag is the bar's, not an empty track's: it must not clear the selection.
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={() => onOpenValues(bar, null)}
              className={cn(
                "absolute -translate-y-1/2 rounded-sm",
                cursorOf(bar),
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                thin ? "h-1.5" : "h-3",
                bar.copy ? "bg-primary/25" : bar.readOnly !== null ? "bg-muted-foreground/50" : "bg-primary/70",
                chosen && "ring-1 ring-foreground",
              )}
              style={{ left: bar.start * pxPerSecond, width: Math.max(bar.duration * pxPerSecond, 2), top: `${centre * 100}%` }}
            />
          );
        })}
        {/* The keyframes are drawn above the bars, so every diamond takes the pointer, the middle ones included (spec 21, Rows, lanes and diamonds). */}
        {row.bars.flatMap((bar, index) =>
          bar.copy
            ? []
            : bar.diamonds.map((at, step) => {
                // A diamond's place in its bar, 0 at its start and 1 at its end: the values it opens with (spec 21, Rows).
                const fraction = bar.duration > 0 ? Math.round(((at - bar.start) / bar.duration) * 1000) / 1000 : 0;
                return (
                  // A keyframe is a small target of its own, not a kit button: a button's touch area would cover the bar it sits on.
                  <span
                    key={`${index}:${step}`}
                    role="button"
                    tabIndex={0}
                    aria-label={keyframeLabel(bar, at)}
                    data-testid="timeline-diamond"
                    data-tween={bar.tween}
                    data-target={bar.target}
                    data-fraction={fraction}
                    className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rotate-45 bg-foreground before:absolute before:-inset-[7px] before:-rotate-45 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ left: at * pxPerSecond }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onDiamondDown(bar, event);
                    }}
                    onPointerMove={onBarMove}
                    onPointerUp={onBarUp}
                    onPointerCancel={onBarUp}
                    onClick={(event) => onDiamondClick(bar, fraction, event)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onOpenValues(bar, fraction);
                    }}
                  />
                );
              }),
        )}
      </div>
    </div>
  );
};

export const MotionTimeline = ({ title, closePanel, engine, project, file, session, dials, schema, locked, column, transport, onAsk, kit, mode, reveal, className }: MotionTimelineProps) => {
  const [prefs, save] = useTimelinePrefs(engine);
  const { open } = prefs;
  const transportState = useSyncExternalStore(transport.subscribe, transport.getSnapshot);
  const { playing, speed, muted, loop, length, range } = transportState;

  // The reading of the file, asked for once per file (a new version is a new file).
  const [reading, setReading] = useState<ReadingState | undefined>(undefined);
  useEffect(() => {
    let live = true;
    engine
      .call("motion.timeline", { project, file })
      .then((value) => live && setReading({ file, value }))
      .catch((error: unknown) => live && setReading({ file, error: messageOf(error) }));
    return () => {
      live = false;
    };
  }, [engine, project, file]);
  // The last reading stays on screen while a new version's reading loads, so its bars do not vanish (spec 21, After a version loads).
  const current = reading?.file === file || reading?.value !== undefined ? reading : undefined;
  // The edits the last commit wrote are drawn over the old reading until the new file's reading is in.
  const settledEdits = session.settled !== undefined && session.settled.base === current?.file ? session.settled.edits : NO_EDITS;

  // The rows: which elements are open. The tween the last bar click chose is the editor's selection (session.tween).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const selectedTween = session.tween;
  const setSelectedTween = session.setTween;
  // The timing panel: the bar it opened from, by its tween and target (spec 21, The values panel).
  const [timing, setTiming] = useState<{ readonly tween: number; readonly target: string; readonly at: number | null } | null>(null);
  const timingOpen = useRef(false);
  timingOpen.current = timing !== null;
  useEffect(() => {
    closePanel.current = () => {
      if (!timingOpen.current) return false;
      timingOpen.current = false;
      setTiming(null);
      return true;
    };
    return () => {
      closePanel.current = undefined;
    };
  }, [closePanel]);
  const tweens = useMemo(() => new Map<number, Tween>((current?.value?.tweens ?? []).map((tween) => [tween.ref.index, tween])), [current?.value]);
  const hidden = useMemo(() => new Set((session.tree?.elements ?? []).filter((element) => element.hidden).map((element) => element.id)), [session.tree]);
  const names = useMemo(() => Object.fromEntries((session.tree?.elements ?? []).map((element) => [element.id, element.name])), [session.tree]);
  // The burst's timing as drawn: a pending clip edit also draws the tweens it carries (spec 21, Clips).
  const shownPending = useMemo(() => {
    const pending = [...session.pending, ...settledEdits];
    return current?.value === undefined ? pending : [...pending, ...carriedTimingOf(current.value, pending, dials)];
  }, [current?.value, session.pending, settledEdits, dials]);
  const rows = useMemo<RowView[]>(
    () =>
      current?.value === undefined
        ? []
        : buildRows({ reading: current.value, names, dials, pending: shownPending, live: session.liveTweens, expanded, locked, hidden }),
    [current?.value, names, dials, shownPending, session.liveTweens, expanded, locked, hidden],
  );
  const selected = new Set(session.selection);
  // The rows are mounted only where they are in view (spec 21, Layout): the scroller's offset and height decide which, and the
  // rows above and below are spacers of their heights. A row out of view is revealed by moving the scroller to it.
  const rowsRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  const measureView = () => {
    const element = scroller.current;
    if (element === null) return;
    const next = { top: element.scrollTop - (rowsRef.current?.offsetTop ?? 0), height: element.clientHeight };
    setView((previous) => (previous.top === next.top && previous.height === next.height ? previous : next));
  };
  const rowTops = useMemo(() => {
    const tops: number[] = [];
    let total = 0;
    for (const row of rows) {
      tops.push(total);
      total += row.height;
    }
    return { tops, total };
  }, [rows]);
  const revealRow = (index: number) => {
    const element = scroller.current;
    if (element === null || index < 0 || index >= rows.length) return;
    const top = (rowsRef.current?.offsetTop ?? 0) + rowTops.tops[index]!;
    const bottom = top + rows[index]!.height;
    // The ruler stays on top of the time area, so a row under it is out of view.
    const ruler = 24;
    if (top < element.scrollTop + ruler) element.scrollTop = top - ruler;
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
  };
  const rowOfTween = (tween: number) => rows.findIndex((row) => row.bars.some((bar) => bar.tween === tween));

  // A selection made in the frame or in Layers scrolls its row into view.
  const [firstSelected] = session.selection;
  const revealedSelection = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (firstSelected === undefined) {
      revealedSelection.current = undefined;
      return;
    }
    if (revealedSelection.current === firstSelected) return;
    const index = rows.findIndex((row) => (row.element ?? row.key) === firstSelected);
    if (index < 0) return;
    revealedSelection.current = firstSelected;
    revealRow(index);
  }, [firstSelected, rows]);

  // Show on timeline (spec 21, The Design tab link): opens the strip, expands the element's row and selects the tween that animates the
  // property, the earliest after the playhead when there are several, else the last. Each request is handled once, so a new version
  // does not select again.
  const handledReveal = useRef(-1);
  const scrollToTween = useRef<number | null>(null);
  useEffect(() => {
    if (reveal === undefined || reveal.nonce === handledReveal.current || current?.value === undefined) return;
    handledReveal.current = reveal.nonce;
    const onElement = Array.from(tweens.values()).filter((tween) => tween.targets.includes(reveal.element));
    const byChannel = onElement.filter((tween) => channelsOf(tween).includes(reveal.property));
    const candidates = byChannel.length > 0 ? byChannel : onElement;
    const chosen = candidates.filter((tween) => (numberOf(tween.start, dials) ?? 0) >= transport.current()).sort((a, b) => (numberOf(a.start, dials) ?? 0) - (numberOf(b.start, dials) ?? 0))[0] ?? candidates.at(-1);
    if (chosen === undefined) return;
    if (!open) save({ height: prefs.height, open: true });
    setExpanded((previous) => (previous.has(reveal.element) ? previous : new Set(previous).add(reveal.element)));
    setSelectedTween(chosen.ref.index);
    scrollToTween.current = chosen.ref.index;
  }, [reveal, current?.value, tweens, dials, transport, open, save, prefs.height]);
  useEffect(() => {
    const index = scrollToTween.current;
    if (index === null) return;
    const bar = scroller.current?.querySelector<HTMLElement>(`[data-testid="timeline-bar"][data-tween="${index}"]`);
    if (bar === null || bar === undefined) {
      // Its row is not mounted yet: move the scroller to it, and the bar is found on the render that follows.
      revealRow(rowOfTween(index));
      return;
    }
    scrollToTween.current = null;
    bar.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  // A resize drag: the start, and the height it has reached. Saved once, on release.
  const drag = useRef<{ startY: number; startHeight: number; latest: number } | null>(null);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const height = open ? clampTimelineHeight(dragging ?? prefs.height, column) : TRANSPORT_HEIGHT;
  // Before the first paint the view is measured, so the rows in view are mounted on the frame they first show.
  useLayoutEffect(() => measureView(), [open, height, rows]);
  // The rows that are in view, with the overscan above and below: [first, last) of `rows`.
  const visible = useMemo(() => {
    const top = view.top - VIEW_OVERSCAN;
    const bottom = view.top + view.height + VIEW_OVERSCAN;
    let first = 0;
    while (first < rows.length && rowTops.tops[first]! + rows[first]!.height <= top) first++;
    let last = first;
    while (last < rows.length && rowTops.tops[last]! < bottom) last++;
    return { first, last };
  }, [view, rows, rowTops]);
  const bottomSpace = rowTops.total - (visible.last > visible.first ? rowTops.tops[visible.last - 1]! + rows[visible.last - 1]!.height : rowTops.tops[visible.first] ?? 0);

  // The zoom: null is fit (the whole length in the strip's width). Otherwise it is a share of fit, so an edit that changes the length keeps the proportion (spec 21, Zoom).
  const scroller = useRef<HTMLDivElement>(null);
  const rulerTime = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const labelWidth = width > 0 && width < COMPACT_WIDTH ? COMPACT_LABEL : LABEL_WIDTH;
  const compact = labelWidth === COMPACT_LABEL;
  // The clock and the zoom handlers, which run outside React's renders, read the label width from here.
  const labelRef = useRef(labelWidth);
  labelRef.current = labelWidth;
  const [zoom, setZoom] = useState<number | null>(null);
  // Fit shows the whole length in the time area, which is the strip's width less the label column.
  const fit = width > labelWidth && length > 0 ? fitZoom(width - labelWidth, length) : 0;
  const pxPerSecond = zoom === null ? fit : zoom * fit;
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
      if (playhead.current) playhead.current.style.transform = `translateX(${labelRef.current + time * pxRef.current}px)`;
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
      // The time starts after the label column, so the anchor is measured from there.
      const next = zoomAt({ pxPerSecond: pxRef.current, scrollLeft: element.scrollLeft - labelRef.current }, { deltaY: event.deltaY, cursorX: event.clientX - rect.left, fit: fitRef.current });
      setZoom(next.pxPerSecond / fitRef.current);
      pendingScroll.current = next.scrollLeft + labelRef.current;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [open]);

  const zoomBy = (direction: "in" | "out") => {
    const element = scroller.current;
    if (!element || fitRef.current <= 0) return;
    const next = zoomButton({ pxPerSecond: pxRef.current, scrollLeft: element.scrollLeft - labelRef.current, viewport: element.clientWidth, playhead: transport.current(), fit: fitRef.current }, direction);
    setZoom(next.pxPerSecond / fitRef.current);
    pendingScroll.current = next.scrollLeft + labelRef.current;
  };
  const fitToLength = () => {
    setZoom(null);
    pendingScroll.current = 0;
  };

  // Scrubbing: a press or a drag on the ruler seeks by a drag seek while it moves, and commits on release (spec 21, the clock).
  const scrubbing = useRef(false);
  const timeUnder = (clientX: number): number => {
    const element = rulerTime.current;
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

  // The loop range's In and Out handles (spec 21, The ruler): a drag sets the side at the pointer, a frame at a time, and the
  // transport refuses an In at or past the Out, or an Out at or before the In.
  const handleSide = useRef<"in" | "out" | null>(null);
  const onHandleDown = (side: "in" | "out", event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // The handle is not a scrub: the ruler under it does not start one.
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    handleSide.current = side;
  };
  const onHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const side = handleSide.current;
    if (side === null) return;
    const at = Math.round(timeUnder(event.clientX) * 30) / 30;
    if (side === "in") transport.setIn(at);
    else transport.setOut(at);
  };
  const onHandleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (handleSide.current === null) return;
    handleSide.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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

  // A bar drag (spec 21, Editing on the strip). A bar's body moves its start; a stretch from the right edge changes its duration,
  // and from the left edge both (the end stays put). Each change is one tween edit in the burst and a tween patch in the frame,
  // and the burst's pause writes the version after the release.
  const gesture = useRef<Gesture | null>(null);
  /** Whether the keyframe press that is under way has moved, so the click that ends it does not open the values panel. */
  const diamondMoved = useRef(false);
  const [guide, setGuide] = useState<number | null>(null);
  const [barDragging, setBarDragging] = useState(false);
  const pendingTiming = (index: number): { start?: number; duration?: number | { token: string } } | undefined =>
    session.pending.find((edit): edit is Extract<typeof edit, { type: "tween-time" }> => edit.type === "tween-time" && edit.tween.index === index);
  /** A timing value this strip can change: a literal in the file, or a parameter the schema names (its limits are where a drag stops). */
  const editable = (owner: Owner): boolean => owner.kind === "source" || (owner.kind === "dial" && dialLimitOf(schema, owner.path) !== null);
  /** What a bar may do, from the reading: a move needs an editable start, an end an editable duration, a left edge both. */
  const allowed = (bar: BarView, row: RowView): { move: boolean; start: boolean; end: boolean } => {
    const tween = tweens.get(bar.tween);
    if (tween === undefined || tween.readOnly !== null || row.locked || bar.tween < 0) return { move: false, start: false, end: false };
    // A set has one instant and no duration: its diamond moves, and it has no edges to stretch (spec 21, Editing on the strip).
    if (tween.method === "set") return { move: editable(tween.start), start: false, end: false };
    const startOk = editable(tween.start);
    const endOk = editable(tween.duration);
    return { move: startOk, start: startOk && endOk, end: endOk };
  };
  const cursorOf = (bar: BarView, row: RowView): string => {
    const rights = allowed(bar, row);
    return rights.move || rights.start || rights.end ? "cursor-grab" : "cursor-not-allowed";
  };
  /**
   * Starts a gesture on a bar or a keyframe. `local` and `width` are the press's place and the bar's width in pixels, so a keyframe
   * takes the bar's gesture at the point it sits on: within 6 px of an edge is a stretch, else a move (spec 21, Rows, lanes and diamonds).
   */
  const beginGesture = (bar: BarView, row: RowView, event: ReactPointerEvent<HTMLElement>, local: number, width: number, fromDiamond: boolean): void => {
    setSelectedTween(bar.tween);
    if (row.element !== null && !session.selection.includes(row.element)) session.setSelection([row.element]);
    const rights = allowed(bar, row);
    // The edge within 6 px is the stretch; a narrow bar's nearer edge wins. A set has no edges, so its press always moves it.
    // A bar narrower than 18 px gives each edge a third of its width, so its middle still moves it (spec 21, Rows, lanes and diamonds).
    const edge = Math.min(EDGE_PIXELS, width / 3);
    const nearStart = local <= edge && rights.start;
    const nearEnd = width - local <= edge && rights.end;
    const mode: GestureMode | null = nearStart && nearEnd ? (local <= width / 2 ? "start" : "end") : nearStart ? "start" : nearEnd ? "end" : rights.move ? "move" : null;
    if (mode === null) return;
    const tween = tweens.get(bar.tween)!;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { mode, bar, target: bar.target, ref: tween.ref, channels: channelsOf(tween), startX: event.clientX, startY: event.clientY, moved: !fromDiamond, origin: bar.start, end: bar.start + bar.duration, offset: bar.stagger ?? 0, last: "" };
    // A keyframe shows the drag once it has moved; a bar shows it from the press.
    if (!fromDiamond) setBarDragging(true);
  };
  const onBarDown = (bar: BarView, row: RowView, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    beginGesture(bar, row, event, event.clientX - rect.left, rect.width, false);
  };
  const onDiamondDown = (bar: BarView, row: RowView, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    diamondMoved.current = false;
    // The keyframe sits in the time area, whose left edge is the bar's origin at zero seconds.
    const area = event.currentTarget.parentElement?.getBoundingClientRect();
    if (area === undefined) return;
    const left = area.left + bar.start * pxRef.current;
    beginGesture(bar, row, event, event.clientX - left, Math.max(bar.duration * pxRef.current, 2), true);
  };
  /** A click on a keyframe opens its values panel, unless the press before it moved (then it was a drag). */
  const onDiamondClick = (bar: BarView, fraction: number, event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (diamondMoved.current) return;
    openValues(bar, fraction);
  };
  const onBarMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (current === null) return;
    if (!current.moved) {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_PIXELS) return;
      current.moved = true;
      diamondMoved.current = true;
      setBarDragging(true);
    }
    const targets = snapTargets(rows, current.ref.index, transport.current(), range, length);
    const pxPerSecond = pxRef.current;
    const dt = (event.clientX - current.startX) / pxPerSecond;
    const free = event.altKey;
    const changed: { start?: number; duration?: number } = {};
    if (current.mode === "move") {
      const snapped = snapMove(current.origin + dt, current.end - current.origin, { targets, pxPerSecond, free });
      changed.start = Math.max(0, round(snapped.start - current.offset));
      setGuide(snapped.guide ? snapped.start : null);
    } else if (current.mode === "end") {
      const snapped = snapTime(current.end + dt, { targets, pxPerSecond, free });
      changed.duration = Math.max(MIN_DURATION, round(snapped.time - current.origin));
      setGuide(snapped.guide ? snapped.time : null);
    } else {
      const snapped = snapTime(current.origin + dt, { targets, pxPerSecond, free });
      const at = Math.min(current.end - MIN_DURATION, Math.max(current.offset, snapped.time));
      changed.start = round(at - current.offset);
      changed.duration = round(current.end - at);
      setGuide(snapped.guide ? at : null);
    }
    applyTiming(current.ref, current.target, current.channels, changed);
  };
  /**
   * Writes a tween's timing as the person changed it: a field the file owns is a tween edit, and a field a parameter owns moves the
   * parameter, which the frame shows at once and the burst writes at its commit with no version of its own (spec 21, Dial-owned timing).
   */
  const applyTiming = (ref: TweenRef, target: string, channels: string[], changed: { start?: number; duration?: number }): void => {
    const tween = tweens.get(ref.index);
    const literal: { start?: number; duration?: number } = {};
    for (const field of ["start", "duration"] as const) {
      const value = changed[field];
      const owner = tween?.[field];
      if (value === undefined || owner === undefined) continue;
      // A token-owned field takes a number when it is detached; the token is replaced by the number the person typed or dragged.
      if (owner.kind === "source" || owner.kind === "token") literal[field] = value;
      else if (owner.kind === "dial") {
        const limit = dialLimitOf(schema, owner.path);
        if (limit !== null) session.patchDial(owner.path.join("."), clampDialValue(limit, value));
      }
    }
    if (literal.start === undefined && literal.duration === undefined) return;
    // The burst keeps one timing entry per tween, so the fields it does not change keep their pending values.
    const pending = pendingTiming(ref.index);
    const fields = { start: literal.start ?? pending?.start, duration: literal.duration ?? pending?.duration };
    const edit = { type: "tween-time" as const, tween: ref, ...(fields.start === undefined ? {} : { start: fields.start }), ...(fields.duration === undefined ? {} : { duration: fields.duration }) };
    // The frame shows numbers only; a token duration reaches the frame at the commit.
    const change = { ...(fields.start === undefined ? {} : { start: fields.start }), ...(typeof fields.duration === "number" ? { duration: fields.duration } : {}) };
    session.patchTween(edit, { selector: target, channels, change });
  };

  /**
   * A tween's ease as the person chose it (spec 21, The ease picker): a literal or token ease is a tween edit in the burst, and an
   * ease a parameter sets moves the parameter.
   */
  const applyEase = (tween: Tween, target: string, value: EaseValue): void => {
    if (tween.ease?.kind === "dial") {
      if (typeof value === "string") session.patchDial(tween.ease.path.join("."), value);
      return;
    }
    const channels = channelsOf(tween);
    session.patchTween({ type: "tween-ease", tween: tween.ref, ease: value }, { selector: target, channels, change: typeof value === "string" ? { ease: value } : {} });
  };
  /** The ease field of a tween's values panel: what it holds, and the choices the picker offers. */
  const easeFieldOf = (tween: Tween, target: string) => {
    if (tween.method === "set") return null;
    const pending = session.pending.find((edit): edit is Extract<SourceEdit, { type: "tween-ease" }> => edit.type === "tween-ease" && edit.tween.index === tween.ref.index);
    const owner = tween.ease;
    let written: EaseValue | null = null;
    let options: readonly string[] | null = null;
    let editable = true;
    if (pending !== undefined) written = pending.ease;
    else if (owner === null) written = null;
    else if (owner.kind === "source") written = String(owner.value);
    else if (owner.kind === "token") written = { token: owner.name };
    else if (owner.kind === "dial") {
      options = selectOptionsOf(schema, owner.path);
      editable = options !== null;
      written = String(dialAt(dials, owner.path.join(".")) ?? DEFAULT_EASE);
    } else {
      written = owner.text;
      editable = false;
    }
    const label = written === null ? DEFAULT_EASE : typeof written === "string" ? written : written.token;
    const parameter = owner?.kind === "dial" ? owner.path.join(" › ") : undefined;
    const choices = easeChoices({ written, tokens: options === null ? kitEasings(kit, mode) : [], options, ...(parameter === undefined ? {} : { parameter }) });
    return { label, choices, disabled: !editable || tween.readOnly !== null, value: (choice: EaseValue) => applyEase(tween, target, choice) };
  };

  // The end marker (spec 21, Total length): a drag sets `data-duration` through a composition-duration edit, and the runtime's own
  // root duration so playback follows it. It snaps to the playhead and to the last clip's end, else to whole frames.
  const endDrag = useRef<{ startX: number; origin: number; pxPerSecond: number } | null>(null);
  const endEditable = current?.value?.length.kind === "source";
  const onEndDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || length <= 0 || !endEditable) return;
    // The handle is not a scrub: the ruler under it does not start one.
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    endDrag.current = { startX: event.clientX, origin: length, pxPerSecond: pxRef.current };
  };
  const onEndMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = endDrag.current;
    if (drag === null) return;
    const clipEnds = rows.flatMap((row) => (row.kind === "clip" && row.span !== null ? [row.span.start + row.span.duration] : []));
    const targets: SnapTarget[] = [{ priority: 0, time: transport.current() }, ...clipEnds.map((time) => ({ priority: 1, time }))];
    const snapped = snapTime(drag.origin + (event.clientX - drag.startX) / drag.pxPerSecond, { targets, pxPerSecond: drag.pxPerSecond, free: event.altKey });
    const seconds = Math.max(MIN_DURATION, snapped.time);
    setGuide(snapped.guide ? snapped.time : null);
    transport.setRootDuration(seconds);
    session.patch({ type: "composition-duration", seconds });
  };
  const onEndUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (endDrag.current === null) return;
    endDrag.current = null;
    setGuide(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // A clip drag (spec 21, Clips): its bar's body moves the clip, an edge stretches it. Each change is one `clip-time` edit in the burst,
  // and the dials its carried tweens take are held with it, so one undo takes back the whole step.
  const clipGesture = useRef<ClipGesture | null>(null);
  const clipAt = (hfId: string): ClipOf | undefined => current?.value?.clips.find((clip) => clip.hfId === hfId);
  /** The clip's drawn start and end, from the burst's pending clip edit, else the file. */
  const clipSpan = (clip: ClipOf): { start: number; end: number } | null => {
    const moved = session.pending.find((edit): edit is Extract<typeof edit, { type: "clip-time" }> => edit.type === "clip-time" && edit.clip === clip.hfId);
    const start = moved?.start ?? numberOf(clip.start, dials);
    const duration = moved?.duration ?? numberOf(clip.duration, dials);
    return start === undefined || duration === undefined ? null : { start, end: start + duration };
  };
  /** A clip row's note: the locked line, the engine's refusal, or the agent's timing; null when the clip may move, undefined for other rows. */
  const clipNoteFor = (row: RowView): string | null | undefined => {
    if (row.kind !== "clip" || row.element === null) return undefined;
    if (row.locked) return "Locked. Unlock it in Layers to edit it.";
    const clip = clipAt(row.element);
    return clip === undefined ? "This motion has no reading for this clip." : clipNoteOf(clip);
  };
  const onClipDown = (row: RowView, event: ReactPointerEvent<HTMLDivElement>) => {
    const clip = row.element === null ? undefined : clipAt(row.element);
    if (event.button !== 0 || clip === undefined || row.locked || row.span === null) return;
    if (clipNoteOf(clip) !== null) return;
    const span = clipSpan(clip);
    if (span === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const local = event.clientX - rect.left;
    const nearStart = local <= EDGE_PIXELS;
    const nearEnd = rect.width - local <= EDGE_PIXELS;
    const mode: GestureMode = nearStart && nearEnd ? (local <= rect.width / 2 ? "start" : "end") : nearStart ? "start" : nearEnd ? "end" : "move";
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    clipGesture.current = { mode, clip: clip.hfId, startX: event.clientX, origin: span.start, end: span.end, dials, pxPerSecond: pxRef.current };
    setBarDragging(true);
  };
  const onClipMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = clipGesture.current;
    if (drag === null) return;
    const clip = clipAt(drag.clip);
    if (clip === undefined) return;
    // The clip's own rows and the bars it carries move with the drag, so they are not snap targets.
    const carried = new Set("tweens" in clip.carry ? clip.carry.tweens.map((ref) => ref.index) : []);
    const others = rows.filter((row) => !(row.kind === "clip" && row.element === drag.clip)).map((row) => ({ ...row, bars: row.bars.filter((bar) => !carried.has(bar.tween)) }));
    const targets = snapTargets(others, -1, transport.current(), range, length);
    const { pxPerSecond } = drag;
    const dt = (event.clientX - drag.startX) / pxPerSecond;
    const free = event.altKey;
    let start = drag.origin;
    let end = drag.end;
    if (drag.mode === "move") {
      const snapped = snapMove(drag.origin + dt, drag.end - drag.origin, { targets, pxPerSecond, free });
      start = Math.max(0, round(snapped.start));
      end = start + (drag.end - drag.origin);
      setGuide(snapped.guide ? snapped.start : null);
    } else if (drag.mode === "end") {
      const snapped = snapTime(drag.end + dt, { targets, pxPerSecond, free });
      end = Math.max(drag.origin + MIN_DURATION, round(snapped.time));
      setGuide(snapped.guide ? snapped.time : null);
    } else {
      const snapped = snapTime(drag.origin + dt, { targets, pxPerSecond, free });
      start = Math.max(0, Math.min(drag.end - MIN_DURATION, round(snapped.time)));
      setGuide(snapped.guide ? start : null);
    }
    const duration = round(end - start);
    // A move sends the duration only when the burst already holds one, so a move does not pin the clip's length.
    const held = session.pending.some((edit) => edit.type === "clip-time" && edit.clip === drag.clip && edit.duration !== undefined);
    const clipEdit = { type: "clip-time" as const, clip: drag.clip, start, ...(drag.mode !== "move" || held ? { duration } : {}) };
    session.patch(clipEdit);
    if (current?.value !== undefined) {
      // The carried tweens move in the frame as the clip does, from the timing the clip's edit gives them (spec 21, Live preview).
      const others = session.pending.filter((edit) => !(edit.type === "clip-time" && edit.clip === drag.clip));
      for (const timed of carriedTimingOf(current.value, [...others, clipEdit], dials)) {
        if (timed.type !== "tween-time") continue;
        const tween = tweens.get(timed.tween.index);
        const selector = tween?.targets[0];
        if (tween === undefined || selector === undefined) continue;
        // The carry writes numbers; a token duration only reaches the frame at the commit.
        const change = { ...(timed.start === undefined ? {} : { start: timed.start }), ...(typeof timed.duration === "number" ? { duration: timed.duration } : {}) };
        session.previewTween({ selector, channels: channelsOf(tween), change });
      }
      for (const written of carriedDialsOf(current.value, clip, { start: drag.origin, duration: drag.end - drag.origin }, { start, duration }, drag.dials)) {
        const limit = dialLimitOf(schema, written.path);
        if (limit !== null) session.patchDial(written.path.join("."), clampDialValue(limit, written.value));
      }
    }
  };
  const onClipUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (clipGesture.current === null) return;
    clipGesture.current = null;
    setGuide(null);
    setBarDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  /** A stagger's spacing, as one literal number (spec 21, Staggers). */
  const applyStagger = (ref: TweenRef, target: string, channels: string[], each: number): void => {
    session.patchTween({ type: "tween-stagger", tween: ref, each }, { selector: target, channels, change: { stagger: each } });
  };


  /** The timing panel's bar: its tween's own start (the first target's, stagger offset taken off), its duration and its stagger. */
  const timingBar = timing === null ? undefined : rows.flatMap((row) => row.bars).find((bar) => bar.tween === timing.tween && bar.target === timing.target);
  const timingTween = timing === null ? undefined : tweens.get(timing.tween);
  const timingEach = timingTween === undefined ? null : staggerEachOf(timingTween, session.pending);
  const easeField = timingTween === undefined || timing === null ? null : easeFieldOf(timingTween, timing.target);

  /** The text a token shows in the artifact's mode, and the tokens of the given types (spec 19). */
  const tokenText = (path: string): string => {
    const value = kit === null ? undefined : resolve(kit, path, mode);
    return value === undefined ? "" : String(value);
  };
  const tokensOf = (types: readonly string[]) => (kit?.tokens ?? []).filter((token) => types.includes(token.type)).map((token) => ({ path: token.path, value: tokenText(token.path) }));

  /** The chip an ask makes: the element the tween animates, with the tween's call as its excerpt (spec 21, Rules this spec bends, 9). */
  const askAgent = (field: string, tween: Tween, target: string) => {
    const chip: ChipElement = { elementId: target, liveSelector: "", tag: "div", label: names[target] ?? target, startTag: "", text: "", hasChildren: false, excerpt: tween.source };
    onAsk(field, [chip]);
  };

  /** A field of a read-only tween: its value as text, with no chip, note or ask of its own. */
  const readOnlyField = (field: PanelField): PanelField => {
    const control: PanelControl = field.control.kind === "text" ? field.control : field.control.kind === "number" ? { ...field.control, editable: false } : { ...field.control, editable: false };
    return { key: field.key, label: field.label, control };
  };

  /** The values panel of the tween it opened from: its timing, its stagger, and the values at the keyframe it opened at (spec 21, The values panel). */
  const panelOf = (): PanelProps | null => {
    if (timing === null || timingTween === undefined || timingBar === undefined) return null;
    const tween = timingTween;
    const target = timing.target;
    const ref = tween.ref;
    const channelsNow = channelsOf(tween);
    const write = (property: string, at: number, value: number | string | { token: string }, frame?: string) =>
      session.patchTween(
        { type: "tween-value", tween: ref, at, property, value },
        { selector: target, channels: channelsNow, change: frame === undefined ? {} : { values: { at, props: { [property]: frame } } } },
      );
    const timeField = (key: string, label: string, owner: Owner, value: number, commit: (seconds: number) => void): PanelField => {
      const tokenDetach = () => {
        const seconds = kit === null || owner.kind !== "token" ? undefined : scriptValue(kit, owner.name, mode);
        if (typeof seconds === "number") commit(seconds);
      };
      if (owner.kind === "source") return { key, label, control: { kind: "number", value, unit: "s", editable: true, onCommit: commit } };
      if (owner.kind === "dial") return { key, label, parameter: owner.path.join(" › "), control: { kind: "number", value, unit: "s", editable: dialLimitOf(schema, owner.path) !== null, onCommit: commit } };
      if (owner.kind === "token" && key === "duration") {
        return {
          key,
          label,
          control: { kind: "number", value, unit: "s", editable: false, onCommit: commit },
          token: {
            name: owner.name,
            value: tokenText(owner.name),
            options: tokensOf(["duration"]),
            onChoose: (path) => session.patchTween({ type: "tween-time", tween: ref, duration: { token: path } }, { selector: target, channels: channelsNow, change: {} }),
            onDetach: tokenDetach,
          },
        };
      }
      return { key, label, control: { kind: "text", value: owner.kind === "script" ? owner.text : "" }, note: "Set by the agent's code.", ask: () => askAgent(label.toLowerCase(), tween, target) };
    };
    const fields: PanelField[] = [
      timeField("start", "Start", tween.start, timingBar.start - (timingBar.stagger ?? 0), (seconds) => applyTiming(ref, target, channelsNow, { start: seconds })),
      timeField("duration", "Duration", tween.duration, timingBar.duration, (seconds) => applyTiming(ref, target, channelsNow, { duration: seconds })),
    ];
    if (timingEach !== null) {
      fields.push({ key: "stagger", label: "Stagger", control: { kind: "number", value: timingEach, unit: "s", editable: tween.stagger?.kind === "source", onCommit: (each) => applyStagger(ref, target, channelsNow, each) } });
    }
    if (timing.at !== null) {
      const step = tween.keyframes.find((candidate) => Math.abs(candidate.at - timing.at!) < 1e-6);
      for (const property of Object.keys(step?.values ?? {}).sort()) {
        const owner = step!.values[property]!;
        const at = timing.at;
        if (owner.kind === "source") {
          const value = owner.value;
          if (typeof value === "number") fields.push({ key: property, label: propertyLabel(property), control: { kind: "number", value, unit: bareUnitOf(property), editable: true, onCommit: (next) => write(property, at, next, String(next)) } });
          else {
            const match = /^(-?\d+(?:\.\d+)?)([a-z%]*)$/i.exec(value.trim());
            if (match) {
              const unit = match[2]!;
              fields.push({ key: property, label: propertyLabel(property), control: { kind: "number", value: Number(match[1]), unit, editable: true, onCommit: (next) => write(property, at, next, `${next}${unit}`) } });
            } else if (COLOUR.test(value.trim())) {
              fields.push({ key: property, label: propertyLabel(property), control: { kind: "colour", value, editable: true, onCommit: (next) => write(property, at, next, next) } });
            } else fields.push({ key: property, label: propertyLabel(property), control: { kind: "text", value } });
          }
        } else if (owner.kind === "dial") {
          const current = dialAt(dials, owner.path.join("."));
          const path = owner.path.join(".");
          const parameter = owner.path.join(" › ");
          const editable = dialLimitOf(schema, owner.path) !== null || schema === undefined;
          if (typeof current === "number") fields.push({ key: property, label: propertyLabel(property), parameter, control: { kind: "number", value: current, unit: bareUnitOf(property), editable, onCommit: (next) => session.patchDial(path, next) } });
          else fields.push({ key: property, label: propertyLabel(property), parameter, control: { kind: "text", value: String(current ?? "") } });
        } else if (owner.kind === "token") {
          const text = tokenText(owner.name);
          const types = COLOUR.test(text) ? ["color"] : ["dimension"];
          fields.push({
            key: property,
            label: propertyLabel(property),
            control: { kind: "text", value: text },
            token: {
              name: owner.name,
              value: text,
              options: tokensOf(types),
              onChoose: (path) => write(property, at, { token: path }),
              onDetach: () => write(property, at, text),
            },
          });
        } else {
          fields.push({ key: property, label: propertyLabel(property), control: { kind: "text", value: owner.text }, note: "Set by the agent's code.", ask: () => askAgent(property, tween, target) });
        }
      }
    }
    const count = tween.repeat?.count;
    const repeat = tween.repeat === null ? null : `${count === undefined || count === null ? "Repeats forever" : count < 0 ? "Repeats forever" : `Repeats ${count} times`}${tween.repeat.yoyo ? ", back and forth" : ""}`;
    const sentence =
      timing.at === null ? null : timing.at === 0 && tween.method === "to" ? "Starts from the element's current look." : timing.at === 1 && tween.method === "from" ? "Ends at the element's own style." : null;
    // A bar in a collapsed row names no group: the group is the one the tween holds, or the one of the value the diamond opened on.
    const first = timing.at === null ? undefined : Object.keys(tween.keyframes.find((candidate) => Math.abs(candidate.at - timing.at!) < 1e-6)?.values ?? {})[0];
    const groupName = timingBar.group ?? (first !== undefined ? groupOfKey(first) : tween.groups.length === 1 ? tween.groups[0]! : null);
    const group = groupName === null ? null : groupName.charAt(0).toUpperCase() + groupName.slice(1);
    // The popover sits beside the bar, or the keyframe, it opened from: found again by its tween and target each time it is placed.
    const opened = timing;
    const anchor = () => {
      const selector =
        opened.at === null
          ? `[data-testid="timeline-bar"][data-tween="${tween.ref.index}"][data-target="${CSS.escape(target)}"]`
          : `[data-testid="timeline-diamond"][data-tween="${tween.ref.index}"][data-target="${CSS.escape(target)}"][data-fraction="${opened.at}"]`;
      return scroller.current?.querySelector(selector) ?? null;
    };
    // A read-only tween shows its computed layout as text: nothing in it takes a value, and the sentence above says why once.
    const shown = tween.readOnly === null ? fields : fields.map((field): PanelField => readOnlyField(field));
    return {
      title: names[target] ?? target,
      group,
      method: tween.method,
      fields: shown,
      ease: easeField === null ? null : { label: easeField.label, choices: easeField.choices, disabled: easeField.disabled },
      onEase: (value) => easeField?.value(value),
      repeat,
      sentence,
      readOnly: tween.readOnly,
      ask: tween.readOnly === null ? null : () => askAgent("animation", tween, target),
      anchor,
    };
  };
  const panel = panelOf();

  /** Opens the values panel from a bar (its timing) or from a diamond (the values at that keyframe too). */
  /** A bar's accessible name: its element, its group, and its span (spec 21, Rows, lanes and diamonds). */
  const barLabel = (bar: BarView): string => {
    const element = names[bar.target] ?? bar.target;
    const group = bar.group ?? tweens.get(bar.tween)?.groups[0];
    return `${group ? `${element} ${group}` : element} tween, ${round(bar.start)} s to ${round(bar.start + bar.duration)} s`;
  };
  const keyframeLabel = (bar: BarView, at: number): string => `Keyframe of ${names[bar.target] ?? bar.target} at ${at.toFixed(1)} s`;
  /** The keyboard alternative to a drag (spec 21, Keys): an arrow moves a focused bar a frame, Shift ten, and Alt with an arrow changes its duration. */
  const onBarKey = (bar: BarView, row: RowView, event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openValues(bar, null);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const tween = tweens.get(bar.tween);
    if (tween === undefined) return;
    const rights = allowed(bar, row);
    const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowLeft" ? -1 : 1) * FRAME_SECONDS;
    const changed: { start?: number; duration?: number } = {};
    if (event.altKey) {
      if (!rights.end) return;
      changed.duration = Math.max(MIN_DURATION, round(bar.duration + step));
    } else {
      if (!rights.move) return;
      changed.start = Math.max(0, round(bar.start - (bar.stagger ?? 0) + step));
    }
    applyTiming(tween.ref, bar.target, channelsOf(tween), changed);
  };
  const openValues = (bar: BarView, fraction: number | null) => {
    if (bar.tween < 0) return;
    setSelectedTween(bar.tween);
    setTiming({ tween: bar.tween, target: bar.target, at: fraction });
  };
  const onBarUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (gesture.current === null) return;
    gesture.current = null;
    setGuide(null);
    setBarDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // The loop range shades the ruler between its In and Out (or the ends it does not set).
  const showRange = (range.start !== null || range.end !== null) && length > 0;
  const rangeStart = range.start ?? 0;
  const rangeEnd = range.end ?? length;
  // The ruler's ticks, one step apart on the track, and the track's width: the length at this zoom, or the strip's width when that is more.
  const step = pxPerSecond > 0 ? rulerStep(pxPerSecond) : 1;
  const ticks: number[] = [];
  for (let at = 0; length > 0 && at <= length + 1e-9; at += step) ticks.push(Math.round(at * 1000) / 1000);
  const trackWidth = Math.max(length * pxPerSecond, width - labelWidth);
  const trackTotal = trackWidth + labelWidth;

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
        <div
          data-timeline-focus
          tabIndex={-1}
          className="relative flex min-h-0 flex-1 flex-col outline-none"
          onKeyDown={(event) => {
            // The values panel sits inside this area in the React tree, so its own Enter would bubble here and reopen the panel at the bar.
            if (event.key !== "Enter" || selectedTween === null || (event.target as HTMLElement).closest('[data-testid="values-panel"]')) return;
            const bar = rows.flatMap((row) => row.bars).find((candidate) => candidate.tween === selectedTween);
            if (bar === undefined) return;
            event.preventDefault();
            openValues(bar, null);
          }}
        >
          {/* The scroller scrolls the time (Shift and the wheel) and the rows (the wheel); the ruler stays on top. */}
          <div ref={scroller} data-testid="timeline-scroll" className="relative min-h-0 flex-1 overflow-auto" onScroll={measureView}>
            <div data-testid="timeline-track" data-px-per-second={pxPerSecond} className="relative flex min-h-full flex-col" style={{ width: trackTotal }}>
              <div className="sticky top-0 z-10 flex h-6 flex-none">
                <div className="sticky left-0 z-20 flex-none border-b border-r bg-card" style={{ width: labelWidth }} />
                <div
                  ref={rulerTime}
                  data-testid="timeline-ruler"
                  className="relative h-6 flex-none touch-none border-b bg-card"
                  style={{ width: trackWidth }}
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
                  {range.start !== null && length > 0 && (
                  <LoopHandle label="Loop In" testId="timeline-loop-in" at={range.start * pxPerSecond} onDown={(event) => onHandleDown("in", event)} onMove={onHandleMove} onUp={onHandleUp} />
                )}
                {range.end !== null && length > 0 && (
                  <LoopHandle label="Loop Out" testId="timeline-loop-out" at={range.end * pxPerSecond} onDown={(event) => onHandleDown("out", event)} onMove={onHandleMove} onUp={onHandleUp} />
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
                  {length > 0 && (
                    <div
                      data-testid="timeline-end-handle"
                      role="presentation"
                      title={endEditable ? undefined : "The length is set by the agent's code."}
                      className={cn("absolute inset-y-0 z-[5] w-3 -translate-x-1/2 touch-none", endEditable ? "cursor-ew-resize" : "cursor-not-allowed")}
                      style={{ left: length * pxPerSecond }}
                      onPointerDown={onEndDown}
                      onPointerMove={onEndMove}
                      onPointerUp={onEndUp}
                      onPointerCancel={onEndUp}
                    />
                  )}
                </div>
              </div>
              <div ref={rowsRef} data-testid="timeline-rows" className="relative flex min-h-0 flex-1 flex-col" onClick={() => setSelectedTween(null)}>
                {current?.value?.script === "none" && <p className="sticky left-0 p-2 text-xs text-muted-foreground">This motion has no GSAP timeline the editor can read.</p>}
                {current?.value?.script === "unreadable" && <p className="sticky left-0 p-2 text-xs text-muted-foreground">The timeline script could not be read.</p>}
                {current?.error !== undefined && <p className="sticky left-0 p-2 text-xs text-muted-foreground">{current.error}</p>}
                <div aria-hidden style={{ height: rowTops.tops[visible.first] ?? 0 }} />
                {rows.slice(visible.first, visible.last).map((row) => (
                  <RowLine
                    key={row.key}
                    row={row}
                    compact={compact}
                    pxPerSecond={pxPerSecond}
                    timeWidth={trackWidth}
                    selected={row.element !== null && selected.has(row.element)}
                    selectedTween={selectedTween}
                    onToggle={() => setExpanded((previous) => toggled(previous, row.key))}
                    onSelectElement={(id) => {
                      setSelectedTween(null);
                      session.setSelection([id]);
                    }}
                    cursorOf={(bar) => cursorOf(bar, row)}
                    onBarDown={(bar, event) => onBarDown(bar, row, event)}
                    onBarKey={(bar, event) => onBarKey(bar, row, event)}
                    barLabel={barLabel}
                    keyframeLabel={keyframeLabel}
                    onBarMove={onBarMove}
                    onBarUp={onBarUp}
                    onDiamondDown={(bar, event) => onDiamondDown(bar, row, event)}
                    onDiamondClick={onDiamondClick}
                    onOpenValues={openValues}
                    clipNote={clipNoteFor(row)}
                    onClipDown={(event) => onClipDown(row, event)}
                    onClipMove={onClipMove}
                    onClipUp={onClipUp}
                  />
                ))}
                <div aria-hidden style={{ height: bottomSpace }} />
              </div>
              {length > 0 && length * pxPerSecond < trackWidth && (
                <div data-testid="timeline-past-end" aria-hidden className="pointer-events-none absolute inset-y-0 bg-background/60" style={{ left: labelWidth + length * pxPerSecond, right: 0 }} />
              )}
              {guide !== null && (
                <div data-testid="timeline-snap-guide" aria-hidden className="pointer-events-none absolute inset-y-0 w-0 border-l-2 border-dashed border-foreground/80" style={{ left: labelWidth + guide * pxPerSecond }} />
              )}
              <div ref={playhead} data-testid="timeline-playhead" aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-px bg-primary" />
            </div>
          </div>
          {panel !== null && <ValuesPanel {...panel} onClose={() => setTiming(null)} />}
          {barDragging && (
            <p data-testid="timeline-free-hint" className="pointer-events-none absolute bottom-1 right-3 text-xs text-muted-foreground">
              {freeHint()}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
