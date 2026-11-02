import { describe, expect, it } from "vitest";
import { tokenUses, type Kit } from "../../src/kits/index.ts";

const kit: Kit = {
  format: 1,
  name: "Brand",
  modes: ["light"],
  tokens: [
    { path: "color/brand/primary", type: "color", value: "#1a73e8" },
    { path: "color/brand/accent", type: "color", value: "#ff0000", formerNames: ["--color-brand-tint"] },
    { path: "font/heading", type: "textStyle", value: { fontFamily: "Inter", fontSize: "32px", fontWeight: 700, lineHeight: 1.2, letterSpacing: "0" } },
  ],
};

describe("tokenUses (spec 19, task 17)", () => {
  it("finds a token by its CSS name, a former name, a text style sub-name and unframed.token", () => {
    expect(tokenUses("<p style='color: var(--color-brand-primary)'></p>", kit)).toEqual(["color/brand/primary"]);
    expect(tokenUses("<p style='color: var(--color-brand-tint, red)'></p>", kit)).toEqual(["color/brand/accent"]);
    expect(tokenUses("<h1 style='font-size: var(--font-heading-font-size)'></h1>", kit)).toEqual(["font/heading"]);
    expect(tokenUses(`<script>unframed.token("color/brand/accent")</script>`, kit)).toEqual(["color/brand/accent"]);
    expect(tokenUses(`<script>unframed.token('--color-brand-primary')</script>`, kit)).toEqual(["color/brand/primary"]);
  });

  it("does not count a longer name that starts with a token's name, or a literal", () => {
    expect(tokenUses("<p style='color: var(--color-brand-primary-2)'></p>", kit)).toEqual([]);
    expect(tokenUses("<p style='color: #1a73e8'></p>", kit)).toEqual([]);
  });
});
