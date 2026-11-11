export const PANEL_WIDTH = 320;
export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_WIDTH = 640;
export const PANEL_MIN_HEIGHT = 160;
export const PANEL_MARGIN = 8;

export type PanelMode = "float" | "dock";

export interface PanelPrefs {
  readonly mode: PanelMode;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
  readonly dockW?: number;
}

export interface PanelRoom {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const readPanelPrefs = (value: unknown): PanelPrefs => {
  if (typeof value !== "object" || value === null) return { mode: "float" };
  const { mode, x, y, w, h, dockW } = value as Record<string, unknown>;
  const read: { mode: PanelMode; x?: number; y?: number; w?: number; h?: number; dockW?: number } = { mode: mode === "dock" ? "dock" : "float" };
  if (finite(x) && finite(y)) {
    read.x = x;
    read.y = y;
  }
  if (finite(w)) read.w = w;
  if (finite(h)) read.h = h;
  if (finite(dockW)) read.dockW = dockW;
  return read;
};

const between = (value: number, low: number, high: number): number => Math.min(Math.max(low, value), Math.max(low, high));

export const keepPanelOnScreen = (
  at: { readonly x: number; readonly y: number },
  size: { readonly w: number; readonly h: number },
  room: PanelRoom,
): { readonly x: number; readonly y: number } => ({
  x: Math.round(between(at.x, room.x + PANEL_MARGIN, room.x + room.w - PANEL_MARGIN - size.w)),
  y: Math.round(between(at.y, room.y + PANEL_MARGIN, room.y + room.h - PANEL_MARGIN - size.h)),
});

export const panelSize = (want: { readonly w?: number | undefined; readonly h?: number | undefined }, room: PanelRoom): { readonly w: number; readonly h?: number } => {
  const w = Math.round(between(want.w ?? PANEL_WIDTH, PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, room.w - 2 * PANEL_MARGIN)));
  if (want.h === undefined) return { w };
  return { w, h: Math.round(between(want.h, PANEL_MIN_HEIGHT, room.h - 2 * PANEL_MARGIN)) };
};

export type PanelEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface PanelBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const resizePanel = (start: PanelBox, edge: PanelEdge, dx: number, dy: number, room: PanelRoom): PanelBox => {
  const maxW = Math.min(PANEL_MAX_WIDTH, room.w - 2 * PANEL_MARGIN);
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  let { x, y, w, h } = start;
  if (edge.includes("e")) w = between(start.w + dx, PANEL_MIN_WIDTH, Math.min(maxW, room.x + room.w - PANEL_MARGIN - start.x));
  if (edge.includes("w")) {
    x = between(start.x + dx, Math.max(room.x + PANEL_MARGIN, right - maxW), right - PANEL_MIN_WIDTH);
    w = right - x;
  }
  if (edge.includes("s")) h = between(start.h + dy, PANEL_MIN_HEIGHT, room.y + room.h - PANEL_MARGIN - start.y);
  if (edge.includes("n")) {
    y = between(start.y + dy, room.y + PANEL_MARGIN, bottom - PANEL_MIN_HEIGHT);
    h = bottom - y;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
};
