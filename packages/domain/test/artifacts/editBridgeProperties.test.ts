import { describe, expect, it } from "vitest";
import { DESIGN_FIELDS, editBridgeSource } from "../../src/index.ts";

const bridgeProperties = (): string[] => {
  const match = /const PROPERTIES = \[([\s\S]*?)\];/.exec(editBridgeSource());
  if (match === null) throw new Error("the edit bridge has no PROPERTIES list");
  return [...match[1]!.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);
};

describe("the edit bridge's property list", () => {
  it("reports every CSS property of DESIGN_FIELDS", () => {
    const fields = DESIGN_FIELDS.map((field) => field.property);
    expect(bridgeProperties()).toEqual(expect.arrayContaining(fields));
  });

  it("adds only the two reads the Design tab needs beyond the fields: the picture's background and the display rule of Gap and Layout", () => {
    const fields = new Set(DESIGN_FIELDS.map((field) => field.property));
    const extra = bridgeProperties().filter((property) => !fields.has(property));
    expect(extra.sort()).toEqual(["background-image", "display"]);
  });

  it("lists each property once", () => {
    const list = bridgeProperties();
    expect(new Set(list).size).toBe(list.length);
  });
});
