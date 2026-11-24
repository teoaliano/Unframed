import { randomBytes } from "node:crypto";
import type { Instance } from "@unframed/contracts";
import { nextRef, SCREEN_DEFAULT_VIEWPORT, SCREEN_GAP } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";

export const screenRecord = (records: ReadonlyArray<TLRecord>, instance: Instance, at: { readonly x: number; readonly y: number; readonly route?: string; readonly w?: number; readonly h?: number; readonly parentId?: string }): TLRecord => {
  const pageId = records.find((record) => record.typeName === "page")?.id ?? "page:page";
  return {
    id: `shape:${randomBytes(8).toString("hex")}`,
    typeName: "shape",
    type: "screen",
    x: at.x,
    y: at.y,
    rotation: 0,
    index: "a1",
    parentId: at.parentId ?? pageId,
    isLocked: false,
    opacity: 1,
    props: { w: at.w ?? SCREEN_DEFAULT_VIEWPORT.w, h: at.h ?? SCREEN_DEFAULT_VIEWPORT.h, instance: instance.id, route: at.route ?? "/", title: instance.branch },
    meta: { ref: nextRef(records as ReadonlyArray<{ typeName: string; type?: string; meta?: unknown }>) },
  } as unknown as TLRecord;
};

export type ScreenShape = TLRecord & { type: "screen"; x: number; y: number; parentId: string; props: { w: number; h: number; instance: string; route: string } };

export const isScreenShape = (record: TLRecord | undefined): record is ScreenShape => record?.typeName === "shape" && (record as { type?: string }).type === "screen";

export const screenBeside = (records: ReadonlyArray<TLRecord>, instance: Instance, source: ScreenShape | undefined): TLRecord => {
  const pageId = records.find((record) => record.typeName === "page")?.id;
  const onPage = records.filter(isScreenShape).filter((screen) => screen.parentId === pageId);
  const right = onPage.reduce((most, screen) => Math.max(most, screen.x + screen.props.w), Number.NEGATIVE_INFINITY);
  const x = Number.isFinite(right) ? right + SCREEN_GAP : 0;
  return screenRecord(records, instance, { x, y: source !== undefined && source.parentId === pageId ? source.y : 0, ...(source === undefined ? {} : { route: source.props.route, w: source.props.w, h: source.props.h }) });
};
