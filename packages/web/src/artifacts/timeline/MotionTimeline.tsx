import { ChevronDown, ChevronLeft, ChevronRight, Code, Film, Layers, Lock, Maximize2, Minus, PanelBottom, Pause, Play, Repeat, Square, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent, type CSSProperties, type ReactElement } from "react";
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

const TRANSPORT_HEIGHT = 40;

const LABEL_WIDTH = 160;

const END_INSET = 24;

const COMPACT_WIDTH = 480;
const COMPACT_LABEL = 24;

const EDGE_PIXELS = 6;

const VIEW_OVERSCAN = 240;

const DRAG_PIXELS = 3;

const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|[a-z]+$)/i;

type PanelProps = Omit<ValuesPanelProps, "onClose">;

const MIN_DURATION = 0.033;
const FRAME_SECONDS = 1 / 30;

const round = (seconds: number): number => Math.round(seconds * 1000) / 1000;

type GestureMode = "move" | "start" | "end";

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

interface Gesture {
  readonly mode: GestureMode;
  readonly bar: BarView;
  readonly target: string;
  readonly ref: TweenRef;
  readonly channels: string[];
  readonly startX: number;
  readonly startY: number;
  moved: boolean;
  readonly origin: number;
  readonly end: number;
  readonly offset: number;
  last: string;
}

interface ClipGesture {
  readonly mode: GestureMode;
  readonly clip: string;
  readonly startX: number;
  readonly origin: number;
  readonly end: number;
  readonly dials: Readonly<Record<string, unknown>>;
  readonly pxPerSecond: number;
}

const freeHint = (): string => (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "Hold Option to place freely" : "Hold Alt to place freely");

const Hint = ({ label, children }: { readonly label: string | null | undefined; readonly children: ReactElement }) => (label ? <Tip label={label}>{children}</Tip> : children);

const tickLabel = (seconds: number): string => `${Number(seconds.toFixed(2))} s`;

interface MotionTimelineProps {
  readonly title: string;
  readonly closePanel: { current: (() => boolean) | undefined };
  readonly engine: EngineConnection;
  readonly project: string;
  readonly file: string;
  readonly session: EditSession;
  readonly dials: Readonly<Record<string, unknown>>;
  readonly schema: DialSchema | undefined;
  readonly locked: readonly string[];
  readonly column: number;
  readonly transport: MotionTransport;
  readonly onAsk: (field: string, elements: ChipElement[]) => void;
  readonly kit: Kit | null;
  readonly mode: string | undefined;
  readonly reveal?: { readonly element: string; readonly property: string; readonly nonce: number } | undefined;
  readonly className?: string;
}

const NO_EDITS: readonly SourceEdit[] = [];

