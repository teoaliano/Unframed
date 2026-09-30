import { describe, expect, it } from "vitest";
import { addablePropValue, defaultProps, keepSupported, modelParams, ratioLabel, resetProps } from "../src/index.ts";

const entry = (params: Record<string, unknown> | null | undefined) => ({ id: "x/y", name: "Y", params });

const enumOf = (...values: string[]) => ({ type: "enum", values });

describe("the props a model declares", () => {
  it("reads enums and plain arrays as a prop's allowed values, in the tray's order, with their labels", () => {
    const params = modelParams(
      entry({
        output_format: enumOf("png", "webp"),
        quality: ["low", "medium", "high"],
        aspect_ratio: enumOf("1:1", "2:3", "3:2"),
        background: enumOf("auto", "transparent", "opaque"),
        resolution: enumOf("1K", "2K"),
        seed: { type: "range", min: 0, max: 100 },
        style: enumOf("vivid"),
      }),
    );
    expect(params.props.map((prop) => [prop.key, prop.label, prop.values])).toEqual([
      ["resolution", "Size", ["1K", "2K"]],
      ["aspect_ratio", "Ratio", ["1:1", "2:3", "3:2"]],
      ["quality", "Quality", ["low", "medium", "high"]],
      ["background", "Background", ["auto", "transparent", "opaque"]],
      ["output_format", "Format", ["png", "webp"]],
    ]);
  });

  it.each([
    ["an empty enum", { quality: enumOf() }],
    ["an empty array", { quality: [] }],
    ["a range", { quality: { type: "range", min: 1, max: 2 } }],
    ["a string", { quality: "high" }],
    ["no params at all", null],
  ])("offers no prop for %s", (_case, params) => {
    expect(modelParams(entry(params as Record<string, unknown> | null)).props).toEqual([]);
  });

  it("offers Format even when the model declares one value", () => {
    expect(modelParams(entry({ output_format: enumOf("svg") })).props).toEqual([{ key: "output_format", label: "Format", values: ["svg"] }]);
  });

  it("reads the input_references range's max as the reference cap", () => {
    expect(modelParams(entry({ input_references: { type: "range", min: 0, max: 4 } })).referenceCap).toBe(4);
    expect(modelParams(entry({})).referenceCap).toBeUndefined();
    expect(modelParams(undefined).referenceCap).toBeUndefined();
  });

  it("answers supported only for a declared prop with one of its values", () => {
    const params = modelParams(entry({ quality: enumOf("low", "high") }));
    expect(params.supported("quality", "high")).toBe(true);
    expect(params.supported("quality", "ultra")).toBe(false);
    expect(params.supported("background", "auto")).toBe(false);
    expect(params.supported("runs", 2)).toBe(false);
  });
});

describe("exact sizes", () => {
  const params = modelParams(
    entry({ size: ["1470x630", "1024x1024", "1000x700"], resolution: enumOf("1K"), aspect_ratio: enumOf("1:1"), quality: enumOf("low") }),
  );

  it("replace the resolution tiers and the ratio: Size offers them and size is its key", () => {
    expect(params.props.map((prop) => prop.key)).toEqual(["size", "quality"]);
    expect(params.supported("resolution", "1K")).toBe(false);
    expect(params.supported("aspect_ratio", "1:1")).toBe(false);
    expect(params.supported("size", "1024x1024")).toBe(true);
  });

  it("are labelled with the nearest ratio when it is within 2%", () => {
    expect(params.props[0]).toEqual({
      key: "size",
      label: "Size",
      values: ["1470x630", "1024x1024", "1000x700"],
      optionLabels: { "1470x630": "1470x630 · 21:9", "1024x1024": "1024x1024 · 1:1", "1000x700": "1000x700" },
    });
  });

  it.each([
    [1920, 1080, "16:9"],
    [1080, 1920, "9:16"],
    [1470, 630, "21:9"],
    [630, 1470, "9:21"],
    [1536, 1024, "3:2"],
    [1024, 1536, "2:3"],
    [1024, 768, "4:3"],
    [768, 1024, "3:4"],
    [1000, 1015, "1:1"],
    [1000, 1025, undefined],
    [1000, 700, undefined],
  ])("%i by %i is %s", (w, h, label) => {
    expect(ratioLabel(w, h)).toBe(label);
  });
});

describe("defaults and the reset on a model change", () => {
  const full = modelParams(
    entry({ resolution: enumOf("1K", "2K"), quality: enumOf("low", "high"), aspect_ratio: enumOf("1:1", "2:3"), background: enumOf("auto", "opaque") }),
  );

  it("places each default only when the model declares the prop and allows the value", () => {
    expect(defaultProps(full)).toEqual({ resolution: "1K", quality: "low", aspect_ratio: "1:1" });
    expect(defaultProps(modelParams(entry({ quality: enumOf("medium", "high"), aspect_ratio: enumOf("1:1") })))).toEqual({ aspect_ratio: "1:1" });
    expect(defaultProps(modelParams(entry(null)))).toEqual({});
  });

  it("resets every model-driven prop to the new model's default or removes it, and leaves Runs alone", () => {
    const next = modelParams(entry({ quality: enumOf("low", "high"), output_format: enumOf("png") }));
    expect(resetProps({ quality: "high", background: "opaque", resolution: "2K", aspect_ratio: "2:3", size: "10x10", output_format: "png", runs: 4 }, next)).toEqual({
      quality: "low",
      runs: 4,
    });
  });

  it("keeps only supported values of stored props, and the ones no model drives", () => {
    expect(keepSupported({ quality: "high", background: "transparent", resolution: "8K", runs: "free" }, full)).toEqual({ quality: "high", runs: "free" });
  });

  it("offers a prop to add with its current or default value, else its first", () => {
    expect(addablePropValue(full, "quality", {})).toBe("low");
    expect(addablePropValue(full, "background", {})).toBe("auto");
    expect(addablePropValue(full, "quality", { quality: "high" })).toBe("high");
  });
});
