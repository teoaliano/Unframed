import { randomBytes } from "node:crypto";
import type { Instance, ScreenMock, ScreenStep } from "@unframed/contracts";
import { flowCapacity, flowLayout, nextRef, readRef, routeBoardLayout, SCREEN_GAP, statesFrameName, uniqueName, type RouteToPlace } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { getIndexAbove, type IndexKey } from "@tldraw/utils";
import { shapeBoxes } from "../runs/shapeBounds.ts";
import { isScreenShape, screenRecord, type ScreenShape } from "./firstScreen.ts";

export interface PlacedState {
  readonly route: string;
  readonly steps: ReadonlyArray<ScreenStep>;
  readonly mocks: ReadonlyArray<ScreenMock>;
  readonly state: string;
}

export interface Placed {
  readonly put: ReadonlyArray<TLRecord>;
  readonly frames: ReadonlyArray<string>;
  readonly screens: ReadonlyArray<string>;
}

const hex = () => randomBytes(8).toString("hex");

const pageOf = (records: ReadonlyArray<TLRecord>): string => (records.find((record) => record.typeName === "page")?.id as string | undefined) ?? "page:page";

const topLevelOf = (records: ReadonlyArray<TLRecord>, pageId: string) => records.filter((record) => record.typeName === "shape" && (record as { parentId?: string }).parentId === pageId);

const topIndexOf = (shapes: ReadonlyArray<TLRecord>): IndexKey | null =>
  shapes.reduce<IndexKey | null>((highest, record) => {
    const index = (record as { index?: IndexKey }).index;
    return index !== undefined && (highest === null || index > highest) ? index : highest;
  }, null);

const frameRecord = (records: ReadonlyArray<TLRecord>, at: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly name: string; readonly index: IndexKey; readonly pageId: string }): TLRecord => {
  const taken = records.flatMap((record) => {
    const ref = readRef(record as never);
    return ref === undefined ? [] : [ref];
  });
  return {
    id: `shape:${hex()}`,
    typeName: "shape",
    type: "frame",
    x: at.x,
    y: at.y,
    rotation: 0,
    index: at.index,
    parentId: at.pageId,
    isLocked: false,
    opacity: 1,
    props: { w: at.w, h: at.h, name: uniqueName(at.name || nextRef(records as never), taken), color: "black" },
    meta: {},
  } as unknown as TLRecord;
};

const screenOn = (minted: ReadonlyArray<TLRecord>, instance: Instance, spot: Parameters<typeof screenRecord>[2], index: IndexKey | null, props: Record<string, unknown>): TLRecord => {
  const made = screenRecord(minted, instance, spot) as TLRecord & { props: Record<string, unknown> };
  return { ...made, index, props: { ...made.props, ...props } } as TLRecord;
};

const plain = (screen: ScreenShape): boolean =>
  (screen.props.state ?? "") === "" && (!Array.isArray(screen.props.steps) || screen.props.steps.length === 0) && (!Array.isArray(screen.props.mocks) || screen.props.mocks.length === 0);

export const shownRoutes = (records: ReadonlyArray<TLRecord>, instance: string): ReadonlySet<string> =>
  new Set(
    records
      .filter(isScreenShape)
      .filter((screen) => screen.props.instance === instance && plain(screen))
      .map((screen) => screen.props.route),
  );

export const routeScreenRecords = (records: ReadonlyArray<TLRecord>, instance: Instance, routes: ReadonlyArray<RouteToPlace>, size: { readonly w: number; readonly h: number }): Placed => {
  if (routes.length === 0) return { put: [], frames: [], screens: [] };
  const pageId = pageOf(records);
  const boxes = shapeBoxes(records);
  const topLevel = topLevelOf(records, pageId);
  const right = topLevel.reduce((most, record) => {
    const box = boxes.get(record.id as string)?.page;
    return box === undefined ? most : Math.max(most, box.x + box.w);
  }, Number.NEGATIVE_INFINITY);
  const top = topLevel.reduce((least, record) => {
    const box = boxes.get(record.id as string)?.page;
    return box === undefined ? least : Math.min(least, box.y);
  }, Number.POSITIVE_INFINITY);
  const board = routeBoardLayout({ x: Number.isFinite(right) ? right + 2 * SCREEN_GAP : 0, y: Number.isFinite(top) ? top : 0, w: size.w, h: size.h, routes });
  const minted: TLRecord[] = [...records];
  const put: TLRecord[] = [];
  const frames: string[] = [];
  const screens: string[] = [];
  let frameIndex = topIndexOf(topLevel);
  for (const frame of board.frames) {
    frameIndex = getIndexAbove(frameIndex);
    const group = frameRecord(minted, { ...frame, index: frameIndex, pageId });
    minted.push(group);
    put.push(group);
    frames.push(group.id as string);
    let index: IndexKey | null = null;
    for (const at of frame.screens) {
      index = getIndexAbove(index);
      const screen = screenOn(minted, instance, { x: at.x, y: at.y, route: at.route.path, w: size.w, h: size.h, parentId: group.id as string }, index, { title: at.route.name });
      minted.push(screen);
      put.push(screen);
      screens.push(screen.id as string);
    }
  }
  return { put, frames, screens };
};

export const stateScreenRecords = (records: ReadonlyArray<TLRecord>, source: ScreenShape, instance: Instance, states: ReadonlyArray<PlacedState>): Placed | { readonly error: string } => {
  const w = Math.round(source.props.w);
  const h = Math.round(source.props.h);
  const most = flowCapacity(w, h);
  if (states.length === 0) return { put: [], frames: [], screens: [] };
  if (states.length > most) return { error: `at most ${most} states fit at this viewport; place fewer` };
  const pageId = pageOf(records);
  const boxes = shapeBoxes(records);
  const anchor = source.parentId !== pageId ? (records.find((record) => record.id === source.parentId) ?? source) : source;
  const box = boxes.get(anchor.id as string)?.page ?? { x: source.x, y: source.y, w, h };
  const topLevel = topLevelOf(records, pageId);
  const below = topLevel.reduce((lowest, record) => {
    const other = boxes.get(record.id as string)?.page;
    if (other === undefined || other.x >= box.x + box.w + 2 * SCREEN_GAP || other.x + other.w <= box.x - 2 * SCREEN_GAP || other.y < box.y) return lowest;
    return Math.max(lowest, other.y + other.h);
  }, box.y + box.h);
  const layout = flowLayout({ x: box.x, y: below + 2 * SCREEN_GAP, w, h, count: states.length });
  const group = frameRecord(records, { ...layout.group, name: statesFrameName(source.props.route), index: getIndexAbove(topIndexOf(topLevel)), pageId });
  const minted: TLRecord[] = [...records, group];
  const put: TLRecord[] = [group];
  const screens: string[] = [];
  let index: IndexKey | null = null;
  states.forEach((state, at) => {
    index = getIndexAbove(index);
    const screen = screenOn(minted, instance, { ...layout.screens[at]!, route: state.route, w, h, parentId: group.id as string }, index, { steps: [...state.steps], mocks: [...state.mocks], state: state.state });
    minted.push(screen);
    put.push(screen);
    screens.push(screen.id as string);
  });
  return { put, frames: [group.id as string], screens };
};