interface ReadingState {
  readonly file: string;
  readonly value?: MotionTimelineReading;
  readonly error?: string;
}

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
  readonly barLabel: (bar: BarView) => string;
  readonly keyframeLabel: (bar: BarView, at: number) => string;
  readonly onBarMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onBarUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDiamondDown: (bar: BarView, event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDiamondClick: (bar: BarView, fraction: number, event: ReactMouseEvent<HTMLElement>) => void;
  readonly onOpenValues: (bar: BarView, fraction: number | null) => void;
  readonly clipNote?: string | null | undefined;
  readonly onClipDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onClipMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onClipUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) => {
  const runtime = row.kind === "runtime";
  const name = row.name;
  const tip = runtime ? "Made by the agent's code while the motion runs." : name;
  const lanes = laneOf(row.bars);
  const keyframes = row.bars.flatMap((bar) => (bar.copy ? [] : bar.diamonds));
  const hitSide = (at: number): number => {
    let gap = Infinity;
    let skipped = false;
    for (const other of keyframes) {
      if (other === at && !skipped) {
        skipped = true;
        continue;
      }
      gap = Math.min(gap, Math.abs(other - at) * pxPerSecond);
    }
    return Math.max(0, (Math.min(24, gap) - 10) / 2);
  };
  return (
    <div
      data-testid="timeline-row"
      data-row-kind={row.kind}
      data-row-name={name}
      data-row-key={row.element ?? row.key}
      data-selected={selected ? "true" : undefined}
      data-hidden={row.hidden ? "true" : undefined}
      className={cn("flex flex-none", selected && "bg-accent/40", runtime && "text-muted-foreground", row.hidden && "opacity-50")}
      style={{ height: row.height }}
    >
      {compact ? (
        <div className="sticky left-0 z-10 flex flex-none items-center justify-center overflow-hidden border-b border-r bg-card text-xs" style={{ width: COMPACT_LABEL }}>
          {row.locked && <Lock aria-hidden data-testid="timeline-lock" aria-label="Locked. Unlock it in Layers to edit it." className="absolute bottom-0 right-0 size-2.5 text-muted-foreground" />}
          <div className="flex items-center">
            {row.expandable && (
              <Tip label={tip}>
                <Button variant="ghost" size="icon-micro" className="-my-1.5 h-6 w-3" aria-label={`${row.expanded ? "Collapse" : "Expand"} ${name}`} onClick={onToggle}>
                  {row.expanded ? <ChevronDown aria-hidden className="size-2.5" /> : <ChevronRight aria-hidden className="size-2.5" />}
                </Button>
              </Tip>
            )}
            {row.kind === "element" && row.element !== null ? (
              <Tip label={tip}>
                <Button variant="ghost" size="icon-micro" className="-my-1.5 h-6 w-3" aria-label={`Select ${name}`} onClick={() => onSelectElement(row.element!)}>
                  <Square aria-hidden className="size-2.5" />
                </Button>
              </Tip>
            ) : !row.expandable ? (
              <Tip label={tip}>
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
          <Tip label={tip}>
            <Button variant="ghost" size="xs" className="h-6 min-w-0" aria-label={`Select ${name}`} onClick={() => onSelectElement(row.element!)}>
              <span className="truncate">{name}</span>
            </Button>
          </Tip>
        ) : (
          <Tip label={tip}>
            <span className={cn("truncate", row.kind === "composition" && "font-medium", row.kind === "clip" && "font-medium")}>{name}</span>
          </Tip>
        )}
        {row.locked && <Lock aria-hidden data-testid="timeline-lock" aria-label="Locked. Unlock it in Layers to edit it." className="ml-auto size-3 flex-none text-muted-foreground" />}
      </div>
      )}
      <div className="relative flex-none border-b" style={{ width: timeWidth, height: row.height }}>
        {row.span !== null && (
          <Hint label={clipNote}>
            <div
              data-testid="timeline-clip-bar"
              data-start={row.span.start}
              data-duration={row.span.duration}
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
          </Hint>
        )}
        {row.bars.map((bar, index) => {
          const thin = (row.kind === "element" && !row.expanded) || lanes.lanes > 1;
          const chosen = bar.tween >= 0 && bar.tween === selectedTween;
          const centre = ((lanes.lane[index] ?? 0) + 0.5) / lanes.lanes;
          return (
            <Hint key={`${bar.tween}:${bar.target}:${bar.group ?? ""}:${index}`} label={bar.readOnly}>
              <div
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
                onKeyDown={(event) => onBarKey(bar, event)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onBarDown(bar, event);
                }}
                onPointerMove={onBarMove}
                onPointerUp={onBarUp}
                onPointerCancel={onBarUp}
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
            </Hint>
          );
        })}
        {row.bars.flatMap((bar, index) =>
          bar.copy
            ? []
            : bar.diamonds.map((at, step) => {
                const fraction = bar.duration > 0 ? Math.round(((at - bar.start) / bar.duration) * 1000) / 1000 : 0;
                return (
                  <span
                    key={`${index}:${step}`}
                    role="button"
                    tabIndex={0}
                    aria-label={keyframeLabel(bar, at)}
                    data-testid="timeline-diamond"
                    data-tween={bar.tween}
                    data-target={bar.target}
                    data-fraction={fraction}
                    className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rotate-45 bg-foreground before:absolute before:-inset-y-[7px] before:-inset-x-[var(--hit-side)] before:-rotate-45 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ left: at * pxPerSecond, "--hit-side": `${hitSide(at)}px` } as CSSProperties}
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
  const current = reading?.file === file || reading?.value !== undefined ? reading : undefined;
  const settledEdits = session.settled !== undefined && session.settled.base === current?.file ? session.settled.edits : NO_EDITS;

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const selectedTween = session.tween;
  const setSelectedTween = session.setTween;
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
    const ruler = 24;
    if (top < element.scrollTop + ruler) element.scrollTop = top - ruler;
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
  };
  const rowOfTween = (tween: number) => rows.findIndex((row) => row.bars.some((bar) => bar.tween === tween));

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
      revealRow(rowOfTween(index));
      return;
    }
    scrollToTween.current = null;
    bar.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  const drag = useRef<{ startY: number; startHeight: number; latest: number } | null>(null);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const height = open ? clampTimelineHeight(dragging ?? prefs.height, column) : TRANSPORT_HEIGHT;
  useLayoutEffect(() => measureView(), [open, height, rows]);
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

  const scroller = useRef<HTMLDivElement>(null);
  const rulerTime = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const labelWidth = width > 0 && width < COMPACT_WIDTH ? COMPACT_LABEL : LABEL_WIDTH;
  const compact = labelWidth === COMPACT_LABEL;
  const labelRef = useRef(labelWidth);
  labelRef.current = labelWidth;
  const [zoom, setZoom] = useState<number | null>(null);
  const fit = width > labelWidth && length > 0 ? fitZoom(width - labelWidth - END_INSET, length) : 0;
  const pxPerSecond = zoom === null ? fit : zoom * fit;
  const pxRef = useRef(pxPerSecond);
  pxRef.current = pxPerSecond;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const pendingScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingScroll.current === null || !scroller.current) return;
    scroller.current.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  });

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
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || fitRef.current <= 0) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
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
    event.currentTarget.closest<HTMLElement>("[data-timeline-focus]")?.focus();
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

  const handleSide = useRef<"in" | "out" | null>(null);
  const onHandleDown = (side: "in" | "out", event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
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

  const onResizeDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
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

  const gesture = useRef<Gesture | null>(null);
  const diamondMoved = useRef(false);
  const [guide, setGuide] = useState<number | null>(null);
  const [barDragging, setBarDragging] = useState(false);
  const pendingTiming = (index: number): { start?: number; duration?: number | { token: string } } | undefined =>
    session.pending.find((edit): edit is Extract<typeof edit, { type: "tween-time" }> => edit.type === "tween-time" && edit.tween.index === index);
  const editable = (owner: Owner): boolean => owner.kind === "source" || (owner.kind === "dial" && dialLimitOf(schema, owner.path) !== null);
  const allowed = (bar: BarView, row: RowView): { move: boolean; start: boolean; end: boolean } => {
    const tween = tweens.get(bar.tween);
    if (tween === undefined || tween.readOnly !== null || row.locked || bar.tween < 0) return { move: false, start: false, end: false };
    if (tween.method === "set") return { move: editable(tween.start), start: false, end: false };
    const startOk = editable(tween.start);
    const endOk = editable(tween.duration);
    return { move: startOk, start: startOk && endOk, end: endOk };
  };
  const cursorOf = (bar: BarView, row: RowView): string => {
    const rights = allowed(bar, row);
    return rights.move || rights.start || rights.end ? "cursor-grab" : "cursor-not-allowed";
  };
  const beginGesture = (bar: BarView, row: RowView, event: ReactPointerEvent<HTMLElement>, local: number, width: number, fromDiamond: boolean): void => {
    setSelectedTween(bar.tween);
    if (row.element !== null && !session.selection.includes(row.element)) session.setSelection([row.element]);
    const rights = allowed(bar, row);
    const edge = Math.min(EDGE_PIXELS, width / 3);
    const nearStart = local <= edge && rights.start;
    const nearEnd = width - local <= edge && rights.end;
    const mode: GestureMode | null = nearStart && nearEnd ? (local <= width / 2 ? "start" : "end") : nearStart ? "start" : nearEnd ? "end" : rights.move ? "move" : null;
    if (mode === null) return;
    const tween = tweens.get(bar.tween)!;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { mode, bar, target: bar.target, ref: tween.ref, channels: channelsOf(tween), startX: event.clientX, startY: event.clientY, moved: !fromDiamond, origin: bar.start, end: bar.start + bar.duration, offset: bar.stagger ?? 0, last: "" };
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
    const area = event.currentTarget.parentElement?.getBoundingClientRect();
    if (area === undefined) return;
    const left = area.left + bar.start * pxRef.current;
    beginGesture(bar, row, event, event.clientX - left, Math.max(bar.duration * pxRef.current, 2), true);
  };
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
  const applyTiming = (ref: TweenRef, target: string, channels: string[], changed: { start?: number; duration?: number }): void => {
    const tween = tweens.get(ref.index);
    const literal: { start?: number; duration?: number } = {};
    for (const field of ["start", "duration"] as const) {
      const value = changed[field];
      const owner = tween?.[field];
      if (value === undefined || owner === undefined) continue;
      if (owner.kind === "source" || owner.kind === "token") literal[field] = value;
      else if (owner.kind === "dial") {
        const limit = dialLimitOf(schema, owner.path);
        if (limit !== null) session.patchDial(owner.path.join("."), clampDialValue(limit, value));
      }
    }
    if (literal.start === undefined && literal.duration === undefined) return;
    const pending = pendingTiming(ref.index);
    const fields = { start: literal.start ?? pending?.start, duration: literal.duration ?? pending?.duration };
    const edit = { type: "tween-time" as const, tween: ref, ...(fields.start === undefined ? {} : { start: fields.start }), ...(fields.duration === undefined ? {} : { duration: fields.duration }) };
    const change = { ...(fields.start === undefined ? {} : { start: fields.start }), ...(typeof fields.duration === "number" ? { duration: fields.duration } : {}) };
    session.patchTween(edit, { selector: target, channels, change });
  };

  const applyEase = (tween: Tween, target: string, value: EaseValue): void => {
    if (tween.ease?.kind === "dial") {
      if (typeof value === "string") session.patchDial(tween.ease.path.join("."), value);
      return;
    }
    const channels = channelsOf(tween);
    session.patchTween({ type: "tween-ease", tween: tween.ref, ease: value }, { selector: target, channels, change: typeof value === "string" ? { ease: value } : {} });
  };
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

  const endDrag = useRef<{ startX: number; origin: number; pxPerSecond: number } | null>(null);
  const endEditable = current?.value?.length.kind === "source";
  const onEndDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || length <= 0 || !endEditable) return;
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

  const clipGesture = useRef<ClipGesture | null>(null);
  const clipAt = (hfId: string): ClipOf | undefined => current?.value?.clips.find((clip) => clip.hfId === hfId);
  const clipSpan = (clip: ClipOf): { start: number; end: number } | null => {
    const moved = session.pending.find((edit): edit is Extract<typeof edit, { type: "clip-time" }> => edit.type === "clip-time" && edit.clip === clip.hfId);
    const start = moved?.start ?? numberOf(clip.start, dials);
    const duration = moved?.duration ?? numberOf(clip.duration, dials);
    return start === undefined || duration === undefined ? null : { start, end: start + duration };
  };
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
    const held = session.pending.some((edit) => edit.type === "clip-time" && edit.clip === drag.clip && edit.duration !== undefined);
    const clipEdit = { type: "clip-time" as const, clip: drag.clip, start, ...(drag.mode !== "move" || held ? { duration } : {}) };
    session.patch(clipEdit);
    if (current?.value !== undefined) {
      const others = session.pending.filter((edit) => !(edit.type === "clip-time" && edit.clip === drag.clip));
      for (const timed of carriedTimingOf(current.value, [...others, clipEdit], dials)) {
        if (timed.type !== "tween-time") continue;
        const tween = tweens.get(timed.tween.index);
        const selector = tween?.targets[0];
        if (tween === undefined || selector === undefined) continue;
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

  const applyStagger = (ref: TweenRef, target: string, channels: string[], each: number): void => {
    session.patchTween({ type: "tween-stagger", tween: ref, each }, { selector: target, channels, change: { stagger: each } });
  };


  const timingBar = timing === null ? undefined : rows.flatMap((row) => row.bars).find((bar) => bar.tween === timing.tween && bar.target === timing.target);
  const timingTween = timing === null ? undefined : tweens.get(timing.tween);
  const timingEach = timingTween === undefined ? null : staggerEachOf(timingTween, session.pending);
  const easeField = timingTween === undefined || timing === null ? null : easeFieldOf(timingTween, timing.target);

  const tokenText = (path: string): string => {
    const value = kit === null ? undefined : resolve(kit, path, mode);
    return value === undefined ? "" : String(value);
  };
  const tokensOf = (types: readonly string[]) => (kit?.tokens ?? []).filter((token) => types.includes(token.type)).map((token) => ({ path: token.path, value: tokenText(token.path) }));

  const askAgent = (field: string, tween: Tween, target: string) => {
    const chip: ChipElement = { elementId: target, liveSelector: "", tag: "div", label: names[target] ?? target, startTag: "", text: "", hasChildren: false, excerpt: tween.source };
    onAsk(field, [chip]);
  };

  const readOnlyField = (field: PanelField): PanelField => {
    const control: PanelControl = field.control.kind === "text" ? field.control : { ...field.control, editable: false };
    return { key: field.key, label: field.label, control };
  };

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
    const first = timing.at === null ? undefined : Object.keys(tween.keyframes.find((candidate) => Math.abs(candidate.at - timing.at!) < 1e-6)?.values ?? {})[0];
    const groupName = timingBar.group ?? (first !== undefined ? groupOfKey(first) : tween.groups.length === 1 ? tween.groups[0]! : null);
    const group = groupName === null ? null : groupName.charAt(0).toUpperCase() + groupName.slice(1);
    const opened = timing;
    const anchor = () => {
      const selector =
        opened.at === null
          ? `[data-testid="timeline-bar"][data-tween="${tween.ref.index}"][data-target="${CSS.escape(target)}"]`
          : `[data-testid="timeline-diamond"][data-tween="${tween.ref.index}"][data-target="${CSS.escape(target)}"][data-fraction="${opened.at}"]`;
      return scroller.current?.querySelector(selector) ?? null;
    };
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

  const barLabel = (bar: BarView): string => {
    const element = names[bar.target] ?? bar.target;
    const group = bar.group ?? tweens.get(bar.tween)?.groups[0];
    return `${group ? `${element} ${group}` : element} tween, ${round(bar.start)} s to ${round(bar.start + bar.duration)} s`;
  };
  const keyframeLabel = (bar: BarView, at: number): string => `Keyframe of ${names[bar.target] ?? bar.target} at ${at.toFixed(1)} s`;
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

  const showRange = (range.start !== null || range.end !== null) && length > 0;
  const rangeStart = range.start ?? 0;
  const rangeEnd = range.end ?? length;
  const step = pxPerSecond > 0 ? rulerStep(pxPerSecond) : 1;
  const ticks: number[] = [];
  for (let at = 0; length > 0 && at <= length + 1e-9; at += step) ticks.push(Math.round(at * 1000) / 1000);
  const trackWidth = Math.max(length * pxPerSecond, width - labelWidth);
  const endFlip = length * pxPerSecond + 40 > trackWidth;
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
      <header data-testid="timeline-transport" className="flex min-h-10 flex-none flex-wrap items-center gap-x-1 gap-y-1 border-b px-2 py-1">
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
        <div
          data-timeline-focus
          tabIndex={-1}
          className="relative flex min-h-0 flex-1 flex-col outline-none"
          onKeyDown={(event) => {
            if (event.key !== "Enter" || selectedTween === null || (event.target as HTMLElement).closest('[data-testid="values-panel"]')) return;
            const bar = rows.flatMap((row) => row.bars).find((candidate) => candidate.tween === selectedTween);
            if (bar === undefined) return;
            event.preventDefault();
            openValues(bar, null);
          }}
        >
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
                    <span key={at} data-testid="timeline-tick" data-time={at} aria-hidden className="pointer-events-none absolute inset-y-0 border-l pl-1 text-3xs leading-6 text-muted-foreground" style={{ left: at * pxPerSecond }}>
                      {tickLabel(at)}
                    </span>
                  ))}
                  {length > 0 && (
                    <span
                      data-testid="timeline-end"
                      className={cn("pointer-events-none absolute inset-y-0 border-foreground text-3xs leading-6 font-medium", endFlip ? "border-r-2 pr-1 text-right" : "border-l-2 pl-1")}
                      style={{ left: length * pxPerSecond, transform: endFlip ? "translateX(-100%)" : undefined }}
                    >
                      {tickLabel(length)}
                    </span>
                  )}
                  {length > 0 && (
                    <Hint label={endEditable ? null : "The length is set by the agent's code."}>
                      <div
                        data-testid="timeline-end-handle"
                        role="presentation"
                        className={cn("absolute inset-y-0 z-[5] w-3 -translate-x-1/2 touch-none", endEditable ? "cursor-ew-resize" : "cursor-not-allowed")}
                        style={{ left: length * pxPerSecond }}
                        onPointerDown={onEndDown}
                        onPointerMove={onEndMove}
                        onPointerUp={onEndUp}
                        onPointerCancel={onEndUp}
                      />
                    </Hint>
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
              {length > 0 && length * pxPerSecond + END_INSET < trackWidth && (
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
