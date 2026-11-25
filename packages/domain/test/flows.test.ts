import { describe, expect, it } from "vitest";
import { arrowLabel, FLOW_ARROW_LABEL_MAX, flowCapacity, flowLayout, GROUP_MAX } from "../src/index.ts";

describe("a Flow's arrows", () => {
  it("read as the action that leads to the next state, or the last step that reaches it, or going to its route", () => {
    expect(arrowLabel({ action: "  click Generate ", route: "/", steps: [] })).toBe("click Generate");
    expect(arrowLabel({ route: "/", steps: [{ action: "press", key: "Enter" }, { action: "click", target: { role: "button", name: "Generate" } }] })).toBe("click button Generate");
    expect(arrowLabel({ action: "", route: "/pricing", steps: [] })).toBe("go to /pricing");
    expect(arrowLabel({ action: "x".repeat(200), route: "/", steps: [] })).toHaveLength(FLOW_ARROW_LABEL_MAX);
  });
});

describe("a Flow's layout", () => {
  it("lays Screens out in order, in rows that keep the group within its largest size", () => {
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
