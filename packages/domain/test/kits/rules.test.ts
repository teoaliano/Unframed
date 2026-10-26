import { describe, expect, it } from "vitest";
import { kitRefusal, pathRefusal, valueRefusal } from "../../src/kits/rules.ts";
import type { Kit, Token } from "../../src/kits/types.ts";

const kit = (over: Partial<Kit> = {}): Kit => ({ format: 1, name: "Brand", modes: ["light"], tokens: [], ...over });
const one = (token: Token, over: Partial<Kit> = {}) => kitRefusal(kit({ tokens: [token], ...over }));
const literal = (path: string, type: Token["type"], value: unknown): Token => ({ path, type, value }) as Token;

describe("token names", () => {
  it.each([
    ["color/brand/primary", null],
    ["space/4", null],
    ["a", null],
    ["Color/brand", "A token name is words joined by slashes, like color/brand/primary."],
    ["color//x", "A token name is words joined by slashes, like color/brand/primary."],
    ["a/b/c/d/e/f/g", "A token name is words joined by slashes, like color/brand/primary."],
    ["x".repeat(41), "A token name is words joined by slashes, like color/brand/primary."],
    ["color/" + "x".repeat(115), "A token name is words joined by slashes, like color/brand/primary."],
  ])("%s", (path, expected) => {
    expect(pathRefusal(path)).toBe(expected);
  });

  it("refuses a second token with the same path", () => {
    expect(kitRefusal(kit({ tokens: [literal("a/b", "color", "#fff"), literal("a/b", "color", "#000")] }))).toBe("There is already a token a/b.");
  });

  it("refuses two tokens whose CSS names collide, and names both", () => {
    expect(kitRefusal(kit({ tokens: [literal("color/brand-primary", "color", "#fff"), literal("color/brand/primary", "color", "#000")] }))).toBe(
      "color/brand-primary and color/brand/primary both make --color-brand-primary. Rename one.",
    );
  });

  it("refuses a text style whose sub-name collides with another token", () => {
    const k = kit({
      tokens: [
        { path: "text/body", type: "textStyle", value: { fontFamily: "Inter", fontSize: "16px", fontWeight: 400, lineHeight: 1.5, letterSpacing: "0px" } },
        literal("text/body/font/size", "dimension", "8px"),
      ],
    });
    expect(kitRefusal(k)).toBe("text/body and text/body/font/size both make --text-body-font-size. Rename one.");
  });

  it("refuses a former name that another token now uses", () => {
    const k = kit({
      tokens: [literal("color/brand/primary", "color", "#fff"), { ...literal("color/main", "color", "#000"), formerNames: ["--color-brand-primary"] }],
    });
    expect(kitRefusal(k)).toBe("color/brand/primary and color/main both make --color-brand-primary. Rename one.");
  });
});

describe("the kit", () => {
  it("accepts an empty kit and refuses a bad name, no mode and too many modes", () => {
    expect(kitRefusal(kit())).toBeNull();
    expect(kitRefusal(kit({ name: "" }))).toBe("A kit needs a name of 1 to 80 characters.");
    expect(kitRefusal(kit({ name: "x".repeat(81) }))).toBe("A kit needs a name of 1 to 80 characters.");
    expect(kitRefusal(kit({ modes: [] }))).toBe("A kit keeps at least one mode.");
    expect(kitRefusal(kit({ modes: Array.from({ length: 13 }, (_, i) => "m" + i) }))).toBe("A kit holds at most 12 modes.");
  });

  it("refuses a mode name that is not a short word, and a repeated one", () => {
    expect(kitRefusal(kit({ modes: ["Light"] }))).toBe("A mode name is a short word, like light or dark.");
    expect(kitRefusal(kit({ modes: ["light", "light"] }))).toBe("There is already a mode light.");
  });

  it("refuses more than 2000 tokens", () => {
    const tokens = Array.from({ length: 2001 }, (_, i) => literal("t/" + i, "color", "#fff"));
    expect(kitRefusal(kit({ tokens }))).toBe("A kit holds at most 2000 tokens.");
  });

  it("refuses a kit whose JSON is over 512 KiB", () => {
    const tokens = Array.from({ length: 2000 }, (_, i) => literal("t/" + i, "shadow", "0 0 1px #000" + " ".repeat(300)));
    expect(kitRefusal(kit({ tokens, modes: ["light"] }))).toBe("The kit is too large to save.");
  });
});

