import type { Point } from "../comments/model.ts";
import type { Box } from "../grouping.ts";

export type Side = "top" | "right" | "bottom" | "left";
export type Corner = "nw" | "ne" | "se" | "sw";
export type FlowDirection = "row" | "column";

export interface Sides {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface LayoutOf {
  readonly box: Box;
  readonly display: string;
  readonly direction: FlowDirection;
  readonly padding: Sides;
  readonly gap: number;
  readonly radius: number;
  readonly text: boolean;
  readonly children: ReadonlyArray<Box>;
}

export type Zone =
  | { readonly kind: "outside" }
  | { readonly kind: "inside" }
  | { readonly kind: "edge"; readonly side: Side }
  | { readonly kind: "corner"; readonly corner: Corner }
  | { readonly kind: "padding"; readonly side: Side }
  | { readonly kind: "gap"; readonly index: number; readonly direction: FlowDirection }
  | { readonly kind: "radius"; readonly corner: Corner };

export type Cursor = "default" | "ew-resize" | "ns-resize" | "nwse-resize" | "nesw-resize";

export interface Bar {
  readonly box: Box;
  readonly value: number;
}

export interface PaddingBar extends Bar {
  readonly side: Side;
  readonly area: Box;
}

export interface GapBar extends Bar {
  readonly index: number;
  readonly area: Box;
}

export interface Handles {
  readonly padding: ReadonlyArray<PaddingBar>;
  readonly gaps: ReadonlyArray<GapBar>;
  readonly radius: boolean;
}

export const PADDING_BAR_MIN = 4;
export const RADIUS_REACH = 28;
export const RADIUS_MIN_SIDE = 24;
export const EDGE_BAND = 6;
export const BAR_LENGTH = 14;
export const BAR_THICKNESS = 4;

const round = (value: number): number => Math.round(value * 100) / 100;
const atLeastZero = (value: number): number => Math.max(0, round(value));

export const isLayoutContainer = (display: string): boolean => /(^|-)(flex|grid)$/.test(display.trim());

const SIDES: ReadonlyArray<Side> = ["top", "right", "bottom", "left"];
const CORNERS: ReadonlyArray<Corner> = ["nw", "ne", "se", "sw"];

const centred = (area: Box, w: number, h: number): Box => ({ x: round(area.x + (area.w - w) / 2), y: round(area.y + (area.h - h) / 2), w, h });

const paddingArea = (box: Box, padding: Sides, side: Side): Box => {
  if (side === "left") return { x: box.x, y: box.y, w: padding.left, h: box.h };
  if (side === "right") return { x: box.x + box.w - padding.right, y: box.y, w: padding.right, h: box.h };
  if (side === "top") return { x: box.x, y: box.y, w: box.w, h: padding.top };
  return { x: box.x, y: box.y + box.h - padding.bottom, w: box.w, h: padding.bottom };
};

const barSize = (vertical: boolean): { w: number; h: number } => (vertical ? { w: BAR_THICKNESS, h: BAR_LENGTH } : { w: BAR_LENGTH, h: BAR_THICKNESS });

export const handlesOf = (layout: LayoutOf): Handles => {
  const container = isLayoutContainer(layout.display);
  const { box, padding } = layout;
  const paddingBars: PaddingBar[] = container
    ? SIDES.filter((side) => padding[side] >= PADDING_BAR_MIN).map((side) => {
        const area = paddingArea(box, padding, side);
        const size = barSize(side === "left" || side === "right");
        return { side, value: padding[side], area, box: centred(area, size.w, size.h) };
      })
    : [];
  const gaps: GapBar[] = [];
  if (container) {
    const row = layout.direction === "row";
    const top = box.y + padding.top;
    const left = box.x + padding.left;
    const height = box.h - padding.top - padding.bottom;
    const width = box.w - padding.left - padding.right;
    for (let index = 0; index + 1 < layout.children.length; index++) {
      const a = layout.children[index]!;
      const b = layout.children[index + 1]!;
      const area = row ? { x: a.x + a.w, y: top, w: round(b.x - (a.x + a.w)), h: height } : { x: left, y: a.y + a.h, w: width, h: round(b.y - (a.y + a.h)) };
      if (area.w < 0 || area.h < 0) continue;
      const size = barSize(row);
      gaps.push({ index, value: layout.gap, area, box: centred(area, size.w, size.h) });
    }
  }
  return { padding: paddingBars, gaps, radius: !layout.text && Math.min(box.w, box.h) >= RADIUS_MIN_SIDE };
};

const within = (box: Box, point: Point, grow: number): boolean => point.x >= box.x - grow && point.x <= box.x + box.w + grow && point.y >= box.y - grow && point.y <= box.y + box.h + grow;

export const radiusHandleAt = (layout: LayoutOf, corner: Corner): Point => {
  const { box } = layout;
  const inset = Math.min(Math.max(layout.radius, 10), Math.min(box.w, box.h) / 2);
  const x = corner === "nw" || corner === "sw" ? box.x + inset : box.x + box.w - inset;
  const y = corner === "nw" || corner === "ne" ? box.y + inset : box.y + box.h - inset;
  return { x: round(x), y: round(y) };
};

const RADIUS_HIT = 6;
const BAR_HIT = 4;

export const zoneAt = (layout: LayoutOf, point: Point, scale = 1): Zone => {
  const band = EDGE_BAND / scale;
  const { box } = layout;
  if (!within(box, point, band)) return { kind: "outside" };
  const near = {
    left: Math.abs(point.x - box.x) <= band,
    right: Math.abs(point.x - (box.x + box.w)) <= band,
    top: Math.abs(point.y - box.y) <= band,
    bottom: Math.abs(point.y - (box.y + box.h)) <= band,
  };
  if (near.top && near.left) return { kind: "corner", corner: "nw" };
  if (near.top && near.right) return { kind: "corner", corner: "ne" };
  if (near.bottom && near.right) return { kind: "corner", corner: "se" };
  if (near.bottom && near.left) return { kind: "corner", corner: "sw" };
  for (const side of SIDES) if (near[side]) return { kind: "edge", side };
  const handles = handlesOf(layout);
  if (handles.radius) {
    for (const corner of CORNERS) {
      const centre = radiusHandleAt(layout, corner);
      if (Math.hypot(point.x - centre.x, point.y - centre.y) <= RADIUS_HIT / scale) return { kind: "radius", corner };
    }
  }
  for (const bar of handles.padding) if (within(bar.box, point, BAR_HIT / scale)) return { kind: "padding", side: bar.side };
  for (const bar of handles.gaps) if (within(bar.box, point, BAR_HIT / scale)) return { kind: "gap", index: bar.index, direction: layout.direction };
  return within(box, point, 0) ? { kind: "inside" } : { kind: "outside" };
};

export const cursorOf = (zone: Zone): Cursor => {
  if (zone.kind === "edge" || zone.kind === "padding") return zone.side === "left" || zone.side === "right" ? "ew-resize" : "ns-resize";
  if (zone.kind === "corner") return zone.corner === "nw" || zone.corner === "se" ? "nwse-resize" : "nesw-resize";
  if (zone.kind === "radius") return "nwse-resize";
  if (zone.kind === "gap") return zone.direction === "row" ? "ew-resize" : "ns-resize";
  return "default";
};

export const paddingFromDrag = (side: Side, start: number, delta: Point): number => {
  const moved = side === "left" ? delta.x : side === "right" ? -delta.x : side === "top" ? delta.y : -delta.y;
  return atLeastZero(start + moved);
};

export const gapFromDrag = (direction: FlowDirection, start: number, delta: Point): number => atLeastZero(start + 2 * (direction === "row" ? delta.x : delta.y));

export type ResizeHandle = { readonly kind: "edge"; readonly side: Side } | { readonly kind: "corner"; readonly corner: Corner };

export const resizeFromDrag = (handle: ResizeHandle, box: Box, delta: Point): { readonly w: number; readonly h: number } => {
  const sides: ReadonlyArray<Side> =
    handle.kind === "edge" ? [handle.side] : handle.corner === "nw" ? ["top", "left"] : handle.corner === "ne" ? ["top", "right"] : handle.corner === "se" ? ["bottom", "right"] : ["bottom", "left"];
  let w = box.w;
  let h = box.h;
  for (const side of sides) {
    if (side === "left") w -= delta.x;
    if (side === "right") w += delta.x;
    if (side === "top") h -= delta.y;
    if (side === "bottom") h += delta.y;
  }
  return { w: atLeastZero(w), h: atLeastZero(h) };
};

export const radiusFromDrag = (corner: Corner, start: number, box: Box, delta: Point): number => {
  const inwardX = corner === "nw" || corner === "sw" ? delta.x : -delta.x;
  const inwardY = corner === "nw" || corner === "ne" ? delta.y : -delta.y;
  const next = start + (inwardX + inwardY) / 2;
  return Math.min(atLeastZero(next), Math.min(box.w, box.h) / 2);
};

export const reorderIndex = (siblings: ReadonlyArray<Box>, from: number, pointer: Point, direction: FlowDirection): number => {
  const at = direction === "row" ? pointer.x : pointer.y;
  return siblings.filter((box, index) => index !== from && (direction === "row" ? box.x + box.w / 2 : box.y + box.h / 2) < at).length;
};

export const opacityOfDigit = (key: string): number | undefined => (/^[0-9]$/.test(key) ? (key === "0" ? 1 : Number(key) / 10) : undefined);

export const distanceBetween = (a: Box, b: Box): { readonly from: Point; readonly to: Point; readonly px: number } | undefined => {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const midY = overlapY > 0 ? Math.max(a.y, b.y) + overlapY / 2 : a.y + a.h / 2;
  const midX = overlapX > 0 ? Math.max(a.x, b.x) + overlapX / 2 : a.x + a.w / 2;
  if (b.x >= a.x + a.w) return { from: { x: a.x + a.w, y: midY }, to: { x: b.x, y: midY }, px: round(b.x - (a.x + a.w)) };
  if (b.x + b.w <= a.x) return { from: { x: a.x, y: midY }, to: { x: b.x + b.w, y: midY }, px: round(a.x - (b.x + b.w)) };
  if (b.y >= a.y + a.h) return { from: { x: midX, y: a.y + a.h }, to: { x: midX, y: b.y }, px: round(b.y - (a.y + a.h)) };
  if (b.y + b.h <= a.y) return { from: { x: midX, y: a.y }, to: { x: midX, y: b.y + b.h }, px: round(a.y - (b.y + b.h)) };
  const inside = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
  const [inner, outer] = inside(b, a) ? [a, b] : inside(a, b) ? [b, a] : [undefined, undefined];
  if (inner === undefined || outer === undefined) return undefined;
  const cy = inner.y + inner.h / 2;
  const cx = inner.x + inner.w / 2;
  const options = [
    { px: inner.x - outer.x, from: { x: inner.x, y: cy }, to: { x: outer.x, y: cy } },
    { px: outer.x + outer.w - (inner.x + inner.w), from: { x: inner.x + inner.w, y: cy }, to: { x: outer.x + outer.w, y: cy } },
    { px: inner.y - outer.y, from: { x: cx, y: inner.y }, to: { x: cx, y: outer.y } },
    { px: outer.y + outer.h - (inner.y + inner.h), from: { x: cx, y: inner.y + inner.h }, to: { x: cx, y: outer.y + outer.h } },
  ].sort((p, q) => p.px - q.px);
  const best = options[0]!;
  const flip = inner === b;
  return flip ? { from: best.to, to: best.from, px: round(best.px) } : { ...best, px: round(best.px) };
};
