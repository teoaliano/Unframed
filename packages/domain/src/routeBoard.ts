import type { CodeRoute } from "./repoAnalysis/types.ts";
import { flowLayout } from "./flows.ts";
import { SCREEN_GAP } from "./screens.ts";
import { withoutRestore } from "./mockRuntime.ts";

export const ANALYSIS_FILES = {
  codeMap: ".unframed/analysis/code-map.json",
  designSystem: ".unframed/analysis/design-system.json",
  states: ".unframed/analysis/states.json",
} as const;

export const PLACE_MAX_SCREENS = 24;

export interface RouteToPlace {
  readonly path: string;
  readonly group: string;
  readonly name: string;
}

export interface SkippedRoute {
  readonly path: string;
  readonly reason: string;
}

const segments = (path: string): string[] => path.split(/[?#]/)[0]!.split("/").filter((part) => part !== "");

const groupOf = (path: string): string => segments(path)[0] ?? "home";

const titled = (word: string): string =>
  word
    .split(/[-_\s]+/)
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const fits = (pattern: string, path: string): boolean => {
  const want = segments(pattern);
  const have = segments(path);
  for (let at = 0; at < want.length; at++) {
    const part = want[at]!;
    if (part.startsWith(":") && part.endsWith("*")) return true;
    if (at >= have.length) return false;
    if (!part.startsWith(":") && part !== have[at]) return false;
  }
  return want.length === have.length;
};

export const placeableRoutes = (
  routes: ReadonlyArray<CodeRoute>,
  options: { readonly asked?: ReadonlyArray<string> | undefined; readonly shown: ReadonlySet<string>; readonly most?: number },
): { readonly place: ReadonlyArray<RouteToPlace>; readonly skipped: ReadonlyArray<SkippedRoute> } => {
  const place: RouteToPlace[] = [];
  const skipped: SkippedRoute[] = [];
  const most = options.most ?? PLACE_MAX_SCREENS;
  const wanted: RouteToPlace[] = [];
  if (options.asked !== undefined) {
    for (const path of options.asked) {
      const route = routes.find((candidate) => candidate.params.length === 0 && candidate.path === path) ?? routes.find((candidate) => fits(candidate.path, path));
      wanted.push({ path, group: route?.group ?? groupOf(path), name: route?.name ?? (titled(segments(path).at(-1) ?? "") || "Home") });
    }
  } else
    for (const route of routes) {
      const path = route.params.length === 0 ? route.path : route.example;
      if (path === undefined || path.trim() === "") skipped.push({ path: route.path, reason: "a dynamic route with no example" });
      else wanted.push({ path, group: route.group, name: route.name });
    }
  for (const route of wanted) {
    if (!route.path.startsWith("/")) skipped.push({ path: route.path, reason: "not a path in the app" });
    else if (options.shown.has(withoutRestore(route.path))) skipped.push({ path: route.path, reason: "already on the canvas" });
    else if (place.some((placed) => placed.path === route.path)) continue;
    else if (place.length >= most) skipped.push({ path: route.path, reason: `more than ${most} Screens in one call` });
    else place.push(route);
  }
  return { place, skipped };
};

export interface RouteBoard {
  readonly frames: ReadonlyArray<{ readonly name: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly screens: ReadonlyArray<{ readonly x: number; readonly y: number; readonly route: RouteToPlace }> }>;
}

export const routeBoardLayout = (input: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly routes: ReadonlyArray<RouteToPlace> }): RouteBoard => {
  const groups = new Map<string, RouteToPlace[]>();
  for (const route of input.routes) groups.set(route.group, [...(groups.get(route.group) ?? []), route]);
  let y = input.y;
  const frames = [...groups.entries()].map(([group, routes]) => {
    const layout = flowLayout({ x: input.x, y, w: input.w, h: input.h, count: routes.length });
    y += layout.group.h + 2 * SCREEN_GAP;
    return { name: titled(group) || "Home", ...layout.group, screens: layout.screens.map((at, index) => ({ ...at, route: routes[index]! })) };
  });
  return { frames };
};

export const statesFrameName = (route: string): string => `${withoutRestore(route)} states`;
