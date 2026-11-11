import { describe, expect, it } from "vitest";
import { fromCss, fromDtcg, toCss, toDtcg, toTailwind } from "../../src/kits/formats.ts";
import { kitCss } from "../../src/kits/runtime.ts";
import type { Kit, Token } from "../../src/kits/types.ts";

const file = (name: string, json: unknown) => ({ name, text: JSON.stringify(json) });
const tokensOf = (result: ReturnType<typeof fromDtcg>) => {
  if (!result.ok) throw new Error(result.refusal);
  return result.fragment;
};
const byPath = (tokens: Token[]) => Object.fromEntries(tokens.map((t) => [t.path, t]));

describe("DTCG import", () => {
  it("reads groups, inherited types and each token's value and description", () => {
    const fragment = tokensOf(
      fromDtcg([
        file("tokens.json", {
          color: { $type: "color", brand: { primary: { $value: "#1a73e8", $description: "Main" } } },
          space: { $type: "dimension", gap: { $value: { value: 8, unit: "px" } }, wide: { $value: "1.5rem" } },
        }),
      ]),
    );
    expect(fragment.modes).toEqual(["default"]);
    expect(byPath(fragment.tokens)).toEqual({
      "color/brand/primary": { path: "color/brand/primary", type: "color", value: "#1a73e8", description: "Main" },
      "space/gap": { path: "space/gap", type: "dimension", value: "8px" },
      "space/wide": { path: "space/wide", type: "dimension", value: "1.5rem" },
    });
    expect(fragment.skipped).toBe(0);
  });

  it("reads a number as px only under space, size or radius, and skips it elsewhere", () => {
    const fragment = tokensOf(fromDtcg([file("t.json", { space: { $type: "number", four: { $value: 4 } }, opacity: { $type: "number", half: { $value: 0.5 } } })]));
    expect(byPath(fragment.tokens)["space/four"]!.value).toBe("4px");
    expect(byPath(fragment.tokens)["opacity/half"]).toBeUndefined();
    expect(fragment.skipped).toBe(1);
  });

  it("reads durations, font families, weights, cubic beziers, shadows and typography", () => {
    const fragment = tokensOf(
      fromDtcg([
        file("t.json", {
          motion: { $type: "duration", fast: { $value: { value: 200, unit: "ms" } }, slow: { $value: "0.5s" } },
          font: {
            $type: "fontFamily",
            body: { $value: ["Inter", "sans-serif"] },
            heading: { $value: "Playfair Display, serif" },
          },
          weight: { $type: "fontWeight", bold: { $value: 700 } },
          ease: { $type: "cubicBezier", out: { $value: [0.33, 1, 0.68, 1] }, named: { $value: [0, 0, 1, 1], $extensions: { "org.unframed": { ease: "power2.out" } } } },
          shadow: { $type: "shadow", card: { $value: "0 2px 8px rgba(0, 0, 0, 0.2)" } },
          text: {
            $type: "typography",
            h1: { $value: { fontFamily: "{font.heading}", fontSize: { value: 32, unit: "px" }, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.5px" } },
          },
        }),
      ]),
    );
    const tokens = byPath(fragment.tokens);
    expect(tokens["motion/fast"]).toMatchObject({ type: "duration", value: "200ms" });
    expect(tokens["motion/slow"]).toMatchObject({ type: "duration", value: "0.5s" });
    expect(tokens["font/body"]).toMatchObject({ type: "fontFamily", value: "Inter, sans-serif" });
    expect(tokens["font/heading"]).toMatchObject({ type: "fontFamily", value: "Playfair Display, serif" });
    expect(tokens["weight/bold"]).toMatchObject({ type: "fontWeight", value: 700 });
    expect(tokens["ease/out"]).toMatchObject({ type: "easing", value: "cubic-bezier(0.33, 1, 0.68, 1)" });
    expect(tokens["ease/named"]).toMatchObject({ type: "easing", value: "power2.out" });
    expect(tokens["shadow/card"]).toMatchObject({ type: "shadow", value: "0 2px 8px rgba(0, 0, 0, 0.2)" });
    expect(tokens["text/h1"]).toMatchObject({
      type: "textStyle",
      value: { fontFamily: "{font/heading}", fontSize: "32px", fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.5px" },
    });
    expect(fragment.skipped).toBe(0);
  });

  it("turns a reference {group.token} into an alias {group/token}", () => {
    const fragment = tokensOf(fromDtcg([file("t.json", { color: { $type: "color", brand: { $value: "#1a73e8" }, button: { $value: "{color.brand}" } } })]));
    expect(byPath(fragment.tokens)["color/button"]!.value).toBe("{color/brand}");
  });

  it("names a path's segments in lower case, camel case lowered with dashes, and splits dots", () => {
    const fragment = tokensOf(fromDtcg([file("t.json", { brandPrimary: { $type: "color", "Main Shade": { $value: "#111" } } })]));
    expect(fragment.tokens.map((t) => t.path)).toEqual(["brand-primary/main-shade"]);
  });

  it("takes the modes from the unframed extension, and a file name as a mode otherwise", () => {
    const withModes = tokensOf(
      fromDtcg([
        file("t.json", {
          $extensions: { "org.unframed": { modes: ["light", "dark"], name: "Brand" } },
          color: { $type: "color", a: { $value: "#fff", $extensions: { "org.unframed": { modes: { dark: "#000" } } } } },
        }),
      ]),
    );
    expect(withModes.modes).toEqual(["light", "dark"]);
    expect(withModes.name).toBe("Brand");
    expect(byPath(withModes.tokens)["color/a"]).toEqual({ path: "color/a", type: "color", values: { light: "#fff", dark: "#000" } });

    const byFile = tokensOf(
      fromDtcg([file("light.tokens.json", { color: { $type: "color", a: { $value: "#fff" } } }), file("dark.tokens.json", { color: { $type: "color", a: { $value: "#000" } } })]),
    );
    expect(byFile.modes).toEqual(["light", "dark"]);
    expect(byPath(byFile.tokens)["color/a"]).toEqual({ path: "color/a", type: "color", values: { light: "#fff", dark: "#000" } });
  });

  it("counts a token it cannot read and skips it, with the others kept", () => {
    const fragment = tokensOf(
      fromDtcg([file("t.json", { color: { $type: "color", good: { $value: "#fff" }, bad: { $value: "not a colour" }, unknown: { $type: "gradient", $value: "x" } } })]),
    );
    expect(fragment.tokens.map((t) => t.path)).toEqual(["color/good"]);
    expect(fragment.skipped).toBe(2);
  });

  it("refuses a file that is not JSON", () => {
    const result = fromDtcg([{ name: "t.json", text: "{nope" }]);
    expect(result.ok).toBe(false);
  });
});

describe("a file's values meet the same rules as a typed one", () => {
  it("skips a DTCG font family that would write CSS, and keeps the others", () => {
    const fragment = tokensOf(
      fromDtcg([file("t.json", { font: { $type: "fontFamily", body: { $value: "Inter; } body { display:none } .x {" }, ok: { $value: "Inter, sans-serif" } } })]),
    );
    expect(fragment.tokens.map((token) => token.path)).toEqual(["font/ok"]);
    expect(fragment.skipped).toBe(1);
  });

  it("writes a description into no CSS, so one that closes a comment cannot break the export", () => {
    const base: Kit = { format: 1, name: "Brand", modes: ["light"], tokens: [{ path: "color/a", type: "color", value: "#fff" }] };
    const described: Kit = { ...base, tokens: [{ ...base.tokens[0]!, description: "x */ body { display:none } /*" }] };
    expect(toCss(described)).toBe(toCss(base));
    expect(toTailwind(described)).not.toContain("display:none");
    expect(toTailwind(described).match(/\*\//g)).toHaveLength(1);
  });
});

describe("CSS import", () => {
  it("reads :root as the default mode, and the custom properties' types from their values", () => {
    const fragment = tokensOf(
      fromCss(
        ":root {\n  --color-brand-primary: #1a73e8;\n  --space-gap: 8px;\n  --motion-fast: 200ms;\n  --ease-out: cubic-bezier(0.33, 1, 0.68, 1);\n  --font-body: 'Inter', sans-serif;\n  --font-weight-bold: 700;\n  --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.2);\n  --color-button: var(--color-brand-primary);\n}",
      ),
    );
    expect(fragment.modes).toEqual(["default"]);
    expect(byPath(fragment.tokens)).toEqual({
      "color/brand/primary": { path: "color/brand/primary", type: "color", value: "#1a73e8" },
      "space/gap": { path: "space/gap", type: "dimension", value: "8px" },
      "motion/fast": { path: "motion/fast", type: "duration", value: "200ms" },
      "ease/out": { path: "ease/out", type: "easing", value: "cubic-bezier(0.33, 1, 0.68, 1)" },
      "font/body": { path: "font/body", type: "fontFamily", value: "'Inter', sans-serif" },
      "font/weight/bold": { path: "font/weight/bold", type: "fontWeight", value: 700 },
      "shadow/card": { path: "shadow/card", type: "shadow", value: "0 2px 8px rgba(0, 0, 0, 0.2)" },
      "color/button": { path: "color/button", type: "color", value: "{color/brand/primary}" },
    });
    expect(fragment.skipped).toBe(0);
  });

  it("reads each theme block as its mode", () => {
    const fragment = tokensOf(
      fromCss(
        ':root { --color-bg: #fff; }\n[data-theme="dark"] { --color-bg: #000; }\n.contrast { --color-bg: #111; }\n.theme-sepia { --color-bg: #f4ecd8; }\n:root.night { --color-bg: #050505; }',
      ),
    );
    expect(fragment.modes).toEqual(["default", "dark", "contrast", "sepia", "night"]);
    expect(byPath(fragment.tokens)["color/bg"]).toEqual({
      path: "color/bg",
      type: "color",
      values: { default: "#fff", dark: "#000", contrast: "#111", sepia: "#f4ecd8", night: "#050505" },
    });
  });

  it("reads a prefers-color-scheme dark block around :root as the dark mode", () => {
    const fragment = tokensOf(fromCss(':root { --color-bg: #fff; }\n@media (prefers-color-scheme: dark) { :root { --color-bg: #0a0a0a; } }'));
    expect(fragment.modes).toEqual(["default", "dark"]);
    expect(byPath(fragment.tokens)["color/bg"]).toEqual({ path: "color/bg", type: "color", values: { default: "#fff", dark: "#0a0a0a" } });
  });

  it("counts a declaration it cannot type, and one outside the blocks", () => {
    const fragment = tokensOf(fromCss(":root { --color-a: #fff; --thing: whatever; color: red; }\n.card h1 { --color-b: #000; }"));
    expect(fragment.tokens.map((t) => t.path)).toEqual(["color/a"]);
    expect(fragment.skipped).toBe(3);
  });

  it("reads a name's last segments as path segments, splitting every dash", () => {
    const fragment = tokensOf(fromCss(":root { --color-brand-primary-dark: #000; }"));
    expect(fragment.tokens[0]!.path).toBe("color/brand/primary/dark");
  });
});

describe("the round trips", () => {
  const kit: Kit = {
    format: 1,
    name: "Brand",
    modes: ["light", "dark"],
    tokens: [
      { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" }, description: "Main" },
      { path: "color/button/background", type: "color", value: "{color/brand/primary}" },
      { path: "space/gap", type: "dimension", value: "8px" },
      { path: "motion/fast", type: "duration", value: "200ms" },
      { path: "ease/out", type: "easing", value: "power2.out" },
      { path: "ease/custom", type: "easing", value: "cubic-bezier(0.1, 0.2, 0.3, 0.4)" },
      { path: "weight/bold", type: "fontWeight", value: 700 },
      { path: "font/body", type: "fontFamily", value: "Inter, sans-serif" },
      { path: "shadow/card", type: "shadow", value: "0 2px 8px rgba(0, 0, 0, 0.2)" },
      { path: "text/h1", type: "textStyle", value: { fontFamily: "{font/body}", fontSize: "32px", fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.5px" } },
    ],
  };

  it("keeps every token, mode, value and description through DTCG", () => {
    const back = tokensOf(fromDtcg([{ name: "kit.tokens.json", text: toDtcg(kit) }]));
    expect(back.modes).toEqual(["light", "dark"]);
    expect(byPath(back.tokens)).toEqual(byPath(kit.tokens));
  });

  it("writes the CSS exactly as the tokens script does, and reads it back", () => {
    expect(toCss(kit)).toBe(kitCss(kit));
    const back = tokensOf(fromCss(toCss(kit)));
    expect(byPath(back.tokens)["color/brand/primary"]).toEqual({ path: "color/brand/primary", type: "color", values: { default: "#1a73e8", dark: "#8ab4f8" } });
  });

  it("writes Tailwind's @theme for the default mode, and the other modes as theme blocks", () => {
    const css = toTailwind(kit);
    expect(css).toContain("@theme {");
    expect(css).toContain("  --color-brand-primary: #1a73e8;");
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain("  --color-brand-primary: #8ab4f8;");
    expect(css.startsWith("/*")).toBe(true);
  });
});
