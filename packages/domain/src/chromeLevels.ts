export type LabelLevel = "off" | "hover" | "on";

/** Which shape labels show at `zoom`: none below 0.5, only on hover or selection below 0.75, all from there. */
export const labelLevel = (zoom: number): LabelLevel => (zoom < 0.5 ? "off" : zoom < 0.75 ? "hover" : "on");

const BASE_GAP = 26;
const MIN_SCREEN_GAP = 16;

/** The dot grid's gap in canvas px: 26, doubled while it would be under 16 screen px. */
export const gridGap = (zoom: number): number => {
  let gap = BASE_GAP;
  while (gap * zoom < MIN_SCREEN_GAP) gap *= 2;
  return gap;
};
