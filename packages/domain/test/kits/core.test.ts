import { describe, expect, it } from "vitest";
import { kitCore } from "../../src/kits/core.ts";
import { EASE_CSS } from "../../src/kits/easings.ts";
import type { Kit } from "../../src/kits/types.ts";
import { kitRuntime } from "../../src/kits/runtime.ts";

const kit = (over: Partial<Kit> = {}): Kit => ({ format: 1, name: "Brand", modes: ["light", "dark"], tokens: [], ...over });
const { resolve, kitCss, scriptValue, cssName } = kitRuntime;

describe("CSS names", () => {
  it("joins the segments with dashes under a double dash", () => {
    expect(cssName("color/brand/primary")).toBe("--color-brand-primary");
    expect(cssName("space/4")).toBe("--space-4");
  });
});

describe("aliases and resolve", () => {
  const base = kit({
    tokens: [
      { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
      { path: "color/button/background", type: "color", value: "{color/brand/primary}" },
      { path: "color/alias/chain", type: "color", value: "{color/button/background}" },
    ],
  });

  it("follows a chain of aliases, in the mode asked for", () => {
    expect(resolve(base, "color/alias/chain", "light")).toBe("#1a73e8");
    expect(resolve(base, "color/alias/chain", "dark")).toBe("#8ab4f8");
  });

  it("falls back to the default mode's value for a mode a token leaves out", () => {
    const k = kit({
      tokens: [{ path: "space/gap", type: "dimension", values: { light: "8px" } }],
    });
    expect(resolve(k, "space/gap", "dark")).toBe("8px");
  });

  it("uses the default mode when the mode is not in the kit", () => {
    expect(resolve(base, "color/brand/primary", "nope")).toBe("#1a73e8");
  });

  it("answers undefined for an unknown path, an unknown target and a cycle", () => {
    expect(resolve(base, "missing", "light")).toBeUndefined();
    const broken = kit({ tokens: [{ path: "a/b", type: "color", value: "{x/y}" }] });
    expect(resolve(broken, "a/b", "light")).toBeUndefined();
    const cycle = kit({
      tokens: [
        { path: "a/one", type: "color", value: "{a/two}" },
        { path: "a/two", type: "color", value: "{a/one}" },
      ],
    });
    expect(resolve(cycle, "a/one", "light")).toBeUndefined();
  });

  it("resolves each field of a text style that aliases another token", () => {
    const k = kit({
      tokens: [
        { path: "size/body", type: "dimension", value: "16px" },
        { path: "font/heading", type: "fontFamily", value: "Inter, sans-serif" },
        {
          path: "text/body",
          type: "textStyle",
          value: { fontFamily: "{font/heading}", fontSize: "{size/body}", fontWeight: 400, lineHeight: 1.5, letterSpacing: "0px" },
        },
      ],
    });
    expect(resolve(k, "text/body", "light")).toEqual({ fontFamily: "Inter, sans-serif", fontSize: "16px", fontWeight: 400, lineHeight: 1.5, letterSpacing: "0px" });
  });
});

describe("the CSS output", () => {
  it("writes the default mode on :root and only differing values in each other mode", () => {
    const k = kit({
      tokens: [
        { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
        { path: "space/gap", type: "dimension", value: "8px" },
      ],
    });
    expect(kitCss(k)).toBe(
      [
        ":root {",
        "  --color-brand-primary: #1a73e8;",
        "  --space-gap: 8px;",
        "}",
        '[data-theme="dark"] {',
        "  --color-brand-primary: #8ab4f8;",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("writes an alias as var() of the target, and a former name as var() of the new name", () => {
    const k = kit({
      tokens: [
        { path: "color/brand/primary", type: "color", value: "#1a73e8", formerNames: ["--color-brand"] },
        { path: "color/button/background", type: "color", value: "{color/brand/primary}" },
      ],
    });
    const css = kitCss(k);
    expect(css).toContain("  --color-button-background: var(--color-brand-primary);");
    expect(css).toContain("  --color-brand: var(--color-brand-primary);");
  });

  it("writes the five longhands of a text style, its fields aliasing as var()", () => {
    const k = kit({
      modes: ["light"],
      tokens: [
        { path: "size/body", type: "dimension", value: "16px" },
        {
          path: "text/body",
          type: "textStyle",
          value: { fontFamily: "Inter", fontSize: "{size/body}", fontWeight: 400, lineHeight: 1.5, letterSpacing: "0px" },
        },
      ],
    });
    expect(kitCss(k)).toBe(
      [
        ":root {",
        "  --size-body: 16px;",
        "  --text-body-font-family: Inter;",
        "  --text-body-font-size: var(--size-body);",
        "  --text-body-font-weight: 400;",
        "  --text-body-line-height: 1.5;",
        "  --text-body-letter-spacing: 0px;",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("writes an easing as its CSS form and a cubic bezier as written", () => {
    const k = kit({
      modes: ["light"],
      tokens: [
        { path: "ease/out", type: "easing", value: "power2.out" },
        { path: "ease/custom", type: "easing", value: "cubic-bezier(0.1, 0.2, 0.3, 0.4)" },
      ],
    });
    const css = kitCss(k);
    expect(css).toContain(`  --ease-out: ${EASE_CSS["power2.out"]};`);
    expect(css).toContain("  --ease-custom: cubic-bezier(0.1, 0.2, 0.3, 0.4);");
  });

  it("writes an empty kit as an empty :root", () => {
    expect(kitCss(kit({ modes: ["light"] }))).toBe(":root {\n}\n");
  });
});

describe("unframed.token values", () => {
  const k = kit({
    tokens: [
      { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
      { path: "color/button/background", type: "color", value: "{color/brand/primary}" },
      { path: "duration/fast", type: "duration", value: "200ms" },
      { path: "duration/slow", type: "duration", value: "0.5s" },
      { path: "weight/bold", type: "fontWeight", value: 700 },
      { path: "weight/keyword", type: "fontWeight", value: "bold" },
      { path: "ease/out", type: "easing", value: "power2.out" },
      { path: "ease/custom", type: "easing", value: "cubic-bezier(0.5, 0, 0.5, 1)" },
      { path: "dimension/gap", type: "dimension", value: "16px" },
      { path: "shadow/card", type: "shadow", value: "0 2px 8px rgba(0,0,0,0.2)" },
      { path: "font/body", type: "fontFamily", value: "Inter, sans-serif" },
    ],
  });

  it("returns the current mode's value with aliases followed, in the form each type takes", () => {
    expect(scriptValue(k, "color/button/background", "dark")).toBe("#8ab4f8");
    expect(scriptValue(k, "duration/fast", "light")).toBeCloseTo(0.2);
    expect(scriptValue(k, "duration/slow", "light")).toBeCloseTo(0.5);
    expect(scriptValue(k, "weight/bold", "light")).toBe(700);
    expect(scriptValue(k, "weight/keyword", "light")).toBe("bold");
    expect(scriptValue(k, "ease/out", "light")).toBe("power2.out");
    expect(scriptValue(k, "dimension/gap", "light")).toBe("16px");
    expect(scriptValue(k, "shadow/card", "light")).toBe("0 2px 8px rgba(0,0,0,0.2)");
    expect(scriptValue(k, "font/body", "light")).toBe("Inter, sans-serif");
  });

  it("returns a function of progress for a cubic bezier easing", () => {
    const fn = scriptValue(k, "ease/custom", "light") as (p: number) => number;
    expect(typeof fn).toBe("function");
    expect(fn(0)).toBe(0);
    expect(fn(1)).toBe(1);
    expect(fn(0.5)).toBeCloseTo(0.5, 2);
  });

  it("returns undefined for an unknown token, by path or by CSS name", () => {
    expect(scriptValue(k, "nope", "light")).toBeUndefined();
    expect(scriptValue(k, "--color-brand-primary", "dark")).toBe("#8ab4f8");
  });

  it("returns a text style as an object with its five fields resolved", () => {
    const withStyle = kit({
      tokens: [
        { path: "font/heading", type: "fontFamily", value: "Inter" },
        { path: "text/h1", type: "textStyle", value: { fontFamily: "{font/heading}", fontSize: "32px", fontWeight: "bold", lineHeight: 1.2, letterSpacing: "-0.5px" } },
      ],
    });
    expect(scriptValue(withStyle, "text/h1", "light")).toEqual({ fontFamily: "Inter", fontSize: "32px", fontWeight: "bold", lineHeight: 1.2, letterSpacing: "-0.5px" });
  });
});

describe("the core is self-contained", () => {
  it("builds the same output when its source text is run alone", () => {
    const source = `(${kitCore.toString()})`;
    const built = new Function(`return ${source}`)()(EASE_CSS) as typeof kitRuntime;
    const k = kit({ tokens: [{ path: "color/brand/primary", type: "color", value: "#1a73e8" }] });
    expect(built.kitCss(k)).toBe(kitCss(k));
  });
});
