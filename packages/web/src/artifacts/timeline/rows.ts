/**
 * The timeline's rows (spec 21, Rows, lanes and diamonds): what each row, lane and bar is, built from the
 * motion's reading, the dial values the frame runs, the burst's pending timing and the live tween report.
 * Pure: the strip only draws what this returns.
 */
import { dialAt, type DialLimit, type DialSchema, type PropertyGroup, type Tween, type Owner } from "@unframed/domain";
import type { MotionTimelineReading, SourceEdit } from "@unframed/contracts";

/** A row's height in pixels, and a lane's: the strip's row grid. */
export const ROW_HEIGHT = 24;
export const LANE_HEIGHT = 20;

/** The groups in the order the lanes show them (spec 21, Groups). */
export const GROUP_ORDER: readonly PropertyGroup[] = ["position", "scale", "size", "rotation", "visual", "other"];

/** One tween's entry in the live report (`unframed:edit:tweens`), as the bridge posts it. */
export interface LiveTween {
  readonly targets: readonly string[];
  readonly start: number;
  readonly duration: number;
  readonly keyframes: readonly number[];
  readonly props: readonly string[];
  readonly repeat: number;
  readonly yoyo: boolean;
}

export interface BarView {
  /** The tween's source order, which names it in the burst. */
  readonly tween: number;
  /** The element the bar is drawn on, by `data-hf-id` (or the runtime selector). */
  readonly target: string;
  readonly group: PropertyGroup | null;
  readonly start: number;
  readonly duration: number;
  /** A repeat's copy, drawn lighter after the bar. */
  readonly copy: boolean;
  /** The bar's target offset within a stagger, in seconds. Null when the tween does not stagger. */
  readonly stagger: number | null;
  readonly readOnly: string | null;
  /** Keyframe diamonds on this bar, in seconds. */
  readonly diamonds: readonly number[];
}

export interface RowView {
  readonly key: string;
  readonly kind: "clip" | "composition" | "element" | "lane" | "runtime";
  readonly name: string;
  /** The element, by `data-hf-id`; null for a runtime row. */
  readonly element: string | null;
  readonly depth: number;
  readonly height: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly bars: readonly BarView[];
  /** A clip's span, drawn as its bar. */
  readonly span: { readonly start: number; readonly duration: number } | null;
  readonly group: PropertyGroup | null;
}

/** What the rows need from the editor's state. */
export interface RowsInput {
  readonly reading: MotionTimelineReading;
  /** The layer names the source tree gives, by `data-hf-id`: a row is named as Layers names it. */
  readonly names: Readonly<Record<string, string>>;
  /** The dial values the frame runs, by path. */
  readonly dials: Readonly<Record<string, unknown>>;
  /** The burst's source edits: a tween's pending start or duration is drawn in place of its source. */
  readonly pending: readonly SourceEdit[];
  readonly live: readonly LiveTween[];
  readonly expanded: ReadonlySet<string>;
  readonly locked: readonly string[];
  readonly hidden: ReadonlySet<string>;
}

