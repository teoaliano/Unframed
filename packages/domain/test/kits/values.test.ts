import { describe, expect, it } from "vitest";
import { colourDistance, lengthPx, normaliseShadow, parseBezier, parseColour, parseLength, parseTime, parseWeight, weightNumber, firstFamily } from "../../src/kits/values.ts";

describe("colours", () => {
  it("reads hex in three, four, six and eight digits", () => {
    expect(parseColour("#fff")).not.toBeNull();
    expect(parseColour("#ffff")).not.toBeNull();
    expect(parseColour("#1a73e8")).not.toBeNull();
    expect(parseColour("#1a73e880")).not.toBeNull();
    expect(parseColour("#1a73e")).toBeNull();
    expect(parseColour("#zzzzzz")).toBeNull();
  });

  it("reads rgb, hsl and oklch, with comma and space syntax and an alpha", () => {
    expect(colourDistance(parseColour("rgb(26, 115, 232)")!, parseColour("#1a73e8")!)).toBeLessThan(0.001);
    expect(colourDistance(parseColour("rgb(26 115 232 / 1)")!, parseColour("#1a73e8")!)).toBeLessThan(0.001);
    expect(colourDistance(parseColour("hsl(216, 80%, 51%)")!, parseColour("hsl(216 80% 51%)")!)).toBeLessThan(0.001);
    expect(parseColour("oklch(0.6 0.1 250)")).not.toBeNull();
    expect(parseColour("rgb(0 0 0 / 50%)")!.alpha).toBeCloseTo(0.5);
    expect(parseColour("rgb(0 0 0 / 0.25)")!.alpha).toBeCloseTo(0.25);
    expect(parseColour("rgb(1, 2)")).toBeNull();
  });

  it("reads CSS named colours and the transparent keyword", () => {
    expect(parseColour("rebeccapurple")).not.toBeNull();
    expect(parseColour("RED")).not.toBeNull();
    expect(parseColour("transparent")!.alpha).toBe(0);
    expect(parseColour("notacolour")).toBeNull();
  });

  it("measures the OKLab distance times 100", () => {
    expect(colourDistance(parseColour("#000")!, parseColour("#000")!)).toBe(0);
    expect(colourDistance(parseColour("#000")!, parseColour("#fff")!)).toBeCloseTo(100, 0);
  });
});

describe("lengths", () => {
  it("reads px, rem, em, % and a bare 0", () => {
    expect(parseLength("16px")).toEqual({ value: 16, unit: "px" });
    expect(parseLength("1.5rem")).toEqual({ value: 1.5, unit: "rem" });
    expect(parseLength("2em")).toEqual({ value: 2, unit: "em" });
    expect(parseLength("50%")).toEqual({ value: 50, unit: "%" });
    expect(parseLength("0")).toEqual({ value: 0, unit: "px" });
    expect(parseLength("16")).toBeNull();
    expect(parseLength("auto")).toBeNull();
  });

  it("converts rem and em at 16 px and leaves % unconverted", () => {
    expect(lengthPx({ value: 1.5, unit: "rem" })).toBe(24);
    expect(lengthPx({ value: 2, unit: "em" })).toBe(32);
    expect(lengthPx({ value: 50, unit: "%" })).toBeUndefined();
  });
});

describe("times, weights, beziers, shadows and families", () => {
  it("reads times in ms and s as milliseconds", () => {
    expect(parseTime("200ms")).toBe(200);
    expect(parseTime("0.2s")).toBe(200);
    expect(parseTime("200")).toBeNull();
  });

  it("reads weights: numbers from 1 to 1000 and the four keywords", () => {
    expect(parseWeight("700")).toBe(true);
    expect(parseWeight(0)).toBe(false);
    expect(parseWeight(1001)).toBe(false);
    expect(parseWeight("bolder")).toBe(true);
    expect(parseWeight("heavy")).toBe(false);
    expect(weightNumber("normal")).toBe(400);
    expect(weightNumber("bold")).toBe(700);
    expect(weightNumber(600)).toBe(600);
    expect(weightNumber("lighter")).toBeUndefined();
  });

  it("reads cubic-bezier() with x inside 0 to 1", () => {
    expect(parseBezier("cubic-bezier(0.33, 1, 0.68, 1)")).toEqual([0.33, 1, 0.68, 1]);
    expect(parseBezier("cubic-bezier(0.5, -0.2, 0.5, 1.4)")).toEqual([0.5, -0.2, 0.5, 1.4]);
    expect(parseBezier("cubic-bezier(1.5, 0, 0, 1)")).toBeNull();
    expect(parseBezier("cubic-bezier(0, 0, 1)")).toBeNull();
    expect(parseBezier("power2.out")).toBeNull();
  });

  it("normalises shadows: spacing, case and zero units", () => {
    expect(normaliseShadow("0px 2px 8px  RGBA(0, 0, 0, 0.2)")).toBe(normaliseShadow("0 2px 8px rgba(0,0,0,0.2)"));
    expect(normaliseShadow("0 0 0 0px #000")).toBe("0 0 0 0 #000");
    expect(normaliseShadow("10px 0 0 #000")).not.toBe(normaliseShadow("1px 0 0 #000"));
  });

  it("takes the first family, unquoted and lower-cased", () => {
    expect(firstFamily('"Inter", sans-serif')).toBe("inter");
    expect(firstFamily("'Helvetica Neue', Arial")).toBe("helvetica neue");
  });
});