describe("values by type", () => {
  it.each([
    ["color", "#1a73e8", null],
    ["color", "rgb(26, 115, 232)", null],
    ["color", "oklch(0.6 0.1 250)", null],
    ["color", "1a73e8", "1a73e8 is not a colour. Use a hex value like #1a73e8, or rgb(), hsl() or oklch()."],
    ["dimension", "16px", null],
    ["dimension", "1.5rem", null],
    ["dimension", "50%", null],
    ["dimension", "0", null],
    ["dimension", 16, "16 is not a size. Use a number with px, rem, em or %."],
    ["dimension", "16", "16 is not a size. Use a number with px, rem, em or %."],
    ["fontFamily", "Inter, sans-serif", null],
    ["fontFamily", "   ", "A font family cannot be empty."],
    ["fontWeight", 700, null],
    ["fontWeight", "bold", null],
    ["fontWeight", 1001, "A font weight is a number from 1 to 1000, or normal, bold, lighter or bolder."],
    ["fontWeight", "heavy", "A font weight is a number from 1 to 1000, or normal, bold, lighter or bolder."],
    ["shadow", "0 2px 8px rgba(0, 0, 0, 0.2)", null],
    ["shadow", "none", "none is not a shadow. Use CSS box-shadow, like 0 2px 8px rgba(0, 0, 0, 0.2)."],
    ["duration", "200ms", null],
    ["duration", "0.2s", null],
    ["duration", "200", "200 is not a duration. Use ms or s, like 200ms."],
    ["easing", "power2.out", null],
    ["easing", "cubic-bezier(0.1, 0.2, 0.3, 0.4)", null],
    ["easing", "rough", "rough is not an easing. Use a GSAP ease like power2.out, or cubic-bezier(x1, y1, x2, y2)."],
  ] as Array<[Token["type"], string | number, string | null]>)("%s %s", (type, value, expected) => {
    expect(one(literal("v/x", type, value))).toBe(expected);
  });

  it("refuses a token with neither a value nor values, or with both", () => {
    expect(kitRefusal(kit({ tokens: [{ path: "a/b", type: "color" }] }))).toBe("a/b needs one value, or a value for each mode.");
    expect(kitRefusal(kit({ tokens: [{ path: "a/b", type: "color", value: "#fff", values: { light: "#000" } }] }))).toBe(
      "a/b needs one value, or a value for each mode.",
    );
  });

  it("refuses per-mode values for a mode the kit does not have, and a token with no default-mode value", () => {
    expect(kitRefusal(kit({ modes: ["light", "dark"], tokens: [{ path: "a/b", type: "color", values: { light: "#fff", night: "#000" } }] }))).toBe(
      "There is no mode night in the kit.",
    );
    expect(kitRefusal(kit({ modes: ["light", "dark"], tokens: [{ path: "a/b", type: "color", values: { dark: "#000" } }] }))).toBe(
      "a/b needs a value for light, the default mode.",
    );
  });

  it("refuses a description over 200 characters", () => {
    expect(one({ ...literal("a/b", "color", "#fff"), description: "x".repeat(201) })).toBe("A description is at most 200 characters.");
  });

  it("checks each field of a text style, and names a missing one", () => {
    const full = { fontFamily: "Inter", fontSize: "16px", fontWeight: 400, lineHeight: 1.5, letterSpacing: "0px" };
    expect(one(literal("text/body", "textStyle", full))).toBeNull();
    expect(one(literal("text/body", "textStyle", { ...full, fontSize: undefined }))).toBe("text/body needs its fontSize.");
    expect(one(literal("text/body", "textStyle", { ...full, fontFamily: "" }))).toBe("A font family cannot be empty.");
    expect(one(literal("text/body", "textStyle", { ...full, fontSize: "big" }))).toBe("big is not a size. Use a number with px, rem, em or %.");
    expect(one(literal("text/body", "textStyle", { ...full, fontWeight: "heavy" }))).toBe(
      "A font weight is a number from 1 to 1000, or normal, bold, lighter or bolder.",
    );
    expect(one(literal("text/body", "textStyle", { ...full, lineHeight: "1.5x" }))).toBe("1.5x is not a size. Use a number with px, rem, em or %.");
  });
});

describe("aliases", () => {
  const brand = literal("color/brand/primary", "color", "#1a73e8");

  it("accepts an alias of the same type", () => {
    expect(kitRefusal(kit({ tokens: [brand, literal("color/button", "color", "{color/brand/primary}")] }))).toBeNull();
  });

  it("refuses an unknown target and a type mismatch", () => {
    expect(kitRefusal(kit({ tokens: [literal("color/button", "color", "{color/nope}")] }))).toBe("color/button refers to color/nope, which is not in the kit.");
    expect(kitRefusal(kit({ tokens: [brand, literal("size/button", "dimension", "{color/brand/primary}")] }))).toBe(
      "size/button is a dimension and cannot refer to color/brand/primary, a color.",
    );
  });

  it("refuses a cycle, naming the two tokens", () => {
    const a = literal("a/one", "color", "{a/two}");
    const b = literal("a/two", "color", "{a/one}");
    expect(kitRefusal(kit({ tokens: [a, b] }))).toBe("a/one and a/two refer to each other.");
    const loop = [literal("a/one", "color", "{a/two}"), literal("a/two", "color", "{a/three}"), literal("a/three", "color", "{a/one}")];
    expect(kitRefusal(kit({ tokens: loop }))).toBe("a/one and a/two refer to each other.");
  });

  it("checks a text style field's alias against that field's type", () => {
    const size = literal("size/body", "dimension", "16px");
    const font = literal("font/body", "fontFamily", "Inter");
    const style = (fontFamily: string, fontSize: string) =>
      literal("text/body", "textStyle", { fontFamily, fontSize, fontWeight: 400, lineHeight: 1.5, letterSpacing: "0px" });
    expect(kitRefusal(kit({ tokens: [size, font, style("{font/body}", "{size/body}")] }))).toBeNull();
    expect(kitRefusal(kit({ tokens: [size, font, style("{size/body}", "16px")] }))).toBe(
      "text/body is a fontFamily and cannot refer to size/body, a dimension.",
    );
  });

  it("refuses an alias to a token of the same type with a missing value in another mode", () => {
    const k = kit({
      modes: ["light", "dark"],
      tokens: [{ path: "a/one", type: "color", values: { light: "#fff", dark: "#000" } }, literal("a/two", "color", "{a/one}")],
    });
    expect(kitRefusal(k)).toBeNull();
  });
});

describe("valueRefusal", () => {
  it("answers the sentence for one value, or null", () => {
    expect(valueRefusal({ path: "a/b", type: "duration" }, "9", kit())).toBe("9 is not a duration. Use ms or s, like 200ms.");
    expect(valueRefusal({ path: "a/b", type: "duration" }, "9ms", kit())).toBeNull();
  });
});
