import type { TLRecord } from "@tldraw/tlschema";
import { getIndexAbove, type IndexKey } from "@tldraw/utils";
import { PAGE_ID } from "./canvasRecords.ts";

type At = { x?: number; y?: number; index?: string; parentId?: string };

let last: IndexKey | null = null;
const nextIndex = () => (last = getIndexAbove(last));

export const nodeShape = (id: string, ref: string, props: Record<string, unknown> = {}, at: At = {}): TLRecord =>
  ({
    id: `shape:${id}`,
    typeName: "shape",
    type: "node",
    x: at.x ?? 0,
    y: at.y ?? 0,
    rotation: 0,
    index: at.index ?? nextIndex(),
    parentId: at.parentId ?? PAGE_ID,
    isLocked: false,
    opacity: 1,
    props: { w: 380, h: 360, medium: "image", model: "", params: {}, instruction: "", versions: [], currentVersionId: null, ...props },
    meta: { ref },
  }) as unknown as TLRecord;

export const wireShape = (id: string, from: string, to: string, role: string, props: Record<string, unknown> = {}, chosen = true): TLRecord =>
  ({
    id: `shape:${id}`,
    typeName: "shape",
    type: "wire",
    x: 0,
    y: 0,
    rotation: 0,
    index: nextIndex(),
    parentId: PAGE_ID,
    isLocked: false,
    opacity: 1,
    props: { from: `shape:${from}`, to: `shape:${to}`, role, ...props },
    meta: chosen ? { unframed: { chosen: true } } : {},
  }) as unknown as TLRecord;
