import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addScreenOverride,
  editorTabFacts,
  elementContext,
  ELEMENT_CONTEXT_INTRO,
  ELEMENT_CONTEXT_SCREEN,
  screenChip,
  screenEditInstruction,
  screenEditLines,
  screenOverrideOf,
  SCREEN_EDITS_TEMPLATE,
  screenSourceTree,
  undoScreenOverride,
  type ScreenOverride,
} from "../src/index.ts";

const asset = (file: string) => readFileSync(new URL(`../../../assets/prompts/${file}`, import.meta.url), "utf8");

describe("a Screen's editor tab", () => {
  it("is a screen tab titled like the Screen's label, from the shape's own title", () => {
    expect(editorTabFacts({ type: "screen", props: { title: "trunk", route: "/app", state: "" } }, { screens: true })).toEqual({ kind: "screen", title: "trunk · /app" });
    expect(editorTabFacts({ type: "screen", props: { title: "trunk", route: "/app", state: "the menu open" } }, { screens: true })).toEqual({ kind: "screen", title: "trunk · the menu open" });
  });

  it("is nothing while Screens are off, and pages keep their title", () => {
    expect(editorTabFacts({ type: "screen", props: { title: "trunk", route: "/app" } }, { screens: false })).toBeUndefined();
    expect(editorTabFacts({ type: "page", props: { title: "", fileName: "landing.html" } }, { screens: false })).toEqual({ kind: "page", title: "landing" });
    expect(editorTabFacts({ type: "image", props: {} }, { screens: true })).toBeUndefined();
  });
});

describe("a Screen's source tree, read from the live page", () => {
  const nodes = [
    { id: "uf1", selector: "", tag: "main", name: "page", children: [{ id: "uf2", selector: "", tag: "button", name: "Save", children: [] }] },
    { id: null, selector: "body > p", tag: "p", children: [] },
  ];

  it("holds every stamped element under its parent, written exactly as the latest report shows it", () => {
    const tree = screenSourceTree(nodes, { uf2: { tag: "button", inline: { color: "red", "font-size": null }, text: "Save", src: null } });
    expect(tree).toEqual([
      { id: "uf1", tag: "main", parent: null, index: 0, name: "page", named: false, text: null, style: {}, hidden: false },
      { id: "uf2", tag: "button", parent: "uf1", index: 0, name: "Save", named: false, text: "Save", style: { color: "red" }, hidden: false },
    ]);
  });

  it("adds a reported element the tree has not seen yet, at the top", () => {
    const tree = screenSourceTree([], { uf9: { tag: "img", inline: {}, text: null, src: "/a.png", name: "logo" } });
    expect(tree).toEqual([{ id: "uf9", tag: "img", parent: null, index: 0, name: "logo", named: false, text: null, style: {}, hidden: false, src: "/a.png" }]);
  });
});

describe("overrides in a Screen", () => {
  const color = (value: string): ScreenOverride => ({ edit: { type: "style", elementId: "uf1", property: "color", value }, name: "Save", path: "body > button" });

  it("keeps style, text and hide changes, and nothing a Screen cannot preview", () => {
    expect(screenOverrideOf({ type: "style", elementId: "uf1", property: "color", value: "red" }, { name: "Save", path: "body > button" })).toEqual(color("red"));
    expect(screenOverrideOf({ type: "text", elementId: "uf1", text: "Go" }, { name: "Save", path: "p" })?.edit.type).toBe("text");
    expect(screenOverrideOf({ type: "hide", elementId: "uf1", hidden: true }, { name: "Save", path: "p" })?.edit.type).toBe("hide");
    expect(screenOverrideOf({ type: "attribute", elementId: "uf1", name: "data-uf-name", value: "x" }, { name: "Save", path: "p" })).toBeUndefined();
    expect(screenOverrideOf({ type: "image", elementId: "uf1", target: "src", file: "a.png" }, { name: "Save", path: "p" })).toBeUndefined();
  });

  it("replaces the same element's same change, moving it last, and undo takes the last one off", () => {
    const text: ScreenOverride = { edit: { type: "text", elementId: "uf1", text: "Go" }, name: "Save", path: "body > button" };
    const list = addScreenOverride(addScreenOverride(addScreenOverride([], color("red")), text), color("blue"));
    expect(list).toEqual([text, color("blue")]);
    expect(undoScreenOverride(list)).toEqual([text]);
    expect(undoScreenOverride([])).toEqual([]);
  });

  it("lists each element once with its changes, in the order they were first changed", () => {
    const lines = screenEditLines([
      color("red"),
      { edit: { type: "hide", elementId: "uf2", hidden: true }, name: "Banner", path: "#banner" },
      { edit: { type: "text", elementId: "uf1", text: "Go" }, name: "Save", path: "body > button" },
      { edit: { type: "style", elementId: "uf1", property: "padding-top", value: null }, name: "Save", path: "body > button" },
      { edit: { type: "hide", elementId: "uf3", hidden: false }, name: "Note", path: "#note" },
    ]);
    expect(lines).toEqual(['- Save (body > button): color: red; text "Go"; remove padding-top', "- Banner (#banner): hidden", "- Note (#note): shown"]);
  });

  it("writes the instruction from the asset, naming the Screen, its branch, state and worktree", () => {
    const instruction = screenEditInstruction({ shape: "s1", branch: "trunk", state: "/app", worktree: "/w/trunk", overrides: [color("red")] });
    expect(instruction).toBe(
      SCREEN_EDITS_TEMPLATE.replace("<shape>", "s1").replace("<branch>", "trunk").replace("<state>", "/app").replace("<worktree>", "/w/trunk").replace("<changes>", "- Save (body > button): color: red"),
    );
    expect(asset("screen-edits.md")).toContain(SCREEN_EDITS_TEMPLATE);
  });
});

describe("a Screen's element chip", () => {
  it("has no element id, finds the element by its path, and drops the stamp from its excerpt", () => {
    const chip = { elementId: "uf3", liveSelector: '[data-hf-id="uf3"]', tag: "button", label: "button", startTag: '<button data-hf-id="uf3" style="color: red">', text: "Save", hasChildren: false };
    expect(screenChip(chip, { path: "body > main > button", name: "btn" })).toEqual({ ...chip, elementId: null, liveSelector: "body > main > button", label: "btn", startTag: '<button style="color: red">' });
  });
});

describe("a Screen in the element context", () => {
  it("lists a Screen's chips under its own header", () => {
    const chip = { shapeId: "s1", elementId: null, selector: "body > button", tag: "button", label: "Save", excerpt: "<button>Save</button>" };
    expect(elementContext([chip], [{ shapeId: "s1", kind: "screen", label: "trunk · /app" }])).toBe(
      [ELEMENT_CONTEXT_INTRO, `${ELEMENT_CONTEXT_SCREEN.replace("{label}", "trunk · /app").replace("{id}", "s1")}\n- body > button: <button>Save</button>`].join("\n\n"),
    );
    expect(asset("element-context.md")).toContain(ELEMENT_CONTEXT_SCREEN);
  });
});
