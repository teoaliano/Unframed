import type { Box } from "./grouping.ts";

export type ShapeKind = "prompt" | "image" | "video" | "audio" | "group" | "page" | "motion" | "component" | "mark";

export interface Crop {
  readonly topLeft: { readonly x: number; readonly y: number };
  readonly bottomRight: { readonly x: number; readonly y: number };
  readonly isCircle?: boolean | undefined;
}

export interface CanvasShape {
  readonly id: string;
  readonly kind: ShapeKind;
  readonly bounds: Box;
  readonly z: number;
  readonly parent?: string | undefined;
  readonly ref?: string | undefined;
  readonly text?: string | undefined;
  readonly textResult?: boolean | undefined;
  readonly file?: string | undefined;
  readonly link?: string | undefined;
  readonly crop?: Crop | null | undefined;
}

export const readingOrder = (a: CanvasShape, b: CanvasShape): number =>
  a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x || a.z - b.z;

export const membersOf = (shapes: ReadonlyArray<CanvasShape>, groupId: string): CanvasShape[] =>
  shapes.filter((shape) => shape.parent === groupId).sort(readingOrder);
