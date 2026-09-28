export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

export const GROUP_MIN: Size = { w: 180, h: 96 };
export const GROUP_MAX: Size = { w: 4000, h: 4000 };
export const GROUP_DEFAULT: Size = { w: 420, h: 280 };

const SIDE_MARGIN = 28;
const TOP_MARGIN = 56;

/** A group may hold prompts, images, videos and marks, never a group, a page or a motion. */
export const mayBeGroupMember = (type: string): boolean =>
  type !== "frame" && type !== "page" && type !== "motion" && type !== "group";

/**
 * The box of a group made around `members`: their bounding box plus 28 px left, right
 * and bottom and 56 px on top, grown right and down to the minimum group size.
 */
export const wrapBox = (members: ReadonlyArray<Box>): Box | undefined => {
  if (members.length === 0) return undefined;
  const left = Math.min(...members.map((box) => box.x));
  const top = Math.min(...members.map((box) => box.y));
  const right = Math.max(...members.map((box) => box.x + box.w));
  const bottom = Math.max(...members.map((box) => box.y + box.h));
  return {
    x: left - SIDE_MARGIN,
    y: top - TOP_MARGIN,
    w: Math.max(GROUP_MIN.w, right - left + 2 * SIDE_MARGIN),
    h: Math.max(GROUP_MIN.h, bottom - top + TOP_MARGIN + SIDE_MARGIN),
  };
};

export const clampGroupSize = (size: Size): Size => ({
  w: Math.min(GROUP_MAX.w, Math.max(GROUP_MIN.w, size.w)),
  h: Math.min(GROUP_MAX.h, Math.max(GROUP_MIN.h, size.h)),
});
