export const DRAWER_WIDTH = 380;
export const DRAWER_MIN_WIDTH = 320;
export const DRAWER_MAX_WIDTH = 640;
export const DRAWER_MIN_CANVAS = 400;

export const drawerWidth = (want: unknown, windowWidth: number): number => {
  const wanted = typeof want === "number" && Number.isFinite(want) ? want : DRAWER_WIDTH;
  const high = Math.min(DRAWER_MAX_WIDTH, Math.floor((windowWidth - DRAWER_MIN_CANVAS) / 2));
  return Math.round(Math.min(Math.max(DRAWER_MIN_WIDTH, wanted), Math.max(DRAWER_MIN_WIDTH, high)));
};
