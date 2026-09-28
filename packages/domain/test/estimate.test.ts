import { describe, expect, it } from "vitest";
import { estimateImageRun, formatEstimate, imagePrice, type Sku } from "../src/index.ts";

const out = (cost: number, variant?: string): Sku => ({ unit: "image", billable: "output_image", cost_usd: cost, ...(variant === undefined ? {} : { variant }) });
const input = (cost: number, billable = "input_image"): Sku => ({ unit: "image", billable, cost_usd: cost });

describe("the price of one image from one endpoint", () => {
  it.each<[string, Sku[], Record<string, string>, number, number | null]>([
    ["no SKUs: none", [], {}, 0, null],
    ["a SKU billed per token: none", [out(0.04), { unit: "token", billable: "output_image", cost_usd: 0.00001 }], {}, 0, null],
    ["a SKU billed per megapixel: none", [{ unit: "megapixel", billable: "output_image", cost_usd: 0.03 }], {}, 0, null],
    ["no output SKU: none", [input(0.01)], {}, 0, null],
    ["one output SKU: that one", [out(0.04)], { quality: "high" }, 0, 0.04],
    ["several: the variant whose every part is a chosen value", [out(0.01, "low_1k"), out(0.17, "high_1k"), out(0.25, "high_2k")], { quality: "high", resolution: "1K" }, 0, 0.17],
    ["variant parts match case-insensitively", [out(0.01, "LOW"), out(0.17, "High")], { quality: "high" }, 0, 0.17],
    ["a variant with a part nobody chose does not match", [out(0.17, "high_hd"), out(0.02)], { quality: "high" }, 0, 0.02],
    ["no variant matches: the SKU with no variant", [out(0.17, "high"), out(0.05)], { quality: "low" }, 0, 0.05],
    ["no variant matches and no bare SKU: none", [out(0.17, "high"), out(0.1, "medium")], { quality: "low" }, 0, null],
    ["two matching variants are ambiguous: none", [out(0.17, "high"), out(0.2, "1k")], { quality: "high", resolution: "1K" }, 0, null],
    ["two bare SKUs are ambiguous: none", [out(0.1), out(0.2)], {}, 0, null],
    ["each reference image adds the input billables", [out(0.04), input(0.01), input(0.002, "input_reference")], {}, 3, 0.076],
  ])("%s", (_case, skus, chosen, references, price) => {
    const answer = imagePrice(skus, chosen, references);
    if (price === null) expect(answer).toBeNull();
    else expect(answer).toBeCloseTo(price, 10);
  });
});

describe("the price of a run", () => {
  it("needs every endpoint to give the same number", () => {
    expect(estimateImageRun({ endpoints: [[out(0.04)], [out(0.04)]], chosen: {}, referenceImages: 0, outputs: 1 })).toBeCloseTo(0.04, 10);
    expect(estimateImageRun({ endpoints: [[out(0.04)], [out(0.05)]], chosen: {}, referenceImages: 0, outputs: 1 })).toBeNull();
    expect(estimateImageRun({ endpoints: [[out(0.04)], []], chosen: {}, referenceImages: 0, outputs: 1 })).toBeNull();
    expect(estimateImageRun({ endpoints: [], chosen: {}, referenceImages: 0, outputs: 1 })).toBeNull();
  });

  it("multiplies by the output count", () => {
    expect(estimateImageRun({ endpoints: [[out(0.04), input(0.01)]], chosen: {}, referenceImages: 2, outputs: 4 })).toBeCloseTo(0.24, 10);
  });
});

describe("the estimate as shown", () => {
  it.each([
    [0.17, "est. ~$0.17"],
    [0.1, "est. ~$0.10"],
    [1.2345, "est. ~$1.23"],
    [0.035, "est. ~$0.035"],
    [0.0999, "est. ~$0.100"],
    [0.004, "est. ~$0.004"],
  ])("%d reads %s", (value, shown) => {
    expect(formatEstimate(value)).toBe(shown);
  });
});
