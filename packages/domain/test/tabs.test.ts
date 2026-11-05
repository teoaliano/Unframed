import { describe, expect, it } from "vitest";
import {
  CLOSED_TAB_LIMIT,
  closeTab,
  editorTabKey,
  groupTabs,
  parseTabKey,
  renameTabKey,
  stepTab,
  editorTabsOf,
  isEditorTab,
  openEditorTab,
  projectOfTab,
  shapeOfTab,
  finishedAfter,
  moveTab,
  openTab,
  pinTab,
  type PinnedTabs,
  popClosed,
  pushClosed,
  restoreTabs,
  statusOf,
  tabGroup,
  tabWidth,
  unpinTab,
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
    expect(moveTab({ order: ["a", "b", "c"], pinned: [] }, "a", 2).order).toEqual(["b", "c", "a"]);
    expect(moveTab({ order: ["a", "b", "c"], pinned: [] }, "c", -5).order).toEqual(["c", "a", "b"]);
    expect(moveTab({ order: ["a", "b"], pinned: [] }, "zz", 0).order).toEqual(["a", "b"]);
  });

  it("restores the saved order, dropping names that no longer exist, and keeps a surviving active tab", () => {
    expect(restoreTabs({ order: ["b", "gone", "a"], active: "a" }, ["a", "b", "c"])).toEqual({ order: ["b", "a"], active: "a", pinned: [] });
    expect(restoreTabs({ order: ["b", "a"], active: "gone" }, ["a", "b"])).toEqual({ order: ["b", "a"], active: "b", pinned: [] });
    expect(restoreTabs({ order: ["x"], active: "x" }, ["a"])).toEqual({ order: [], active: undefined, pinned: [] });
  });

  it("restores a missing saved tab set from the remembered active project alone", () => {
    expect(restoreTabs({ order: [], active: null }, ["a", "b"])).toEqual({ order: [], active: undefined, pinned: [] });
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

  it("pins a tab to the end of the pinned tabs at the front, and unpins it to the first place after them", () => {
    expect(pinTab({ order: ["a", "b", "c"], pinned: [] }, "c")).toEqual({ order: ["c", "a", "b"], pinned: ["c"] });
    expect(pinTab({ order: ["c", "a", "b"], pinned: ["c"] }, "b")).toEqual({ order: ["c", "b", "a"], pinned: ["c", "b"] });
    expect(pinTab({ order: ["c", "a"], pinned: ["c"] }, "c")).toEqual({ order: ["c", "a"], pinned: ["c"] });
    expect(unpinTab({ order: ["c", "b", "a"], pinned: ["c", "b"] }, "c")).toEqual({ order: ["b", "c", "a"], pinned: ["b"] });
    expect(unpinTab({ order: ["a", "b"], pinned: [] }, "a")).toEqual({ order: ["a", "b"], pinned: [] });
  });

  it("moves a pinned tab only among the pinned tabs, and an unpinned one only after them", () => {
    expect(moveTab({ order: ["p", "q", "a", "b"], pinned: ["p", "q"] }, "q", 0)).toEqual({ order: ["q", "p", "a", "b"], pinned: ["q", "p"] });
    expect(moveTab({ order: ["p", "q", "a", "b"], pinned: ["p", "q"] }, "p", 3).order).toEqual(["q", "p", "a", "b"]);
    expect(moveTab({ order: ["p", "q", "a", "b"], pinned: ["p", "q"] }, "b", 0).order).toEqual(["p", "q", "b", "a"]);
  });

  it("keeps a reorder among the pinned tabs when another tab is pinned or unpinned", () => {
    let tabs: PinnedTabs = { order: ["a", "b", "c"], pinned: [] };
    tabs = pinTab(tabs, "a");
    tabs = pinTab(tabs, "b");
    tabs = moveTab(tabs, "b", 0);
    expect(tabs).toEqual({ order: ["b", "a", "c"], pinned: ["b", "a"] });
    tabs = pinTab(tabs, "c");
    expect(tabs).toEqual({ order: ["b", "a", "c"], pinned: ["b", "a", "c"] });
    tabs = unpinTab(tabs, "a");
    expect(tabs).toEqual({ order: ["b", "c", "a"], pinned: ["b", "c"] });
  });

  it("gives the range of places a tab may move to: the pinned tabs, or the tabs after them", () => {
    const tabs = { order: ["p", "q", "a", "b", "c"], pinned: ["q", "p"] };
    expect(tabGroup(tabs, "p")).toEqual({ low: 0, high: 1 });
    expect(tabGroup(tabs, "b")).toEqual({ low: 2, high: 4 });
    expect(tabGroup({ order: ["a"], pinned: [] }, "a")).toEqual({ low: 0, high: 0 });
  });

  it("restores the pins that survived, with the pinned tabs first", () => {
    expect(restoreTabs({ order: ["a", "p", "gone"], active: "a", pinned: ["p", "gone", "x"] }, ["a", "p"])).toEqual({ order: ["p", "a"], active: "a", pinned: ["p"] });
    expect(restoreTabs({ order: ["a"], active: "a" }, ["a"])).toEqual({ order: ["a"], active: "a", pinned: [] });
  });
});

