import { describe, expect, it } from "vitest";
import { tokensForField } from "../../src/kits/tokenFields.ts";
import type { Kit } from "../../src/kits/types.ts";

const kit: Kit = {
  format: 1,
  name: "Brand",
  modes: ["light"],
  tokens: [
    { path: "color/brand/primary", type: "color", value: "#1a73e8" },
    { path: "radius/card", type: "dimension", value: "12px" },
    { path: "space/md", type: "dimension", value: "16px" },
    { path: "border/width", type: "dimension", value: "1px" },
    { path: "gap/tight", type: "dimension", value: "4px" },
    { path: "font/size/body", type: "dimension", value: "16px" },
    { path: "font/body", type: "fontFamily", value: "Inter" },
    { path: "weight/bold", type: "fontWeight", value: 700 },
    { path: "shadow/card", type: "shadow", value: "0 2px 8px rgba(0, 0, 0, 0.2)" },
    { path: "text/body", type: "textStyle", value: { fontFamily: "Inter", fontSize: "16px", fontWeight: 400, lineHeight: 1.5, letterSpacing: "0px" } },
    { path: "motion/fast", type: "duration", value: "200ms" },
  ],
};

const paths = (field: string, k: Kit = kit) => tokensForField(field, k).map((token) => token.path);

describe("which tokens a field offers", () => {
  it.each([
    ["font-family", ["font/body"]],
    ["font-weight", ["weight/bold"]],
    ["color", ["color/brand/primary"]],
    ["background-color", ["color/brand/primary"]],
    ["border-color", ["color/brand/primary"]],
    ["box-shadow", ["shadow/card"]],
    ["text-style", ["text/body"]],
  ])("%s offers %j", (field, expected) => {
    expect(paths(field)).toEqual(expected);
  });

  it("offers dimension tokens for sizes, line heights, letter spacing, border width, radius and spacing", () => {
    const dimensions = kit.tokens.filter((token) => token.type === "dimension").map((token) => token.path);
    for (const field of ["font-size", "line-height", "letter-spacing", "border-width", "border-radius", "padding", "margin", "gap"]) {
      expect(paths(field).sort()).toEqual([...dimensions].sort());
    }
  });

  it("offers nothing for a field with no token slot, or an unknown field", () => {
    for (const field of ["opacity", "flex-direction", "align-items", "justify-content", "flex-wrap", "text-align", "border-style", "not-a-field"]) {
      expect(paths(field)).toEqual([]);
    }
  });

  it("offers nothing with no kit, or a kit without the type", () => {
    expect(tokensForField("color", { ...kit, tokens: [] })).toEqual([]);
    expect(paths("font-family", { ...kit, tokens: [kit.tokens[0]!] })).toEqual([]);
  });
});

describe("the order of dimension tokens", () => {
  it("puts space, spacing and gap paths first for spacing fields, each group in kit order", () => {
    expect(paths("padding")).toEqual(["space/md", "gap/tight", "radius/card", "border/width", "font/size/body"]);
  });

  it("puts radius, radii and rounded paths first for the corner radius", () => {
    expect(paths("border-radius")).toEqual(["radius/card", "space/md", "border/width", "gap/tight", "font/size/body"]);
  });

  it("puts font, text and size paths first for text sizes", () => {
    expect(paths("font-size")).toEqual(["font/size/body", "radius/card", "space/md", "border/width", "gap/tight"]);
  });

  it("keeps kit order for the other dimension fields", () => {
    expect(paths("border-width")).toEqual(["radius/card", "space/md", "border/width", "gap/tight", "font/size/body"]);
  });
});
