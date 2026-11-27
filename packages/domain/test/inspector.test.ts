import { describe, expect, it } from "vitest";
import { EMPTY_SCALE, tokenScaleOf } from "../src/design/tokens.ts";
import { DEFAULT_TYPE_SCALE, fieldAria, fieldToken, pairShown, scrubbed, stepped, textStyleOf, trackingPercent, typeScaleOf, trackingValue, weightLabel } from "../src/inspector.ts";

describe("scrubbing and stepping", () => {
  it("moves half a unit per pixel of pointer, rounded, and stays in bounds", () => {
    expect(scrubbed(22, 30)).toBe(37);
    expect(scrubbed(24, 30)).toBe(39);
    expect(scrubbed(0, 20)).toBe(10);
    expect(scrubbed(4, -30, { min: 0 })).toBe(0);
    expect(scrubbed(90, 40, { max: 100 })).toBe(100);
  });

  it("steps by one, or ten with Shift", () => {
    expect(stepped(15, true, false)).toBe(16);
    expect(stepped(16, true, true)).toBe(26);
    expect(stepped(3, false, true, { min: 0 })).toBe(0);
  });
});

describe("the token step a field shows", () => {
  it("shows the step of the class that sets the property", () => {
    expect(fieldToken(EMPTY_SCALE, "padding-left", "flex h-12 items-center pl-3.5 pr-2")).toEqual({ name: "pl-3.5", label: "3.5" });
    expect(fieldToken(EMPTY_SCALE, "padding-top", "px-2 py-1")).toEqual({ name: "py-1", label: "1" });
    expect(fieldToken(EMPTY_SCALE, "font-size", "text-sm font-medium")).toEqual({ name: "text-sm", label: "sm" });
    expect(fieldToken(EMPTY_SCALE, "width", "size-7")).toEqual({ name: "size-7", label: "size-7" });
    expect(fieldToken(EMPTY_SCALE, "height", "h-12")).toEqual({ name: "h-12", label: "12" });
    expect(fieldToken(EMPTY_SCALE, "border-radius", "rounded-2xl")).toEqual({ name: "rounded-2xl", label: "2xl" });
    expect(fieldToken(EMPTY_SCALE, "border-radius", "rounded-full")).toEqual({ name: "rounded-full", label: "Full" });
    expect(fieldToken(EMPTY_SCALE, "line-height", "leading-6")).toEqual({ name: "leading-6", label: "6" });
    expect(fieldToken(EMPTY_SCALE, "row-gap", "flex gap-1")).toEqual({ name: "gap-1", label: "1" });
  });

  it("shows no step for an arbitrary value, a variant class or no class", () => {
    expect(fieldToken(EMPTY_SCALE, "padding-right", "pr-[13px]")).toBeUndefined();
    expect(fieldToken(EMPTY_SCALE, "padding-left", "md:pl-4")).toBeUndefined();
    expect(fieldToken(EMPTY_SCALE, "padding-left", "flex")).toBeUndefined();
    expect(fieldToken(EMPTY_SCALE, "padding-left", null)).toBeUndefined();
  });

  it("shows the class a draft asks for, or pixels when the draft is raw", () => {
    expect(fieldToken(EMPTY_SCALE, "padding-left", "pl-3.5", { kind: "class", after: "pl-4" })).toEqual({ name: "pl-4", label: "4" });
    expect(fieldToken(EMPTY_SCALE, "padding-left", "pl-3.5", { kind: "class", after: "pl-[15px]" })).toBeUndefined();
    expect(fieldToken(EMPTY_SCALE, "padding-left", "pl-3.5", { kind: "style", after: "15px" })).toBeUndefined();
  });

  it("names the field with both the class and the pixels when a class sets it", () => {
    expect(fieldAria("Gap between items", { name: "gap-1", label: "1" }, "4")).toBe("Gap between items: gap-1 (4)");
    expect(fieldAria("Width", { name: "size-7", label: "size-7" }, "28")).toBe("Width: size-7 (28)");
    expect(fieldAria("Padding left", undefined, "13")).toBe("Padding left");
  });

  it("shows a pair of sides as one value, or both when they differ", () => {
    expect(pairShown("8", "8")).toBe("8");
    expect(pairShown("20", "8")).toBe("20, 8");
  });
});

describe("typography", () => {
  it("names the text style a size class binds", () => {
    expect(textStyleOf(DEFAULT_TYPE_SCALE, "text-sm font-medium")).toEqual({ name: "text-sm", size: 14, leading: 20 });
    expect(textStyleOf(DEFAULT_TYPE_SCALE, "text-[15px]")).toBeUndefined();
  });

  it("labels weights as styles, italic included", () => {
    expect(weightLabel("400", false)).toBe("Regular");
    expect(weightLabel("400", true)).toBe("Italic");
    expect(weightLabel("700", true)).toBe("Bold Italic");
  });

  it("reads letter spacing as a percent of the font size and writes it in em", () => {
    expect(trackingPercent("normal", "14px")).toBe(0);
    expect(trackingPercent("1.4px", "14px")).toBe(10);
    expect(trackingValue(10)).toBe("0.1em");
    expect(trackingValue(0)).toBe("0em");
  });
});

describe("the type scale the presets offer", () => {
  it("comes from the project's font sizes with their line heights, or Tailwind's defaults", () => {
    expect(typeScaleOf(EMPTY_SCALE)).toBe(DEFAULT_TYPE_SCALE);
    const scale = tokenScaleOf({ css: [{ file: "src/index.css", text: '@import "tailwindcss";\n@theme { --text-5xs: 0.4375rem; --text-5xs--line-height: 0.75rem; }' }] });
    const steps = typeScaleOf(scale);
    expect(steps[0]).toEqual({ name: "text-5xs", size: 7, leading: 12 });
    expect(steps.find((step) => step.name === "text-sm")).toEqual({ name: "text-sm", size: 14, leading: 20 });
  });
});