describe("editor tabs", () => {
  it("names an editor tab by its project and shape, and tells the two kinds apart", () => {
    const key = editorTabKey("default", "shape:landing");
    expect(isEditorTab(key)).toBe(true);
    expect(isEditorTab("default")).toBe(false);
    expect(projectOfTab(key)).toBe("default");
    expect(shapeOfTab(key)).toBe("shape:landing");
    expect(projectOfTab("beta")).toBe("beta");
    expect(shapeOfTab("beta")).toBeUndefined();
  });

  it("opens an editor tab right after its project's tab and the editor tabs already beside it", () => {
    const a = editorTabKey("p", "shape:a");
    const b = editorTabKey("p", "shape:b");
    expect(openEditorTab({ order: ["p", "q"], pinned: [] }, a)).toEqual(["p", a, "q"]);
    expect(openEditorTab({ order: ["p", a, "q"], pinned: [] }, b)).toEqual(["p", a, b, "q"]);
    expect(openEditorTab({ order: ["p", a, "q"], pinned: [] }, a)).toEqual(["p", a, "q"]);
  });

  it("opens a pinned project's editor tab first among the unpinned tabs", () => {
    const a = editorTabKey("p", "shape:a");
    expect(openEditorTab({ order: ["p", "r", "q"], pinned: ["p", "r"] }, a)).toEqual(["p", "r", a, "q"]);
  });

  it("opens nothing for a project that has no tab", () => {
    expect(openEditorTab({ order: ["q"], pinned: [] }, editorTabKey("p", "shape:a"))).toEqual(["q"]);
  });

  it("lists a project's editor tabs, and closing a project takes them with it", () => {
    const a = editorTabKey("p", "shape:a");
    const c = editorTabKey("q", "shape:c");
    expect(editorTabsOf(["p", a, "q", c], "p")).toEqual([a]);
    expect(closeTab(["p", a, "q", c], "p", "p")).toEqual({ order: ["q", c], active: "q" });
    expect(closeTab(["q", "p", a], "p", "p")).toEqual({ order: ["q"], active: "q" });
    expect(closeTab(["p", a, "q"], a, "p")).toEqual({ order: ["q"], active: "q" });
  });

  it("closing the active editor tab lands on its project's tab", () => {
    const a = editorTabKey("p", "shape:a");
    expect(closeTab(["q", "p", a, "r"], a, a)).toEqual({ order: ["q", "p", "r"], active: "p" });
    expect(closeTab(["q", "p", a, "r"], "r", a)).toEqual({ order: ["q", "p", "r"], active: "r" });
  });

  it("never pins an editor tab", () => {
    const a = editorTabKey("p", "shape:a");
    expect(pinTab({ order: ["p", a], pinned: [] }, a)).toEqual({ order: ["p", a], pinned: [] });
  });

  it("restores an editor tab only with its project's tab", () => {
    const a = editorTabKey("p", "shape:a");
    const c = editorTabKey("gone", "shape:c");
    const d = editorTabKey("q", "shape:d");
    expect(restoreTabs({ order: ["p", a, c, d], active: a, pinned: [] }, ["p", "q"])).toEqual({ order: ["p", a], active: a, pinned: [] });
    expect(restoreTabs({ order: ["p", a], active: c, pinned: [] }, ["p"])).toEqual({ order: ["p", a], active: "p", pinned: [] });
    expect(restoreTabs({ order: [a, "p"], active: "p", pinned: ["p"] }, ["p"])).toEqual({ order: ["p", a], active: "p", pinned: ["p"] });
  });
});

