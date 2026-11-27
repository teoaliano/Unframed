import { describe, expect, it } from "vitest";
import { classStep, DEFAULT_TYPE_SCALE, fieldAria, pairShown, scrubbed, stepOfClass, stepped, textStyleOf, trackingPercent, trackingValue, weightLabel } from "../src/inspector.ts";

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
    expect(classStep("flex h-12 items-center pl-3.5 pr-2", "padding-left")).toEqual({ name: "pl-3.5", step: "3.5" });
    expect(classStep("px-2 py-1", "padding-top")).toEqual({ name: "py-1", step: "1" });
    expect(classStep("text-sm font-medium", "font-size")).toEqual({ name: "text-sm", step: "sm" });
    expect(classStep("size-7", "width")).toEqual({ name: "size-7", step: "size-7" });
    expect(classStep("h-12", "height")).toEqual({ name: "h-12", step: "12" });
    expect(classStep("rounded-2xl", "border-radius")).toEqual({ name: "rounded-2xl", step: "2xl" });
    expect(classStep("rounded-full", "border-radius")).toEqual({ name: "rounded-full", step: "Full" });
    expect(classStep("leading-6", "line-height")).toEqual({ name: "leading-6", step: "6" });
    expect(classStep("flex gap-1", "row-gap")).toEqual({ name: "gap-1", step: "1" });
  });

  it("shows no step for an arbitrary value, a variant class or no class", () => {
    expect(classStep("pr-[13px]", "padding-right")).toBeUndefined();
    expect(classStep("md:pl-4", "padding-left")).toBeUndefined();
    expect(classStep("flex", "padding-left")).toBeUndefined();
    expect(classStep(null, "padding-left")).toBeUndefined();
    expect(stepOfClass("hover:pl-4")).toBeUndefined();
  });

  it("names the field with both the class and the pixels when a class sets it", () => {
    expect(fieldAria("Gap between items", { name: "gap-1", step: "1" }, "4")).toBe("Gap between items: gap-1 (4)");
    expect(fieldAria("Width", { name: "size-7", step: "size-7" }, "28")).toBe("Width: size-7 (28)");
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
