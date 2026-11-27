import { describe, expect, it } from "vitest";
import { tokenScaleOf } from "../src/design/tokens.ts";
import { alignLabel, alignmentOf, alignmentWrite, blurOf, DROP_SHADOW, shadowLayers, shadowValue, sizeModeOf, sizeModeValue, spacingPresets } from "../src/inspectorLayout.ts";

describe("sizing", () => {
  it("reads Fixed, Hug or Fill from the classes and the inline value", () => {
    expect(sizeModeOf("width", "w-full px-2", null)).toBe("fill");
    expect(sizeModeOf("width", "flex-1", null)).toBe("fill");
    expect(sizeModeOf("width", "w-64", null)).toBe("fixed");
    expect(sizeModeOf("height", "size-7", null)).toBe("fixed");
    expect(sizeModeOf("width", "flex gap-2", null)).toBe("hug");
    expect(sizeModeOf("width", "w-64", "fit-content")).toBe("hug");
    expect(sizeModeOf("height", "h-12", "100%")).toBe("fill");
  });

  it("writes each mode as a width value", () => {
    expect(sizeModeValue("fixed", 359.2)).toBe("359.2px");
    expect(sizeModeValue("hug", 359)).toBe("fit-content");
    expect(sizeModeValue("fill", 359)).toBe("100%");
  });
});

describe("the alignment grid", () => {
  it("maps a row's justify and align to a spot, and a column's the other way round", () => {
    expect(alignmentOf("row", "flex-start", "center")).toEqual({ row: 1, column: 0 });
    expect(alignmentOf("column", "flex-end", "center")).toEqual({ row: 2, column: 1 });
    expect(alignmentOf("row", "normal", "normal")).toEqual({ row: 0, column: 0 });
  });

  it("writes a spot back as justify-content and align-items", () => {
    expect(alignmentWrite("row", 2, 2)).toEqual({ "justify-content": "flex-end", "align-items": "flex-end" });
    expect(alignmentWrite("column", 0, 1)).toEqual({ "justify-content": "flex-start", "align-items": "center" });
    expect(alignLabel(0, 0)).toBe("Align top left");
    expect(alignLabel(1, 1)).toBe("Align center");
    expect(alignLabel(2, 2)).toBe("Align bottom right");
  });
});

describe("gap presets", () => {
  it("offers the project's semantic spacing with its alias, then the scale as gap classes", () => {
    const scale = tokenScaleOf({ css: [{ file: "a.css", text: '@import "tailwindcss";\n:root { --rail-gap: 12px; --toast-offset: var(--rail-gap); }' }] });
    const groups = spacingPresets(scale, "gap");
    expect(groups.map((group) => group.group)).toEqual(["Semantic", "Scale"]);
    expect(groups[0]!.items.map((item) => [item.name, item.px])).toEqual([
      ["rail-gap", 12],
      ["toast-offset → rail-gap", 12],
    ]);
    expect(groups[1]!.items.slice(0, 4).map((item) => [item.name, item.px])).toEqual([
      ["gap-0", 0],
      ["gap-px", 1],
      ["gap-0.5", 2],
      ["gap-1", 4],
    ]);
  });
});

describe("shadows and blurs", () => {
  it("reads and writes shadow layers", () => {
    expect(shadowLayers("rgba(0, 0, 0, 0.1) 0px 1px 2px 0px, rgba(0, 0, 0, 0.2) 0px 4px 8px -2px inset")).toEqual([
      { inset: false, x: 0, y: 1, blur: 2, spread: 0, colour: "rgba(0, 0, 0, 0.1)" },
      { inset: true, x: 0, y: 4, blur: 8, spread: -2, colour: "rgba(0, 0, 0, 0.2)" },
    ]);
    expect(shadowLayers("none")).toEqual([]);
    expect(shadowValue([DROP_SHADOW])).toBe("0px 4px 4px 0px #00000040");
    expect(shadowValue([])).toBe("none");
    expect(blurOf("blur(4px)")).toBe(4);
    expect(blurOf("none")).toBeUndefined();
  });
});
