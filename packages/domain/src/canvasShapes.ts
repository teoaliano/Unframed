import type { Box } from "./grouping.ts";

/** What a shape is, for generation: spec 02's kinds. Every tldraw shape without one is a mark. */
export type ShapeKind = "prompt" | "image" | "video" | "group" | "page" | "motion" | "mark";

/** tldraw's image crop: the visible region as fractions of the picture. */
export interface Crop {
  readonly topLeft: { readonly x: number; readonly y: number };
  readonly bottomRight: { readonly x: number; readonly y: number };
  readonly isCircle?: boolean | undefined;
}

/**
 * One shape of the canvas as the generation rules read it: plain facts, no tldraw. The web
 * builds these from its store; tests write them by hand.
 */
export interface CanvasShape {
  readonly id: string;
  readonly kind: ShapeKind;
  /** Page bounds. */
  readonly bounds: Box;
  /** Paint order across the whole page: a higher rank is drawn on top. */
  readonly z: number;
  /** The group this shape is a member of. */
  readonly parent?: string | undefined;
  /** `meta.ref` of a prompt, medium or artifact; a group's name. */
  readonly ref?: string | undefined;
  /** A prompt's plain text. */
  readonly text?: string | undefined;
  /** A prompt that is a text result (spec 05): its text is used literally. */
  readonly textResult?: boolean | undefined;
  /** The project file an image, video, page or motion names. */
  readonly file?: string | undefined;
  /** The `https://` link a video holds. */
  readonly link?: string | undefined;
  readonly crop?: Crop | null | undefined;
}

/** Top edge first, then left edge, then paint order: the one order of a selection. */
export const readingOrder = (a: CanvasShape, b: CanvasShape): number =>
  a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x || a.z - b.z;

/** The members of a group, in reading order inside its box. */
export const membersOf = (shapes: ReadonlyArray<CanvasShape>, groupId: string): CanvasShape[] =>
  shapes.filter((shape) => shape.parent === groupId).sort(readingOrder);
