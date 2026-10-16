import { describe, expect, it } from "vitest";
import {
  CLOSED_TAB_LIMIT,
  closeTab,
  finishedAfter,
  moveTab,
  openTab,
  popClosed,
  pushClosed,
  restoreTabs,
  statusOf,
  tabWidth,
} from "../src/index.ts";

describe("project tabs", () => {
  it("opens a new name at the end and keeps the place of one already open", () => {
    expect(openTab(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(openTab(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("closes the active tab onto its right neighbour, then its left, then none", () => {
    expect(closeTab(["a", "b", "c"], "b", "b")).toEqual({ order: ["a", "c"], active: "c" });
    expect(closeTab(["a", "b", "c"], "c", "c")).toEqual({ order: ["a", "b"], active: "b" });
    expect(closeTab(["a"], "a", "a")).toEqual({ order: [], active: undefined });
  });

  it("keeps the active tab when a background tab closes", () => {
    expect(closeTab(["a", "b", "c"], "a", "c")).toEqual({ order: ["a", "b"], active: "a" });
  });

  it("moves a tab and clamps the target", () => {
    expect(moveTab(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(moveTab(["a", "b", "c"], "c", -5)).toEqual(["c", "a", "b"]);
    expect(moveTab(["a", "b"], "zz", 0)).toEqual(["a", "b"]);
  });

  it("restores the saved order, dropping names that no longer exist, and keeps a surviving active tab", () => {
    expect(restoreTabs({ order: ["b", "gone", "a"], active: "a" }, ["a", "b", "c"])).toEqual({ order: ["b", "a"], active: "a" });
    expect(restoreTabs({ order: ["b", "a"], active: "gone" }, ["a", "b"])).toEqual({ order: ["b", "a"], active: "b" });
    expect(restoreTabs({ order: ["x"], active: "x" }, ["a"])).toEqual({ order: [], active: undefined });
  });

  it("restores a missing saved tab set from the remembered active project alone", () => {
    expect(restoreTabs({ order: [], active: null }, ["a", "b"])).toEqual({ order: [], active: undefined });
  });

  it("sizes tabs between 120 and 200 pixels", () => {
    expect(tabWidth(1000, 2)).toBe(200);
    expect(tabWidth(600, 4)).toBe(150);
    expect(tabWidth(300, 10)).toBe(120);
    expect(tabWidth(900, 0)).toBe(200);
  });

  it("gives waiting on the person precedence over running, and running over finished", () => {
    expect(statusOf({ running: 1, needsYou: 1 }, true)).toBe("needs-you");
    expect(statusOf({ running: 2, needsYou: 0 }, true)).toBe("running");
    expect(statusOf({ running: 0, needsYou: 0 }, true)).toBe("finished");
    expect(statusOf(undefined, false)).toBe("none");
  });

  it("marks a tab finished only when its running count falls to zero from above", () => {
    expect(finishedAfter({ running: 1, needsYou: 0 }, { running: 0, needsYou: 0 })).toBe(true);
    expect(finishedAfter({ running: 0, needsYou: 0 }, { running: 0, needsYou: 0 })).toBe(false);
    expect(finishedAfter({ running: 2, needsYou: 0 }, { running: 1, needsYou: 0 })).toBe(false);
  });

  it("keeps the newest ten closed projects, most recent first, without duplicates", () => {
    let stack: ReadonlyArray<string> = [];
    for (let index = 0; index < CLOSED_TAB_LIMIT + 3; index++) stack = pushClosed(stack, `p${index}`);
    expect(stack).toHaveLength(CLOSED_TAB_LIMIT);
    expect(stack[0]).toBe(`p${CLOSED_TAB_LIMIT + 2}`);
    expect(pushClosed(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(popClosed(["a", "b"])).toEqual({ name: "a", stack: ["b"] });
    expect(popClosed([])).toEqual({ name: undefined, stack: [] });
  });
});
