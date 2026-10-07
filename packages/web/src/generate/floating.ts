export interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
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
 * room above; pinned at the top margin when there is room neither above nor below.
 */
export const placeFloating = (target: ScreenBox, size: { readonly w: number; readonly h: number }, canvas: { readonly w: number; readonly h: number }): FloatingPlace => {
  const centre = target.x + target.w / 2;
  const left = Math.min(Math.max(MARGIN, centre - size.w / 2), Math.max(MARGIN, canvas.w - MARGIN - size.w));
  const above = target.y - GAP - size.h;
  if (above >= MARGIN) return { left, top: above, side: "above" };
  const below = target.y + target.h + GAP;
  if (below + size.h <= canvas.h - MARGIN) return { left, top: below, side: "below" };
  return { left, top: MARGIN, side: "pinned" };
};

/**
 * Where a panel beside the selection goes: 12 px right of it, else 12 px left of it, else
 * against the canvas's right side; its top level with the selection's. It stays 8 px inside
 * the canvas even when the selection has left it.
 */
export const placeBeside = (target: ScreenBox, size: { readonly w: number; readonly h: number }, canvas: { readonly w: number; readonly h: number }): { readonly left: number; readonly top: number } => {
  const right = target.x + target.w + GAP;
  const leftSide = target.x - GAP - size.w;
  const wanted = right + size.w <= canvas.w - MARGIN ? right : leftSide >= MARGIN ? leftSide : canvas.w - MARGIN - size.w;
  const inside = (value: number, room: number) => Math.min(Math.max(MARGIN, value), Math.max(MARGIN, room - MARGIN));
  return { left: inside(wanted, canvas.w - size.w), top: inside(target.y, canvas.h - size.h) };
};
