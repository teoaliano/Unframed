import { randomBytes } from "node:crypto";
import type { Instance } from "@unframed/contracts";
import { SCREEN_DEFAULT_VIEWPORT } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";

export const screenRecord = (records: ReadonlyArray<TLRecord>, instance: Instance, at: { readonly x: number; readonly y: number; readonly route?: string; readonly w?: number; readonly h?: number }): TLRecord => {
  const pageId = records.find((record) => record.typeName === "page")?.id ?? "page:page";
  return {
    id: `shape:${randomBytes(8).toString("hex")}`,
    typeName: "shape",
    type: "screen",
    x: at.x,
    y: at.y,
    rotation: 0,
    index: "a1",
    parentId: pageId,
    isLocked: false,
    opacity: 1,
    props: { w: at.w ?? SCREEN_DEFAULT_VIEWPORT.w, h: at.h ?? SCREEN_DEFAULT_VIEWPORT.h, instance: instance.id, route: at.route ?? "/", title: instance.branch },
    meta: {},
  } as unknown as TLRecord;
};
