import type { Editor } from "tldraw";

export interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The room floating UI has on the canvas: its size above the bottom bar, and the top-left card it keeps clear of. */
export interface CanvasRoom {
  readonly w: number;
  readonly h: number;
  readonly card?: ScreenBox | undefined;
}

export interface FloatingPlace {
  readonly left: number;
  readonly top: number;
  /** `above` grows upward from its bottom edge; `below` grows downward from its top edge. */
  readonly side: "above" | "below" | "pinned";
}

const GAP = 12;
const MARGIN = 8;

/**
 * Where the selection toolbar (or the composer, with its own size) goes: centred above the
 * selection, 12 px away, kept 8 px inside the canvas's sides; below it when there is no
 * room above; pinned at the top margin when there is room neither above nor below. It never
 * sits under the top-left card.
 */
export const placeFloating = (target: ScreenBox, size: { readonly w: number; readonly h: number }, canvas: CanvasRoom): FloatingPlace => {
  const centre = target.x + target.w / 2;
  const left = Math.min(Math.max(MARGIN, centre - size.w / 2), Math.max(MARGIN, canvas.w - MARGIN - size.w));
  const above = target.y - GAP - size.h;
  if (above >= MARGIN) return { ...clearOfCard({ left, top: above }, size, canvas), side: "above" };
  const below = target.y + target.h + GAP;
  if (below + size.h <= canvas.h - MARGIN) return { ...clearOfCard({ left, top: below }, size, canvas), side: "below" };
  return { ...clearOfCard({ left, top: MARGIN }, size, canvas), side: "pinned" };
};

/**
 * Where a panel beside the selection goes: 12 px right of it, else 12 px left of it, else
 * against the canvas's right side; its top level with the selection's. It stays 8 px inside
 * the canvas even when the selection has left it, and never under the top-left card.
 */
export const placeBeside = (target: ScreenBox, size: { readonly w: number; readonly h: number }, canvas: CanvasRoom): { readonly left: number; readonly top: number } => {
  const right = target.x + target.w + GAP;
  const leftSide = target.x - GAP - size.w;
  const wanted = right + size.w <= canvas.w - MARGIN ? right : leftSide >= MARGIN ? leftSide : canvas.w - MARGIN - size.w;
  const inside = (value: number, room: number) => Math.min(Math.max(MARGIN, value), Math.max(MARGIN, room - MARGIN));
  return clearOfCard({ left: inside(wanted, canvas.w - size.w), top: inside(target.y, canvas.h - size.h) }, size, canvas);
};

/** A box that would overlap the top-left card moves to the card's right when it fits there, else below the card. */
const clearOfCard = (place: { readonly left: number; readonly top: number }, size: { readonly w: number; readonly h: number }, canvas: CanvasRoom): { readonly left: number; readonly top: number } => {
  const card = canvas.card;
  if (!card) return place;
  const overlaps = place.left < card.x + card.w + MARGIN && place.left + size.w > card.x - MARGIN && place.top < card.y + card.h + MARGIN && place.top + size.h > card.y - MARGIN;
  if (!overlaps) return place;
  const right = card.x + card.w + MARGIN;
  return right + size.w <= canvas.w - MARGIN ? { left: right, top: place.top } : { left: place.left, top: card.y + card.h + MARGIN };
};

/** The canvas's room for floating UI, read from the page: the viewport above the bottom bar, and the top-left card. */
export const canvasRoom = (editor: Editor): CanvasRoom => {
  const bounds = editor.getViewportScreenBounds();
  const container = editor.getContainer();
  // The bottom bar sits above floating UI in tldraw's layer: it stays clear of it.
  const bar = container.querySelector<HTMLElement>("[data-unframed-toolbar]")?.getBoundingClientRect();
  const card = container.ownerDocument.querySelector<HTMLElement>(".unframed-chrome-left")?.getBoundingClientRect();
  return {
    w: bounds.w,
    h: bar ? Math.min(bounds.h, bar.top - bounds.y) : bounds.h,
    card: card && card.width > 0 ? { x: card.left - bounds.x, y: card.top - bounds.y, w: card.width, h: card.height } : undefined,
  };
};
