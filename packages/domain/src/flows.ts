import { GROUP_MAX, GROUP_SIDE_MARGIN, GROUP_TOP_MARGIN } from "./grouping.ts";
import { normaliseRoute, SCREEN_GAP } from "./screens.ts";

export const FLOW_MAX_ROUTES = 12;
export const FLOW_NO_ROUTES = "Name at least one route, such as /settings.";
export const flowBadRoute = (route: string): string => `${route} is not a route in the app; a route is a path such as /settings.`;
export const flowTooMany = (most: number): string => `A Flow of Screens this size holds at most ${most}; name fewer routes.`;

export const flowRoutes = (input: string | ReadonlyArray<string>): { readonly routes: ReadonlyArray<string> } | { readonly error: string } => {
  const typed = typeof input === "string" ? input.split(/[\n,]/) : input;
  const routes: string[] = [];
  for (const raw of typed) {
    if (raw.trim() === "") continue;
    const route = normaliseRoute(raw);
    if (route === undefined) return { error: flowBadRoute(raw.trim()) };
    if (!routes.includes(route)) routes.push(route);
  }
  return routes.length === 0 ? { error: FLOW_NO_ROUTES } : { routes };
};

export interface FlowLayout {
  readonly group: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly screens: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

const fitting = (room: number, margins: number, size: number): number => Math.max(1, Math.floor((room - margins + SCREEN_GAP) / (size + SCREEN_GAP)));

export const flowCapacity = (w: number, h: number): number =>
  Math.min(FLOW_MAX_ROUTES, fitting(GROUP_MAX.w, 2 * GROUP_SIDE_MARGIN, w) * fitting(GROUP_MAX.h, GROUP_TOP_MARGIN + GROUP_SIDE_MARGIN, h));

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
