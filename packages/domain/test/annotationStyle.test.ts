import { describe, expect, it } from "vitest";
import { ANNOTATION_SWATCHES, designPanelPreference, designValueRefusal, styleControlsFor, type DesignableType } from "../src/index.ts";

describe("styleControlsFor", () => {
  it.each<[DesignableType, string[]]>([
    ["text", ["font", "size", "bold", "align", "textColor"]],
    ["note", ["fill", "font", "size", "bold", "align"]],
    ["geo", ["fill", "stroke", "strokeWidth", "font", "size"]],
    ["arrow", ["stroke", "strokeWidth", "dash"]],
    ["draw", ["stroke", "strokeWidth", "dash"]],
    ["line", ["stroke", "strokeWidth", "dash"]],
    ["highlight", ["stroke", "strokeWidth"]],
  ])("gives a %s its controls in the canonical order", (type, controls) => {
    expect(styleControlsFor([type])).toEqual(controls);
  });

  it.each<[DesignableType[], string[]]>([
    [["text", "note"], ["font", "size", "bold", "align"]],
    [["note", "line"], []],
    [["geo", "draw"], ["stroke", "strokeWidth"]],
    [["draw", "draw", "arrow"], ["stroke", "strokeWidth", "dash"]],
    [["note", "geo"], ["fill", "font", "size"]],
  ])("gives %j the controls they share", (types, controls) => {
    expect(styleControlsFor(types)).toEqual(controls);
  });

  it("gives no controls for no shapes", () => {
    expect(styleControlsFor([])).toEqual([]);
  });
});

describe("ANNOTATION_SWATCHES", () => {
  it("holds twelve distinct colours the design values accept", () => {
    expect(ANNOTATION_SWATCHES).toHaveLength(12);
    expect(new Set(ANNOTATION_SWATCHES.map((swatch) => swatch.hex.toLowerCase())).size).toBe(12);
    for (const swatch of ANNOTATION_SWATCHES) expect(designValueRefusal("fillColor", swatch.hex)).toBeNull();
  });
});

describe("designPanelPreference", () => {
  it.each([
    [undefined, false],
    [null, false],
    ["open", false],
    [{ open: "yes" }, false],
    [{ open: false }, false],
    [{ open: true }, true],
  ])("reads %j as open %s", (value, open) => {
    expect(designPanelPreference(value)).toEqual({ open });
  });
});
