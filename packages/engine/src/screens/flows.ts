import { randomBytes } from "node:crypto";
import type { Instance } from "@unframed/contracts";
import { agentShapeId, flowCapacity, flowLayout, flowRoutes, flowTooMany, INSTANCE_REMOVED, nextRef, readRef, roomShapeId, SCREEN_GAP, slugName, uniqueName } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { getIndexAbove, type IndexKey } from "@tldraw/utils";
import { shapeBoxes } from "../runs/shapeBounds.ts";
import type { CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import { isScreenShape, screenRecord, type ScreenShape } from "./firstScreen.ts";

const hex = () => randomBytes(8).toString("hex");

const EMPTY_TEXT = { type: "doc", content: [{ type: "paragraph" }] };

const arrowProps = (dx: number, dy: number) => ({
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
  richText: EMPTY_TEXT,
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

export type Exploded = { readonly put: ReadonlyArray<TLRecord>; readonly group: string; readonly screens: ReadonlyArray<string> } | { readonly error: string };

export const explodeRecords = (records: ReadonlyArray<TLRecord>, source: ScreenShape, instance: Instance, routes: ReadonlyArray<string>): Exploded => {
  const w = Math.round(source.props.w);
  const h = Math.round(source.props.h);
  const most = flowCapacity(w, h);
  if (routes.length > most) return { error: flowTooMany(most) };
  const pageId = (records.find((record) => record.typeName === "page")?.id as string | undefined) ?? "page:page";
  const boxes = shapeBoxes(records);
  const topLevel = records.filter((record) => record.typeName === "shape" && (record as { parentId?: string }).parentId === pageId);
  const bottom = topLevel.reduce((lowest, record) => {
    const box = boxes.get(record.id as string)?.page;
    return box === undefined ? lowest : Math.max(lowest, box.y + box.h);
  }, Number.NEGATIVE_INFINITY);
  const left = boxes.get(source.id as string)?.page.x ?? source.x;
  const layout = flowLayout({ x: left, y: Number.isFinite(bottom) ? bottom + 2 * SCREEN_GAP : 0, w, h, count: routes.length });
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
  const screens = routes.map((route, at) => {
    index = getIndexAbove(index);
    const screen = { ...screenRecord(minted, instance, { ...layout.screens[at]!, route, w, h, parentId: groupId }), index } as TLRecord;
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
        props: arrowProps(to.x - start.x, to.y + h / 2 - start.y),
        meta: {},
      } as unknown as TLRecord,
      binding(arrowId, screens[at]!.id as string, "start"),
      binding(arrowId, screens[at + 1]!.id as string, "end"),
    );
  }
  return { put: [group, ...screens, ...links], group: groupId, screens: screens.map((screen) => screen.id as string) };
};

export class ExplodeRefused extends Error {}

export interface ExplodeDeps {
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly apply: (project: string, change: CanvasChange, origin: ChangeOrigin) => Promise<unknown>;
  readonly status: (project: string, id: string) => Promise<Instance>;
}

export const explodeScreen = async (deps: ExplodeDeps, project: string, shapeId: string, typed: string | ReadonlyArray<string>, origin: ChangeOrigin): Promise<{ readonly group: string; readonly screens: ReadonlyArray<string> }> => {
  const records = await deps.read(project);
  const source = records.find((record) => record.id === roomShapeId(shapeId));
  if (!isScreenShape(source)) throw new ExplodeRefused(`there is no Screen ${agentShapeId(shapeId)}`);
  const asked = flowRoutes(typed);
  if ("error" in asked) throw new ExplodeRefused(asked.error);
  const instance = await deps.status(project, source.props.instance);
  if (instance.state === "removed") throw new ExplodeRefused(INSTANCE_REMOVED);
  const exploded = explodeRecords(records, source, instance, asked.routes);
  if ("error" in exploded) throw new ExplodeRefused(exploded.error);
  await deps.apply(project, { put: [...exploded.put], remove: [] }, origin);
  return { group: exploded.group, screens: exploded.screens };
};
