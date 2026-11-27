import { elementKind, type EditBox } from "@unframed/domain";
import type { EditReport } from "../artifacts/editor/editSession.ts";

export interface LaidChild {
  readonly id: string | null;
  readonly box: EditBox;
}

export interface ElementLayout {
  readonly display: string;
  readonly direction: string;
  readonly wrap: string;
  readonly position: string;
  readonly gap: { readonly row: number; readonly column: number };
  readonly padding: readonly [number, number, number, number];
  readonly radius: readonly [number, number, number, number];
  readonly children: readonly LaidChild[];
  readonly parent: {
    readonly id: string | null;
    readonly box: EditBox;
    readonly display: string;
    readonly direction: string;
    readonly siblings: readonly LaidChild[];
  } | null;
  readonly lines: readonly EditBox[];
}

export const layerName = (report: Pick<EditReport, "tag" | "instance" | "slot">): string => report.instance ?? report.slot ?? elementKind(report.tag);

const decimal = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

export const chipText = (report: Pick<EditReport, "tag" | "instance" | "slot">, box: EditBox): string => `${layerName(report)} ${Math.round(box.w)}×${Math.round(box.h)}`;

export const badgeText = (box: EditBox): string => `${decimal(box.w)} × ${decimal(box.h)}`;

export const unionOf = (boxes: readonly EditBox[]): EditBox | undefined => {
  if (boxes.length === 0) return undefined;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
};

export const isFlexLike = (display: string): boolean => /flex|grid/.test(display);

export const mainAxis = (layout: Pick<ElementLayout, "display" | "direction">): "row" | "column" =>
  layout.display.includes("grid") ? "row" : layout.direction.startsWith("column") ? "column" : "row";

export const parentAxis = (layout: ElementLayout | undefined): "row" | "column" | undefined => {
  const parent = layout?.parent;
  if (parent === null || parent === undefined || !isFlexLike(parent.display)) return undefined;
  return mainAxis(parent);
};
