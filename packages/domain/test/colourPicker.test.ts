import { describe, expect, it } from "vitest";
import { tokenScaleOf } from "../src/design/tokens.ts";
import { alphaPercent, colourGroups, colourWrite, currentColourToken, hexAndAlpha, hexOfHsva, hsvaOf, sameColourToken, withAlpha } from "../src/colourPicker.ts";

const scale = tokenScaleOf({
  css: [
    {
      file: "src/index.css",
      text: `@import "tailwindcss";
@theme { --color-zinc-800: #27272a; --color-sky-600: #0084d1; }
:root { --text-default: var(--color-zinc-800); --action-highlight: var(--color-sky-600); --button-ghost-foreground: var(--text-default); --button-ghost-surface: #ffffff; --surface-page: #fafafa; }`,
    },
  ],
});

describe("colour conversion", () => {
  it("goes from hex to hue, saturation, value and alpha and back", () => {
    expect(hsvaOf("#ff0000")).toEqual({ h: 0, s: 1, v: 1, a: 1 });
    expect(hexOfHsva(hsvaOf("#27272a")!)).toBe("#27272A");
    expect(hexOfHsva({ h: 200, s: 1, v: 0.82, a: 0.5 })).toBe("#008BD180");
    expect(withAlpha("#27272a", 10)).toBe("#27272A1A");
    expect(alphaPercent("rgba(0, 0, 0, 0.25)")).toBe(25);
    expect(hexAndAlpha("rgba(39, 39, 42, 0.1)")).toEqual({ hex: "27272A", alpha: 10 });
  });
});

describe("the colour token picker", () => {
  it("groups the project's colours and searches them by name, hex or class", () => {
    const names = (query: string) => colourGroups(scale, query).map((group) => `${group.name}: ${group.tokens.map((token) => token.name).join(" ")}`);
    expect(names("")).toEqual(expect.arrayContaining(["Text: text-default", "Surfaces: surface-page", "Button: button-ghost-foreground button-ghost-surface"]));
    expect(names("0084")).toEqual(expect.arrayContaining([expect.stringMatching(/action-highlight/)]));
    expect(names("text-action-highlight")).toEqual(["Other: action-highlight"]);
    expect(names("nothing-like-this")).toEqual([]);
  });

  it("puts the colours the page uses first", () => {
    expect(colourGroups(scale, "", ["rgb(250, 250, 250)"])[0]).toMatchObject({ name: "On this page", count: 1 });
  });

  it("names the token a class or a var binds, and a token with the same value", () => {
    expect(currentColourToken(scale, "color", "text-(--action-highlight)", null)?.name).toBe("action-highlight");
    expect(currentColourToken(scale, "color", null, "var(--button-ghost-foreground)")?.chain).toEqual(["--button-ghost-foreground", "--text-default", "--color-zinc-800"]);
    expect(sameColourToken(scale, "rgb(0, 132, 209)")?.name).toBe("action-highlight");
    expect(sameColourToken(scale, "#27272a")?.name).toBe("text-default");
  });

  it("writes a picked token as its variable, with the class Apply will write", () => {
    const token = scale.colors.find((each) => each.name === "action-highlight")!;
    expect(colourWrite("color", token)).toEqual({ value: "var(--action-highlight)", className: "text-(--action-highlight)" });
  });
});
