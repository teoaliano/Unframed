import { GROUP_MAX, GROUP_SIDE_MARGIN, GROUP_TOP_MARGIN } from "./grouping.ts";
import type { ScreenStep } from "@unframed/contracts";
import { SCREEN_GAP } from "./screens.ts";
import { describeStep } from "./screenStates.ts";

export const FLOW_MAX_STATES = 12;
export const flowTooMany = (most: number): string => `A Flow of Screens this size holds at most ${most} states; name fewer.`;
export const FLOW_NO_STATES = "Name at least one state.";
export const FLOW_ARROW_LABEL_MAX = 80;

export const arrowLabel = (input: { readonly action?: string | undefined; readonly route: string; readonly steps: ReadonlyArray<ScreenStep> }): string => {
  const last = input.steps.at(-1);
  const label = input.action?.trim() || (last === undefined ? `go to ${input.route}` : describeStep(last));
  return label.length > FLOW_ARROW_LABEL_MAX ? label.slice(0, FLOW_ARROW_LABEL_MAX) : label;
};

export interface FlowLayout {
  readonly group: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly screens: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

const fitting = (room: number, margins: number, size: number): number => Math.max(1, Math.floor((room - margins + SCREEN_GAP) / (size + SCREEN_GAP)));

export const flowCapacity = (w: number, h: number): number =>
  Math.min(FLOW_MAX_STATES, fitting(GROUP_MAX.w, 2 * GROUP_SIDE_MARGIN, w) * fitting(GROUP_MAX.h, GROUP_TOP_MARGIN + GROUP_SIDE_MARGIN, h));

export const flowLayout = (input: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly count: number }): FlowLayout => {
  const columns = Math.min(input.count, fitting(GROUP_MAX.w, 2 * GROUP_SIDE_MARGIN, input.w));
  const rows = Math.ceil(input.count / columns);
  const screens = Array.from({ length: input.count }, (_, index) => ({
    x: GROUP_SIDE_MARGIN + (index % columns) * (input.w + SCREEN_GAP),
    y: GROUP_TOP_MARGIN + Math.floor(index / columns) * (input.h + SCREEN_GAP),
  }));
  return {
    group: {
      x: input.x,
      y: input.y,
      w: 2 * GROUP_SIDE_MARGIN + columns * input.w + (columns - 1) * SCREEN_GAP,
      h: GROUP_TOP_MARGIN + GROUP_SIDE_MARGIN + rows * input.h + (rows - 1) * SCREEN_GAP,
    },
    screens,
  };
};
