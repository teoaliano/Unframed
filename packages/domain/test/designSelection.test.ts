import { describe, expect, it } from "vitest";
import { ancestorsOf, depthOf, designPick, selectChildren, selectParent, type LayerTree } from "../src/index.ts";

const parents: Record<string, string | null> = { section: null, rail: "section", header: "rail", icon: "header", heading: "header", search: "header", add: "header", transcript: "rail" };
const tree: LayerTree = {
  parentOf: (id) => parents[id] ?? null,
  childrenOf: (id) => Object.keys(parents).filter((each) => parents[each] === id),
};
const levels = (...ids: string[]) => ids.map((id) => ({ id }));
const pick = (overrides: Partial<Parameters<typeof designPick>[0]>) =>
  designPick({ levels: levels("section", "rail", "header", "search"), selection: [], depth: null, clicks: 1, deepest: false, additive: false, ...overrides });

describe("design mode picks", () => {
  it("takes the top layer on entry and goes one level deeper per double-click", () => {
    expect(pick({ clicks: 2 })).toEqual(["section"]);
    expect(pick({ clicks: 2, selection: ["section"], depth: 0 })).toEqual(["rail"]);
    expect(pick({ clicks: 2, selection: ["header"], depth: 2 })).toEqual(["search"]);
    expect(pick({ clicks: 2, selection: ["search"], depth: 3 })).toEqual(["search"]);
  });

  it("keeps the selection when a click lands inside it, and otherwise picks at the selection's depth", () => {
    expect(pick({ selection: ["rail"], depth: 1 })).toEqual(["rail"]);
    expect(pick({ levels: levels("section", "rail", "transcript"), selection: ["search"], depth: 3 })).toEqual(["transcript"]);
    expect(pick({ levels: levels("section", "rail", "header", "heading"), selection: ["transcript"], depth: 2 })).toEqual(["header"]);
    expect(pick({ selection: [], depth: null })).toEqual(["section"]);
  });

  it("takes the deepest element on Cmd-click, and Shift adds or removes", () => {
    expect(pick({ deepest: true })).toEqual(["search"]);
    expect(pick({ deepest: true, additive: true, selection: ["add"], depth: 3 })).toEqual(["add", "search"]);
    expect(pick({ deepest: true, additive: true, selection: ["add", "search"], depth: 3 })).toEqual(["add"]);
    expect(pick({ levels: [{ id: null }], selection: ["add"], additive: true })).toEqual(["add"]);
    expect(pick({ levels: [], selection: ["add"] })).toEqual([]);
  });

  it("selects the parent with Shift+Enter and the children with Enter", () => {
    expect(selectParent(["heading"], tree)).toEqual(["header"]);
    expect(selectParent(["heading", "search"], tree)).toEqual(["header"]);
    expect(selectParent(["section"], tree)).toEqual(["section"]);
    expect(selectChildren(["header"], tree)).toEqual(["icon", "heading", "search", "add"]);
    expect(selectChildren(["icon"], tree)).toEqual(["icon"]);
  });

  it("lists the ancestors, nearest first, and the depth", () => {
    expect(ancestorsOf("search", tree)).toEqual(["header", "rail", "section"]);
    expect(depthOf("search", tree)).toBe(3);
    expect(depthOf("section", tree)).toBe(0);
  });
});
