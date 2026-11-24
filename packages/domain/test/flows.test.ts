import { describe, expect, it } from "vitest";
import { FLOW_NO_ROUTES, flowBadRoute, flowCapacity, flowLayout, flowRoutes, GROUP_MAX } from "../src/index.ts";

describe("a Flow's routes", () => {
  it("reads typed routes one per line or by commas, as paths, without repeats", () => {
    expect(flowRoutes("/\nsettings\n\n /pricing , /settings\nhttp://localhost:3000/about")).toEqual({ routes: ["/", "/settings", "/pricing", "/about"] });
    expect(flowRoutes(["/", "/team?tab=1"])).toEqual({ routes: ["/", "/team?tab=1"] });
  });

  it("refuses no routes and anything that is not a path in the app", () => {
    expect(flowRoutes(" \n ")).toEqual({ error: FLOW_NO_ROUTES });
    expect(flowRoutes("/ok\nhttps://example.com/")).toEqual({ error: flowBadRoute("https://example.com/") });
  });
});

describe("a Flow's layout", () => {
  it("lays Screens out in route order, in rows that keep the group within its largest size", () => {
    const layout = flowLayout({ x: 100, y: 2000, w: 1280, h: 800, count: 3 });
    expect(layout.screens).toEqual([
      { x: 28, y: 56 },
      { x: 28 + 1280 + 80, y: 56 },
      { x: 28, y: 56 + 800 + 80 },
    ]);
    expect(layout.group).toEqual({ x: 100, y: 2000, w: 28 * 2 + 1280 * 2 + 80, h: 56 + 28 + 800 * 2 + 80 });
    expect(layout.group.w).toBeLessThanOrEqual(GROUP_MAX.w);
    expect(flowLayout({ x: 0, y: 0, w: 390, h: 844, count: 4 }).screens.map((screen) => screen.y)).toEqual([56, 56, 56, 56]);
  });

  it("holds as many Screens as fit, and never more than twelve", () => {
    expect(flowCapacity(1280, 800)).toBe(8);
    expect(flowCapacity(390, 844)).toBe(12);
  });
});
