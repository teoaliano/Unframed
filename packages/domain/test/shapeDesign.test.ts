import { describe, expect, it } from "vitest";
import { ANNOTATION_SWATCHES, designDisplayValues, designKeysOf, designPatched, isDesignableType, readableTextOn, shapeDesignOf } from "../src/index.ts";

describe("shapeDesignOf", () => {
  it("reads the values a shape's meta holds", () => {
    expect(shapeDesignOf({ ref: "1", unframed: { run: "r", design: { fontSize: 23, textColor: "#ff0044", fontFamily: "Inter", fontWeight: "600" } } })).toEqual({
      fontSize: 23,
      textColor: "#ff0044",
      fontFamily: "Inter",
      fontWeight: "600",
    });
  });

  it("drops values out of range or in the wrong form", () => {
    expect(
      shapeDesignOf({
        unframed: {
          design: {
            fontSize: 0,
            lineHeight: 40,
            strokeWidth: -1,
            cornerRadius: Number.NaN,
            textColor: "red",
            fillColor: "#12345",
            fontWeight: "450",
            fontFamily: "x; } body { color: red",
            other: 1,
          },
        },
      }),
    ).toEqual({});
  });

  it("reads nothing from meta without a design object under meta.unframed", () => {
    expect(shapeDesignOf(undefined)).toEqual({});
    expect(shapeDesignOf({ design: { fontSize: 20 } })).toEqual({});
    expect(shapeDesignOf({ unframed: { design: "big" } })).toEqual({});
    expect(shapeDesignOf({ unframed: { design: [1] } })).toEqual({});
  });
});

describe("designPatched", () => {
  it("sets valid values, removes nulls and ignores invalid ones", () => {
    const design = { fontSize: 18, textColor: "#000000" };
    expect(designPatched(design, { fontSize: 30, textColor: null, strokeWidth: -2, fillColor: "#ffffff80" })).toEqual({ fontSize: 30, fillColor: "#ffffff80" });
  });
});

describe("designDisplayValues", () => {
  const design = { fontFamily: "Space Grotesk", fontSize: 40, fontWeight: "700", lineHeight: 1.1, textColor: "#111111", fillColor: "#eeeeee", strokeColor: "#222222", strokeWidth: 6, cornerRadius: 12 };

  it("maps a text shape's values onto its text display values", () => {
    expect(designDisplayValues("text", design)).toEqual({ fontFamily: '"Space Grotesk"', fontSize: 40, fontWeight: "700", lineHeight: 1.1, color: "#111111" });
  });

  it("maps a geo shape's values onto its label, fill, stroke and roundness", () => {
    expect(designDisplayValues("geo", design)).toEqual({
      labelFontFamily: '"Space Grotesk"',
      labelFontSize: 40,
      labelFontWeight: "700",
      labelLineHeight: 1.1,
      labelColor: "#111111",
      fillColor: "#eeeeee",
      strokeColor: "#222222",
      strokeWidth: 6,
      strokeRoundness: 12,
    });
  });

  it("maps a note's fill and stroke onto its background and border", () => {
    expect(designDisplayValues("note", design)).toMatchObject({ noteBackgroundColor: "#eeeeee", borderColor: "#222222", borderWidth: 6 });
  });

  it("sets a note's text black or white by contrast with its colour, whatever text colour it holds", () => {
    expect(designDisplayValues("note", { ...design, fillColor: "#ffb224" }).labelColor).toBe("#000000");
    expect(designDisplayValues("note", { ...design, fillColor: "#3e63dd" }).labelColor).toBe("#ffffff");
    expect(designDisplayValues("note", { textColor: "#ff0000" })).toEqual({});
    expect(designKeysOf("note")).not.toContain("textColor");
  });

  it("gives a line only its stroke", () => {
    expect(designDisplayValues("line", design)).toEqual({ strokeColor: "#222222", strokeWidth: 6 });
  });

  it("keeps a family list as written", () => {
    expect(designDisplayValues("text", { fontFamily: "'Inter', sans-serif" })).toEqual({ fontFamily: "'Inter', sans-serif" });
  });
});

describe("readableTextOn", () => {
  it("gives light colours black text and the rest white", () => {
    expect(readableTextOn("#ffffff")).toBe("#000000");
    expect(readableTextOn("#000000")).toBe("#ffffff");
    expect(readableTextOn("#ffe066")).toBe("#000000");
    expect(readableTextOn("#8e4ec6")).toBe("#ffffff");
    expect(readableTextOn("#ffffff80")).toBe("#000000");
    expect(ANNOTATION_SWATCHES.map((swatch) => readableTextOn(swatch.hex))).toEqual(["#ffffff", "#ffffff", "#ffffff", "#000000", "#000000", "#000000", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff"]);
  });
});

describe("designable types", () => {
  it("covers tldraw's text, geo, note, arrow and drawing shapes, and nothing else", () => {
    expect(["text", "geo", "note", "arrow", "draw", "line", "highlight"].every(isDesignableType)).toBe(true);
    expect(["image", "video", "frame", "page", "motion", "component"].some(isDesignableType)).toBe(false);
    expect(designKeysOf("arrow")).not.toContain("fontWeight");
    expect(designKeysOf("geo")).toContain("cornerRadius");
  });
});
