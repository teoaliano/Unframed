import { randomBytes } from "node:crypto";
import type { Instance, ScreenMock, ScreenStep } from "@unframed/contracts";
import { arrowLabel, flowCapacity, flowLayout, flowTooMany, nextRef, readRef, SCREEN_GAP, slugName, uniqueName } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { getIndexAbove, type IndexKey } from "@tldraw/utils";
import { shapeBoxes } from "../runs/shapeBounds.ts";
import type { CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import { screenRecord, type ScreenShape } from "./firstScreen.ts";

const hex = () => randomBytes(8).toString("hex");

const labelText = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const arrowProps = (dx: number, dy: number, label: string) => ({
  kind: "arc",
  labelColor: "black",
  color: "black",
  fill: "none",
  dash: "draw",
  size: "m",
  arrowheadStart: "none",
  arrowheadEnd: "arrow",
  font: "draw",
  start: { x: 0, y: 0 },
  end: { x: dx, y: dy },
  bend: 0,
  richText: labelText(label),
  labelPosition: 0.5,
  scale: 1,
  elbowMidPoint: 0.5,
});

const binding = (arrow: string, to: string, terminal: "start" | "end") =>
  ({
    id: `binding:${hex()}`,
    typeName: "binding",
    type: "arrow",
    fromId: arrow,
    toId: to,
    props: { terminal, normalizedAnchor: { x: terminal === "start" ? 1 : 0, y: 0.5 }, isExact: false, isPrecise: true, snap: "none" },
    meta: {},
  }) as unknown as TLRecord;

export interface FlowState {
  readonly route: string;
  readonly steps: ReadonlyArray<ScreenStep>;
  readonly mocks: ReadonlyArray<ScreenMock>;
  readonly state: string;
  readonly action?: string | undefined;
}

export type FlowBuilt = { readonly put: ReadonlyArray<TLRecord>; readonly group: string; readonly screens: ReadonlyArray<string> } | { readonly error: string };

export const flowRecords = (records: ReadonlyArray<TLRecord>, source: ScreenShape, instance: Instance, states: ReadonlyArray<FlowState>): FlowBuilt => {
  const w = Math.round(source.props.w);
  const h = Math.round(source.props.h);
  const most = flowCapacity(w, h);
  if (states.length > most) return { error: flowTooMany(most) };
  const pageId = (records.find((record) => record.typeName === "page")?.id as string | undefined) ?? "page:page";
  const boxes = shapeBoxes(records);
  const topLevel = records.filter((record) => record.typeName === "shape" && (record as { parentId?: string }).parentId === pageId);
  const bottom = topLevel.reduce((lowest, record) => {
    const box = boxes.get(record.id as string)?.page;
    return box === undefined ? lowest : Math.max(lowest, box.y + box.h);
  }, Number.NEGATIVE_INFINITY);
  const left = boxes.get(source.id as string)?.page.x ?? source.x;
  const layout = flowLayout({ x: left, y: Number.isFinite(bottom) ? bottom + 2 * SCREEN_GAP : 0, w, h, count: states.length });
  const topIndex = topLevel.reduce<string | undefined>((highest, record) => {
    const index = (record as { index?: string }).index;
    return index !== undefined && (highest === undefined || index > highest) ? index : highest;
  }, undefined);
  const taken = records.flatMap((record) => {
    const ref = readRef(record as never);
    return ref === undefined ? [] : [ref];
  });
  const groupId = `shape:${hex()}`;
  const group = {
    id: groupId,
    typeName: "shape",
    type: "frame",
    x: layout.group.x,
    y: layout.group.y,
    rotation: 0,
    index: getIndexAbove((topIndex ?? null) as IndexKey | null),
    parentId: pageId,
    isLocked: false,
    opacity: 1,
    props: { w: layout.group.w, h: layout.group.h, name: uniqueName(slugName(instance.branch) || nextRef(records as never), taken), color: "black" },
    meta: {},
  } as unknown as TLRecord;
  const minted: TLRecord[] = [...records, group];
  let index: IndexKey | null = null;
  const screens = states.map((state, at) => {
    index = getIndexAbove(index);
    const made = screenRecord(minted, instance, { ...layout.screens[at]!, route: state.route, w, h, parentId: groupId }) as TLRecord & { props: Record<string, unknown> };
    const screen = { ...made, index, props: { ...made.props, steps: [...state.steps], mocks: [...state.mocks], state: state.state } } as TLRecord;
    minted.push(screen);
    return screen;
  });
  const links: TLRecord[] = [];
  for (let at = 0; at + 1 < screens.length; at++) {
    const from = layout.screens[at]!;
    const to = layout.screens[at + 1]!;
    const arrowId = `shape:${hex()}`;
    index = getIndexAbove(index);
    const start = { x: from.x + w, y: from.y + h / 2 };
    links.push(
      {
        id: arrowId,
        typeName: "shape",
        type: "arrow",
        x: start.x,
        y: start.y,
        rotation: 0,
        index,
        parentId: groupId,
        isLocked: false,
        opacity: 1,
        props: arrowProps(to.x - start.x, to.y + h / 2 - start.y, arrowLabel(states[at + 1]!)),
        meta: {},
      } as unknown as TLRecord,
      binding(arrowId, screens[at]!.id as string, "start"),
      binding(arrowId, screens[at + 1]!.id as string, "end"),
    );
  }
  return { put: [group, ...screens, ...links], group: groupId, screens: screens.map((screen) => screen.id as string) };
};
