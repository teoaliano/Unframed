import { describe, expect, it } from "vitest";
import { offTokenValues } from "../../src/kits/offTokens.ts";
import type { Kit } from "../../src/kits/types.ts";

const kit: Kit = {
  format: 1,
  name: "Brand",
  modes: ["light"],
  tokens: [
    { path: "color/brand/primary", type: "color", value: "#1a73e8" },
    { path: "color/brand/ink", type: "color", value: "#202124" },
    { path: "space/md", type: "dimension", value: "16px" },
    { path: "radius/card", type: "dimension", value: "12px" },
    { path: "size/heading", type: "dimension", value: "32px" },
    { path: "weight/regular", type: "fontWeight", value: 400 },
    { path: "weight/bold", type: "fontWeight", value: 700 },
    { path: "font/body", type: "fontFamily", value: "Inter, sans-serif" },
    { path: "shadow/card", type: "shadow", value: "0 2px 8px rgba(0, 0, 0, 0.2)" },
    { path: "motion/fast", type: "duration", value: "200ms" },
    { path: "ease/out", type: "easing", value: "power2.out" },
    {
      path: "text/body",
      type: "textStyle",
      value: { fontFamily: "Inter", fontSize: "16px", fontWeight: 400, lineHeight: 1.5, letterSpacing: "0px" },
    },
  ],
};

const scan = (html: string, k: Kit = kit) => offTokenValues(html, k);
const only = (html: string) => {
  const found = scan(html);
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("colours", () => {
  it("flags a literal equal to a token as exact, with its rule place", () => {
    const item = only("<style>.hero { color: #1a73e8; }</style>");
    expect(item).toMatchObject({ property: "color", value: "#1a73e8", path: "color/brand/primary", css: "--color-brand-primary", exact: true, place: { rule: { block: 0, selector: ".hero", occurrence: 0 } } });
  });

  it("flags a close colour as near, and an equal one written as rgb() as exact", () => {
    expect(only("<style>.a { color: #1b74e9; }</style>").exact).toBe(false);
    expect(only("<style>.a { color: rgb(26, 115, 232); }</style>").exact).toBe(true);
  });

  it("flags a colour far from every token by nothing", () => {
    expect(scan("<style>.a { color: #ff00ff; }</style>")).toEqual([]);
  });

  it("chooses the nearest token, and an exact one over a near one", () => {
    const near = only("<style>.a { color: #1b74e9; }</style>");
    expect(near.path).toBe("color/brand/primary");
    expect(only("<style>.a { color: #202124; }</style>").path).toBe("color/brand/ink");
  });

  it("flags colours in any property, including custom properties that are not kit names", () => {
    expect(only("<style>.a { --accent: #1a73e8; }</style>").property).toBe("--accent");
  });

  it("does not flag a fully transparent colour, nor a kit CSS name the author redefines", () => {
    expect(scan("<style>.a { color: transparent; background: rgba(26, 115, 232, 0); }</style>")).toEqual([]);
    expect(scan("<style>:root { --color-brand-primary: #1a73e8; }</style>")).toEqual([]);
  });
});

describe("lengths", () => {
  it("flags spacing close to a spacing token: within 2 px and 12.5 %", () => {
    expect(only("<style>.a { padding: 14px; }</style>")).toMatchObject({ path: "space/md", exact: false });
    expect(scan("<style>.a { padding: 20px; }</style>")).toEqual([]);
  });

  it("flags an exact spacing value, reading rem at 16 px", () => {
    expect(only("<style>.a { margin: 1rem; }</style>")).toMatchObject({ path: "space/md", exact: true });
  });

  it("matches border radius against radius tokens and font sizes against dimensions and text style fields", () => {
    expect(only("<style>.a { border-radius: 12px; }</style>").path).toBe("radius/card");
    expect(only("<style>.a { font-size: 32px; }</style>")).toMatchObject({ path: "size/heading", exact: true });
    expect(only("<style>.a { font-size: 16px; }</style>")).toMatchObject({ path: "text/body", css: "--text-body-font-size", exact: true });
  });

  it("never flags 0, 1 px or less, negative lengths, auto, or a length in a property not listed", () => {
    expect(scan("<style>.a { padding: 0; margin: 1px; gap: -16px; margin-top: auto; width: 16px; }</style>")).toEqual([]);
  });
});

describe("weights, families, shadows, times and easings", () => {
  it("flags a weight equal after normal = 400 and bold = 700", () => {
    expect(only("<style>.a { font-weight: normal; }</style>")).toMatchObject({ path: "weight/regular", exact: true });
    expect(only("<style>.a { font-weight: bold; }</style>")).toMatchObject({ path: "weight/bold", exact: true });
  });

  it("flags a family whose first name matches, ignoring case and quotes", () => {
    expect(only("<style>.a { font-family: 'inter', serif; }</style>")).toMatchObject({ path: "font/body", exact: true });
  });

  it("flags a shadow equal after its spacing and zero units are normalised", () => {
    expect(only("<style>.a { box-shadow: 0px 2px 8px rgba(0,0,0,0.2); }</style>")).toMatchObject({ path: "shadow/card", exact: true });
  });

  it("flags a time in transition or animation: equal, or within 20 ms or 10 %", () => {
    expect(only("<style>.a { transition: opacity 200ms ease; }</style>")).toMatchObject({ path: "motion/fast", exact: true });
    expect(only("<style>.a { transition-duration: 215ms; }</style>")).toMatchObject({ path: "motion/fast", exact: false });
    expect(scan("<style>.a { animation: spin 0.25s linear; }</style>")).toEqual([]);
  });

  it("flags a cubic bezier in a transition whose coordinates are within 0.01 of an easing's", () => {
    expect(only("<style>.a { transition-timing-function: cubic-bezier(0.33, 1, 0.68, 1); }</style>")).toMatchObject({ path: "ease/out", exact: true });
  });
});

describe("where it looks", () => {
  it("reads inline style attributes and SVG fill, stroke and stop-color, by element id", () => {
    const found = scan('<h1 data-hf-id="h1" style="font-size: 32px">x</h1><svg><path data-hf-id="p1" fill="#1a73e8" /></svg>');
    expect(found.map((item) => [item.place, item.property])).toEqual([
      [{ elementId: "h1" }, "font-size"],
      [{ elementId: "p1" }, "fill"],
    ]);
  });

  it("leaves out an inline value on an element without an id, since no edit can name it", () => {
    expect(scan('<p style="color: #1a73e8">x</p>')).toEqual([]);
  });

  it("does not read comments or script text", () => {
    expect(scan("<style>/* .a { color: #1a73e8; } */</style><script>el.style.color = '#1a73e8';</script>")).toEqual([]);
  });

  it("does not read a literal inside var(), its fallback included", () => {
    expect(scan("<style>.a { color: var(--brand, #1a73e8); }</style>")).toEqual([]);
  });

  it("counts each block in document order, and each occurrence of a selector within it", () => {
    const found = scan("<style>.a { color: #111; }</style><div></div><style>.b {color: red}\n.a { color: #1a73e8; }\n.a { color: #1a73e8; }</style>");
    expect(found.map((item) => item.place)).toEqual([
      { rule: { block: 1, selector: ".a", occurrence: 0 } },
      { rule: { block: 1, selector: ".a", occurrence: 1 } },
    ]);
  });

  it("answers nothing for a kit with no tokens", () => {
    expect(offTokenValues("<style>.a { color: #1a73e8 }</style>", { ...kit, tokens: [] })).toEqual([]);
  });
});
