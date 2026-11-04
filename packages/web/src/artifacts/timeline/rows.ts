import { dialAt, groupOfKey, type DialLimit, type DialSchema, type PropertyGroup, type Tween, type Owner } from "@unframed/domain";
import type { MotionTimelineReading, SourceEdit } from "@unframed/contracts";

const ROW_HEIGHT = 24;
const LANE_HEIGHT = 20;

const GROUP_ORDER: readonly PropertyGroup[] = ["position", "scale", "size", "rotation", "visual", "other"];

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
  readonly tween: number;
  readonly target: string;
  readonly group: PropertyGroup | null;
  readonly start: number;
  readonly duration: number;
  readonly copy: boolean;
  readonly stagger: number | null;
  readonly readOnly: string | null;
  readonly diamonds: readonly number[];
}

export interface RowView {
  readonly key: string;
  readonly kind: "clip" | "composition" | "element" | "lane" | "runtime";
  readonly name: string;
  readonly element: string | null;
  readonly depth: number;
  readonly height: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly bars: readonly BarView[];
  readonly span: { readonly start: number; readonly duration: number } | null;
  readonly group: PropertyGroup | null;
}

interface RowsInput {
  readonly reading: MotionTimelineReading;
  readonly names: Readonly<Record<string, string>>;
  readonly dials: Readonly<Record<string, unknown>>;
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

export const staggerEachOf = (tween: Tween, pending: readonly SourceEdit[]): number | null => {
  const edit = pending.find((candidate): candidate is Extract<SourceEdit, { type: "tween-stagger" }> => candidate.type === "tween-stagger" && candidate.tween.index === tween.ref.index);
  if (edit !== undefined) return edit.each;
  return tween.stagger?.kind === "source" && typeof tween.stagger.value === "number" ? tween.stagger.value : null;
};

const offsetsOf = (tween: Tween, count: number, each: number | null, pending: readonly SourceEdit[]): number[] => {
  if (each === null || tween.staggerForm === null || tween.staggerForm === "other") return Array.from({ length: count }, () => 0);
  const pendingEdit = pending.some((edit) => edit.type === "tween-stagger" && edit.tween.index === tween.ref.index);
  const form = pendingEdit ? "number" : tween.staggerForm;
  return Array.from({ length: count }, (_, index) => {
    if (form === "amount") return count > 1 ? (index * each) / (count - 1) : 0;
    return index * each;
  });
};

export const channelsOf = (tween: Tween): string[] => [...new Set(tween.keyframes.flatMap((step) => Object.keys(step.values)))].sort();

const timingOf = (tween: Tween, input: RowsInput, live: LiveTween | undefined): { start: number; duration: number } | null => {
  let start = numberOf(tween.start, input.dials);
  let duration = numberOf(tween.duration, input.dials);
  for (const edit of input.pending) {
    if (edit.type !== "tween-time" || edit.tween.index !== tween.ref.index) continue;
    if (edit.start !== undefined) start = edit.start;
    if (typeof edit.duration === "number") duration = edit.duration;
  }
  start ??= live?.start;
  duration ??= live?.duration;
  return start === undefined || duration === undefined ? null : { start, duration };
};

const diamondsOf = (tween: Tween, start: number, duration: number, group: PropertyGroup | null): number[] => {
  if (tween.method === "set") return [start];
  const fractions = [0, 1];
  for (const step of tween.keyframes) {
    if (group !== null && !Object.keys(step.values).some((key) => groupOfKey(key) === group)) continue;
    if (!fractions.some((fraction) => Math.abs(fraction - step.at) < 1e-6)) fractions.push(step.at);
  }
  return fractions.sort((a, b) => a - b).map((at) => start + at * duration);
};

const barsOf = (tween: Tween, target: string, offset: number, timing: { start: number; duration: number }, group: PropertyGroup | null, stagger: number | null): BarView[] => {
  const start = timing.start + offset;
  const duration = timing.duration;
  const main: BarView = { tween: tween.ref.index, target, group, start, duration, copy: false, stagger, readOnly: tween.readOnly, diamonds: diamondsOf(tween, start, duration, group) };
  const copies: BarView[] = [];
  const count = tween.repeat?.count;
  if (tween.repeat !== null && typeof count === "number" && count > 0) {
    for (let cycle = 1; cycle <= count; cycle++) copies.push({ ...main, start: start + cycle * duration, copy: true, diamonds: [] });
  }
  return [main, ...copies];
}

const groupsOfTween = (tween: Tween): PropertyGroup[] => GROUP_ORDER.filter((group) => tween.groups.includes(group));

const inside = (id: string, list: ReadonlySet<string> | readonly string[], elements: MotionTimelineReading["elements"]): boolean => {
  const has = (value: string): boolean => (list instanceof Set ? list.has(value) : (list as readonly string[]).includes(value));
  for (let current: string | null = id; current !== null; current = elements[current]?.parent ?? null) {
    if (has(current)) return true;
  }
  return false;
};

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

  const animated = new Set(reading.tweens.flatMap((tween) => tween.targets));
  const takeSourceLive = (): LiveTween | undefined => {
    const sourced = (candidate: LiveTween) => candidate.targets.length > 0 && candidate.targets.every((target) => elements[target] !== undefined);
    const free = (candidate: LiveTween, at: number) => !liveUsed.has(at) && sourced(candidate);
    const index = input.live.findIndex((candidate, at) => free(candidate, at) && !candidate.targets.some((target) => animated.has(target)));
    const chosen = index !== -1 ? index : input.live.findIndex(free);
    if (chosen === -1) return undefined;
    liveUsed.add(chosen);
    return input.live[chosen];
  };

  const barsByElement = new Map<string, BarView[]>();
  const lanesByElement = new Map<string, Map<PropertyGroup, BarView[]>>();
  const runtimeBars = new Map<string, BarView[]>();
  for (const source of reading.tweens) {
    const unnamed = source.targets.length === 0;
    const live = unnamed ? takeSourceLive() : liveFor(source);
    const tween = unnamed && live !== undefined ? { ...source, targets: [...live.targets] } : source;
    const timing = timingOf(tween, input, live);
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
  const clips = [...reading.clips].sort((a, b) => a.track - b.track || ((numberOf(a.start, dials) ?? 0) - (numberOf(b.start, dials) ?? 0)));
  const placed = new Set<string>();
  for (const clip of clips) {
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


const entryOf = (schema: DialSchema | undefined, path: readonly string[]): DialSchema[string] | undefined => {
  let folder: DialSchema | undefined = schema;
  for (let at = 0; at < path.length - 1; at++) {
    const entry = folder?.[path[at]!];
    if (entry?.kind !== "folder") return undefined;
    folder = entry.of;
  }
  return folder?.[path[path.length - 1] ?? ""];
};

export const dialLimitOf = (schema: DialSchema | undefined, path: readonly string[]): DialLimit | null => {
  const entry = entryOf(schema, path);
  if (entry?.kind === "range") return { kind: "range", min: entry.min, max: entry.max, ...(entry.step === undefined ? {} : { step: entry.step }) };
  if (entry?.kind === "number") return { kind: "number", value: entry.value };
  return null;
};

export const selectOptionsOf = (schema: DialSchema | undefined, path: readonly string[]): readonly string[] | null => {
  const entry = entryOf(schema, path);
  return entry?.kind === "select" ? entry.options : null;
};
