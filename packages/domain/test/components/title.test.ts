import { describe, expect, it } from "vitest";
import { componentTitleFromTag } from "../../src/index.ts";

describe("componentTitleFromTag", () => {
  it.each([
    ["uf-price-card", "Price card"],
    ["uf-button", "Button"],
    ["uf-a-b-c", "A b c"],
  ])("titles %s as %s", (tag, title) => {
    expect(componentTitleFromTag(tag)).toBe(title);
  });
});