export const numberOf = (owner: Owner, dials: Readonly<Record<string, unknown>>): number | undefined => {
  if (owner.kind === "source") return typeof owner.value === "number" ? owner.value : undefined;
  if (owner.kind === "dial") {
    const value = dialAt(dials, owner.path.join("."));
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
  return undefined;
};

/** The seconds between a tween's targets: the file's literal stagger, or the burst's pending one; null when the tween does not stagger. */
export const staggerEachOf = (tween: Tween, pending: readonly SourceEdit[]): number | null => {
  const edit = pending.find((candidate): candidate is Extract<SourceEdit, { type: "tween-stagger" }> => candidate.type === "tween-stagger" && candidate.tween.index === tween.ref.index);
  if (edit !== undefined) return edit.each;
  return tween.stagger?.kind === "source" && typeof tween.stagger.value === "number" ? tween.stagger.value : null;
};

/** Each target's offset in a stagger (spec 21, Staggers): the literal `each`, or the literal `amount` spread across the targets. */
const offsetsOf = (tween: Tween, count: number, each: number | null, pending: readonly SourceEdit[]): number[] => {
  if (each === null || tween.staggerForm === null || tween.staggerForm === "other") return Array.from({ length: count }, () => 0);
  const pendingEdit = pending.some((edit) => edit.type === "tween-stagger" && edit.tween.index === tween.ref.index);
  const form = pendingEdit ? "number" : tween.staggerForm;
  return Array.from({ length: count }, (_, index) => {
    if (form === "amount") return count > 1 ? (index * each) / (count - 1) : 0;
    return index * each;
  });
};

/** The channels a tween animates: every property its keyframes name, the same set the bridge matches by. */
export const channelsOf = (tween: Tween): string[] => [...new Set(tween.keyframes.flatMap((step) => Object.keys(step.values)))].sort();

/** The timing of one tween as drawn: its source, a dial's value, or a pending edit. Undefined when no value is known. */
const timingOf = (tween: Tween, input: RowsInput, live: LiveTween | undefined): { start: number; duration: number } | null => {
  let start = numberOf(tween.start, input.dials);
  let duration = numberOf(tween.duration, input.dials);
  for (const edit of input.pending) {
    if (edit.type !== "tween-time" || edit.tween.index !== tween.ref.index) continue;
    if (edit.start !== undefined) start = edit.start;
    if (edit.duration !== undefined) duration = edit.duration;
  }
  start ??= live?.start;
  duration ??= live?.duration;
  return start === undefined || duration === undefined ? null : { start, duration };
};

/** The bars one tween draws on one target, with its repeats, for a group lane or for the element as a whole. */
const barsOf = (tween: Tween, target: string, offset: number, timing: { start: number; duration: number }, group: PropertyGroup | null, stagger: number | null): BarView[] => {
  const start = timing.start + offset;
  const duration = timing.duration;
  const steps = tween.method === "set" ? [start] : tween.keyframes.filter((step) => group === null || Object.keys(step.values).some((key) => groupOfKey(key) === group)).map((step) => start + step.at * duration);
  const main: BarView = { tween: tween.ref.index, target, group, start, duration, copy: false, stagger, readOnly: tween.readOnly, diamonds: steps };
  const copies: BarView[] = [];
  const count = tween.repeat?.count;
  if (tween.repeat !== null && typeof count === "number" && count > 0) {
    for (let cycle = 1; cycle <= count; cycle++) copies.push({ ...main, start: start + cycle * duration, copy: true, diamonds: [] });
  }
  return [main, ...copies];
}

/** A property's group, as HyperFrames classes it (spec 21, Groups). */
const groupOfKey = (key: string): PropertyGroup => {
  if (["x", "y", "xPercent", "yPercent"].includes(key)) return "position";
  if (["scale", "scaleX", "scaleY"].includes(key)) return "scale";
  if (["width", "height"].includes(key)) return "size";
  if (["rotation", "skewX", "skewY"].includes(key)) return "rotation";
  if (["opacity", "autoAlpha"].includes(key)) return "visual";
  return "other";
};

/** The groups a tween animates, in lane order. */
const groupsOfTween = (tween: Tween): PropertyGroup[] => GROUP_ORDER.filter((group) => tween.groups.includes(group));

/** Whether an element, or one of its ancestors, is in a list. */
const inside = (id: string, list: ReadonlySet<string> | readonly string[], elements: MotionTimelineReading["elements"]): boolean => {
  const has = (value: string): boolean => (list instanceof Set ? list.has(value) : (list as readonly string[]).includes(value));
  for (let current: string | null = id; current !== null; current = elements[current]?.parent ?? null) {
    if (has(current)) return true;
  }
  return false;
};

/** The rows, top to bottom: the clips in track order, the Composition group, then the run-time rows. */
export const buildRows = (input: RowsInput): RowView[] => {
  const { reading, dials, expanded, locked, hidden } = input;
  const elements = reading.elements;
  const nameOf = (id: string): string => input.names[id] ?? elements[id]?.name ?? id;
  const liveUsed = new Set<number>();
  const liveFor = (tween: Tween): LiveTween | undefined => {
    const key = tween.targets.join("|");
    const index = input.live.findIndex((candidate, at) => !liveUsed.has(at) && candidate.targets.join("|") === key);
    if (index === -1) return undefined;
    liveUsed.add(index);
    return input.live[index];
  };

  // Each element's bars, per lane and as a whole, from every tween that targets it.
  const barsByElement = new Map<string, BarView[]>();
  const lanesByElement = new Map<string, Map<PropertyGroup, BarView[]>>();
  const runtimeBars = new Map<string, BarView[]>();
  for (const tween of reading.tweens) {
    const timing = timingOf(tween, input, liveFor(tween));
    if (timing === null) continue;
    const offsets = offsetsOf(tween, tween.targets.length, staggerEachOf(tween, input.pending), input.pending);
    tween.targets.forEach((target, index) => {
      const stagger = tween.targets.length > 1 ? (offsets[index] ?? 0) : null;
      const bars = barsOf(tween, target, offsets[index] ?? 0, timing, null, stagger);
      barsByElement.set(target, [...(barsByElement.get(target) ?? []), ...bars]);
      for (const group of groupsOfTween(tween)) {
        const lanes = lanesByElement.get(target) ?? new Map<PropertyGroup, BarView[]>();
        lanesByElement.set(target, lanes);
        lanes.set(group, [...(lanes.get(group) ?? []), ...barsOf(tween, target, offsets[index] ?? 0, timing, group, stagger)]);
      }
    });
  }
  for (const live of input.live) {
    for (const target of live.targets) {
      if (elements[target] !== undefined) continue;
      const bar: BarView = { tween: -1, target, group: null, start: live.start, duration: live.duration, copy: false, stagger: null, readOnly: "Made by the agent's code while the motion runs.", diamonds: [] };
      runtimeBars.set(target, [...(runtimeBars.get(target) ?? []), bar]);
    }
  }

  const element = (id: string, depth: number): RowView[] => {
    const bars = barsByElement.get(id) ?? [];
    const lanes = lanesByElement.get(id) ?? new Map<PropertyGroup, BarView[]>();
    const isOpen = expanded.has(id);
    const rows: RowView[] = [
      {
        key: id,
        kind: "element",
        name: nameOf(id),
        element: id,
        depth,
        height: ROW_HEIGHT,
        expandable: lanes.size > 0,
        expanded: isOpen,
        locked: inside(id, locked, elements),
        hidden: hidden.has(id),
        bars,
        span: null,
        group: null,
      },
    ];
    if (isOpen) {
      for (const group of GROUP_ORDER) {
        const laneBars = lanes.get(group);
        if (laneBars === undefined) continue;
        rows.push({ key: `${id}:${group}`, kind: "lane", name: group, element: id, depth: depth + 1, height: LANE_HEIGHT, expandable: false, expanded: false, locked: inside(id, locked, elements), hidden: hidden.has(id), bars: laneBars, span: null, group });
      }
    }
    return rows;
  };

  const rows: RowView[] = [];
  const clips = [...reading.clips].sort((a, b) => a.track - b.track || (startOf(a.start, dials) - startOf(b.start, dials)));
  const placed = new Set<string>();
  for (const clip of clips) {
    // A clip the burst moves or stretches is drawn where the burst puts it (spec 21, Clips).
    const moved = input.pending.find((edit): edit is Extract<SourceEdit, { type: "clip-time" }> => edit.type === "clip-time" && edit.clip === clip.hfId);
    const start = moved?.start ?? numberOf(clip.start, dials);
    const duration = moved?.duration ?? numberOf(clip.duration, dials);
    rows.push({
      key: `clip:${clip.hfId}`,
      kind: "clip",
      name: nameOf(clip.hfId),
      element: clip.hfId,
      depth: 0,
      height: ROW_HEIGHT,
      expandable: false,
      expanded: false,
      locked: inside(clip.hfId, locked, elements),
      hidden: hidden.has(clip.hfId),
      bars: [],
      span: start === undefined || duration === undefined ? null : { start, duration },
      group: null,
    });
    for (const id of Object.keys(elements)) {
      if (!barsByElement.has(id) || elements[id]?.clip !== clip.hfId) continue;
      placed.add(id);
      rows.push(...element(id, 1));
    }
  }
  const loose = Object.keys(elements).filter((id) => barsByElement.has(id) && !placed.has(id));
  if (loose.length > 0) {
    rows.push({ key: "composition", kind: "composition", name: "Composition", element: null, depth: 0, height: ROW_HEIGHT, expandable: false, expanded: false, locked: false, hidden: false, bars: [], span: null, group: null });
    for (const id of loose) rows.push(...element(id, 1));
  }
  for (const [target, bars] of runtimeBars) {
    rows.push({ key: `runtime:${target}`, kind: "runtime", name: target, element: null, depth: 0, height: ROW_HEIGHT, expandable: false, expanded: false, locked: false, hidden: false, bars, span: null, group: null });
  }
  return rows;
};

const startOf = (owner: Owner, dials: Readonly<Record<string, unknown>>): number => numberOf(owner, dials) ?? 0;

/** The limits a drag on a parameter stops at (spec 21, Dial-owned timing): a range's min, max and step, or a number's floor. Null when the schema does not name it. */
export const dialLimitOf = (schema: DialSchema | undefined, path: readonly string[]): DialLimit | null => {
  let folder: DialSchema | undefined = schema;
  for (let at = 0; at < path.length - 1; at++) {
    const entry = folder?.[path[at]!];
    if (entry?.kind !== "folder") return null;
    folder = entry.of;
  }
  const entry = folder?.[path[path.length - 1] ?? ""];
  if (entry?.kind === "range") return { kind: "range", min: entry.min, max: entry.max, ...(entry.step === undefined ? {} : { step: entry.step }) };
  if (entry?.kind === "number") return { kind: "number", value: entry.value };
  return null;
};