describe("editor tabs stay with their project", () => {
  const a = editorTabKey("p", "shape:a");
  const b = editorTabKey("p", "shape:b");
  const c = editorTabKey("q", "shape:c");

  it("parses, builds and renames a tab key", () => {
    expect(parseTabKey(a)).toEqual({ project: "p", shape: "shape:a" });
    expect(parseTabKey("p")).toEqual({ project: "p" });
    expect(renameTabKey(a, "p", "z")).toBe(editorTabKey("z", "shape:a"));
    expect(renameTabKey("p", "p", "z")).toBe("z");
    expect(renameTabKey(c, "p", "z")).toBe(c);
  });

  it("groups each project's editor tabs right after it, a pinned project's after the pins", () => {
    expect(groupTabs({ order: [a, "q", c, "p", b], pinned: [] })).toEqual({ order: ["q", c, "p", a, b], pinned: [] });
    expect(groupTabs({ order: ["q", "p", a, c], pinned: ["p"] })).toEqual({ order: ["p", a, "q", c], pinned: ["p"] });
  });

  it("moves a project with its editor tabs, landing on a project boundary", () => {
    expect(moveTab({ order: ["p", a, b, "q", c, "r"], pinned: [] }, "p", 2).order).toEqual(["q", c, "p", a, b, "r"]);
    expect(moveTab({ order: ["p", a, b, "q", c, "r"], pinned: [] }, "r", 0).order).toEqual(["r", "p", a, b, "q", c]);
    expect(moveTab({ order: ["p", a, b, "q", c, "r"], pinned: [] }, "q", 1).order).toEqual(["q", c, "p", a, b, "r"]);
  });

  it("moves an editor tab only among its project's editor tabs", () => {
    expect(moveTab({ order: ["p", a, b, "q", c], pinned: [] }, a, 2).order).toEqual(["p", b, a, "q", c]);
    expect(moveTab({ order: ["p", a, b, "q", c], pinned: [] }, a, 4).order).toEqual(["p", b, a, "q", c]);
    expect(moveTab({ order: ["p", a, b, "q", c], pinned: [] }, c, 0).order).toEqual(["p", a, b, "q", c]);
  });

  it("steps a project past a whole neighbouring group, and an editor tab within its group", () => {
    expect(stepTab({ order: ["p", a, "q", c, "r"], pinned: [] }, "p", 1).order).toEqual(["q", c, "p", a, "r"]);
    expect(stepTab({ order: ["p", a, "q", c, "r"], pinned: [] }, "r", -1).order).toEqual(["p", a, "r", "q", c]);
    expect(stepTab({ order: ["p", a, b], pinned: [] }, b, -1).order).toEqual(["p", b, a]);
    expect(stepTab({ order: ["p", a, b], pinned: [] }, a, -1).order).toEqual(["p", a, b]);
  });

  it("keeps closed entries of any shape, matched by the given rule", () => {
    const same = (x: { key: string }, y: { key: string }) => x.key === y.key;
    const stack = pushClosed(pushClosed([], { key: "p", editors: [a] }, same), { key: "q", editors: [] }, same);
    expect(pushClosed(stack, { key: "p", editors: [] }, same)).toEqual([{ key: "p", editors: [] }, { key: "q", editors: [] }]);
  });
});
