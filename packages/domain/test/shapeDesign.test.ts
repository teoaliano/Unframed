import { describe, expect, it } from "vitest";
import { designDisplayValues, designKeysOf, designPatched, isDesignableType, shapeDesignOf } from "../src/index.ts";

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

  it("gives a line only its stroke", () => {
    expect(designDisplayValues("line", design)).toEqual({ strokeColor: "#222222", strokeWidth: 6 });
  });

  it("keeps a family list as written", () => {
    expect(designDisplayValues("text", { fontFamily: "'Inter', sans-serif" })).toEqual({ fontFamily: "'Inter', sans-serif" });
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
