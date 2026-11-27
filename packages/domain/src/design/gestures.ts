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
  | { readonly kind: "gap"; readonly index: number }
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

export const isLayoutContainer = (display: string): boolean => /(^|-)(flex|grid)$/.test(display.trim());

export const handlesOf = (_layout: LayoutOf): Handles => ({ padding: [], gaps: [], radius: false });

export const zoneAt = (_layout: LayoutOf, _point: Point, _scale?: number): Zone => ({ kind: "outside" });

export const cursorOf = (_zone: Zone): Cursor => "default";

export const paddingFromDrag = (_side: Side, start: number, _delta: Point): number => start;

export const gapFromDrag = (_direction: FlowDirection, start: number, _delta: Point): number => start;

export type ResizeHandle = { readonly kind: "edge"; readonly side: Side } | { readonly kind: "corner"; readonly corner: Corner };

export const resizeFromDrag = (_handle: ResizeHandle, box: Box, _delta: Point): { readonly w: number; readonly h: number } => ({ w: box.w, h: box.h });

export const radiusFromDrag = (_corner: Corner, start: number, _box: Box, _delta: Point): number => start;

export const reorderIndex = (_siblings: ReadonlyArray<Box>, from: number, _pointer: Point, _direction: FlowDirection): number => from;

export const opacityOfDigit = (_key: string): number | undefined => undefined;

export const distanceBetween = (_a: Box, _b: Box): { readonly from: Point; readonly to: Point; readonly px: number } | undefined => undefined;
