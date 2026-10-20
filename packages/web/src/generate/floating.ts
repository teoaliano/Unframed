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
  /** tldraw's style panel, when it is showing: it sits above floating UI, so floating UI moves clear of it. */
  readonly panel?: ScreenBox | undefined;
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

/** Whether a box at `place` overlaps `box`, with the margin kept between them. */
const overlapsBox = (place: { readonly left: number; readonly top: number }, size: { readonly w: number; readonly h: number }, box: ScreenBox): boolean =>
  place.left < box.x + box.w + MARGIN && place.left + size.w > box.x - MARGIN && place.top < box.y + box.h + MARGIN && place.top + size.h > box.y - MARGIN;

/**
 * Keeps a box off the top band and off tldraw's style panel. A box over the band moves to the band's
 * right when it fits there, else below the band. A box then left under the style panel moves to the
 * panel's left when it fits there. The panel rule runs last, so the band move cannot put it back under the panel.
 */
const clearOfCard = (place: { readonly left: number; readonly top: number }, size: { readonly w: number; readonly h: number }, canvas: CanvasRoom): { readonly left: number; readonly top: number } => {
  let at = place;
  const card = canvas.card;
  if (card && overlapsBox(at, size, card)) {
    const right = card.x + card.w + MARGIN;
    at = right + size.w <= canvas.w - MARGIN ? { left: right, top: at.top } : { left: at.left, top: card.y + card.h + MARGIN };
  }
  const panel = canvas.panel;
  if (panel && overlapsBox(at, size, panel)) {
    const left = panel.x - MARGIN - size.w;
    if (left >= MARGIN) at = { left, top: at.top };
  }
  return at;
};

/** The canvas's room for floating UI, read from the page: the viewport above the bottom bar, and the top-left card. */
export const canvasRoom = (editor: Editor): CanvasRoom => {
  const bounds = editor.getViewportScreenBounds();
  const container = editor.getContainer();
  // The bottom bar sits above floating UI in tldraw's layer: it stays clear of it.
  const bar = container.querySelector<HTMLElement>("[data-unframed-toolbar]")?.getBoundingClientRect();
  // The top-left card is the room floating UI keeps clear of. The project tab strip is below the
  // canvas's in-front layer, where floating UI lives, so floating UI sits on top of it and does not move for it.
  const doc = container.ownerDocument;
  const band = [".unframed-chrome-left"]
    .map((selector) => doc.querySelector<HTMLElement>(selector)?.getBoundingClientRect())
    .filter((rect): rect is DOMRect => rect !== undefined && rect.width > 0);
  const panelRect = doc.querySelector<HTMLElement>(".tlui-style-panel__wrapper")?.getBoundingClientRect();
  const left = Math.min(...band.map((rect) => rect.left));
  const right = Math.max(...band.map((rect) => rect.right));
  const top = Math.min(...band.map((rect) => rect.top));
  const bottom = Math.max(...band.map((rect) => rect.bottom));
  return {
    w: bounds.w,
    h: bar ? Math.min(bounds.h, bar.top - bounds.y) : bounds.h,
    card: band.length > 0 ? { x: left - bounds.x, y: top - bounds.y, w: right - left, h: bottom - top } : undefined,
    panel: panelRect === undefined ? undefined : { x: panelRect.left - bounds.x, y: panelRect.top - bounds.y, w: panelRect.width, h: panelRect.height },
  };
};
