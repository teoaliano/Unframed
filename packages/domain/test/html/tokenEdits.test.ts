import { describe, expect, it } from "vitest";
import type { SourceEdit } from "@unframed/contracts";
import { applySourceEdits } from "../../src/html/index.ts";
import { styleValueRefusal } from "../../src/designFields.ts";
import type { Kit } from "../../src/kits/index.ts";
import { PAGE } from "./fixture.ts";

const KIT: Kit = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [
    { path: "color/brand/primary", type: "color", value: "#1a73e8" },
    {
      path: "type/body",
      type: "textStyle",
      value: { fontFamily: "Inter, sans-serif", fontSize: "16px", fontWeight: 400, lineHeight: "1.5", letterSpacing: "0px" },
    },
  ],
};

const apply = (edits: SourceEdit[], html = PAGE, kit: Kit | null = KIT) => applySourceEdits(html, edits, "page", kit);

const okHtml = (edits: SourceEdit[], html = PAGE, kit: Kit | null = KIT): string => {
  const result = apply(edits, html, kit);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.html;
};

const refusalOf = (edits: SourceEdit[], html = PAGE, kit: Kit | null = KIT): string => {
  const result = apply(edits, html, kit);
  if (result.ok) throw new Error("expected a refusal");
  return result.refusal;
};

const STYLED = `<!doctype html><html><head><style>.hero h1{color:red}.hero h1{color:blue !important}.x{margin-top:0}</style></head>
<body><div data-hf-id="hf-aaaa"><h1 data-hf-id="hf-bbbb" data-uf-name="Hero title">Hi</h1></div></body></html>`;

describe("token edits on an element", () => {
  it("sets an existing inline declaration to the token's custom property, in place", () => {
    const next = okHtml([{ type: "token", elementId: "hf-aaaa", property: "color", token: "color/brand/primary" }]);
    expect(next).toContain('<div data-hf-id="hf-aaaa" style="color: var(--color-brand-primary); font-size: 12px !important">');
  });

  it("appends a new declaration when the element has none for the property", () => {
    const next = okHtml([{ type: "token", elementId: "hf-aaaa", property: "background-color", token: "color/brand/primary" }]);
    expect(next).toContain('style="color: red; font-size: 12px !important; background-color: var(--color-brand-primary)"');
  });

  it("writes a text style as its five longhands, each to its own custom property", () => {
    const next = okHtml([{ type: "token", elementId: "hf-bbbb", property: "font-size", token: "type/body" }]);
    expect(next).toContain(
      'style="font-family: var(--type-body-font-family); font-size: var(--type-body-font-size); font-weight: var(--type-body-font-weight); line-height: var(--type-body-line-height); letter-spacing: var(--type-body-letter-spacing)"',
    );
  });

  it("summarises the element by its name", () => {
    const result = apply([{ type: "token", elementId: "hf-bbbb", property: "color", token: "color/brand/primary" }], PAGE);
    expect(result.ok && result.summary).toEqual(["Token · Hero title"]);
  });
});

describe("token edits on a style rule", () => {
  it("replaces the value of the rule's declaration and keeps every other byte", () => {
    const next = okHtml(
      [{ type: "token", rule: { block: 0, selector: ".x", occurrence: 0 }, property: "margin-top", token: "color/brand/primary" }],
      STYLED,
    );
    expect(next).toContain(".x{margin-top:var(--color-brand-primary)}");
    expect(next.replace("margin-top:var(--color-brand-primary)", "margin-top:0")).toBe(STYLED);
  });

  it("picks the rule by occurrence among rules with the same selector text, and keeps !important", () => {
    const first = okHtml([{ type: "token", rule: { block: 0, selector: ".hero h1", occurrence: 0 }, property: "color", token: "color/brand/primary" }], STYLED);
    expect(first).toContain(".hero h1{color:var(--color-brand-primary)}.hero h1{color:blue !important}");
    const second = okHtml([{ type: "token", rule: { block: 0, selector: ".hero h1", occurrence: 1 }, property: "color", token: "color/brand/primary" }], STYLED);
    expect(second).toContain(".hero h1{color:red}.hero h1{color:var(--color-brand-primary) !important}");
  });

  it("refuses a rule or declaration that is no longer there", () => {
    expect(refusalOf([{ type: "token", rule: { block: 0, selector: ".gone", occurrence: 0 }, property: "margin-top", token: "color/brand/primary" }], STYLED)).toBe(
      "That style changed. Pick the value again.",
    );
    expect(refusalOf([{ type: "token", rule: { block: 0, selector: ".x", occurrence: 0 }, property: "color", token: "color/brand/primary" }], STYLED)).toBe(
      "That style changed. Pick the value again.",
    );
  });

  it("finds the style element by its index among every style element", () => {
    const html = `<html><head><style>.a{color:red}</style></head><body><style>.b{color:red}</style></body></html>`;
    expect(okHtml([{ type: "token", rule: { block: 1, selector: ".b", occurrence: 0 }, property: "color", token: "color/brand/primary" }], html)).toBe(
      `<html><head><style>.a{color:red}</style></head><body><style>.b{color:var(--color-brand-primary)}</style></body></html>`,
    );
  });

  it("summarises the rule by its selector", () => {
    const result = apply([{ type: "token", rule: { block: 0, selector: ".x", occurrence: 0 }, property: "margin-top", token: "color/brand/primary" }], STYLED);
    expect(result.ok && result.summary).toEqual(["Token · In styles: .x"]);
  });
});

describe("token edit refusals", () => {
  it("needs exactly one of an element and a rule", () => {
    const sentence = "A token goes to one element or one style rule.";
    expect(refusalOf([{ type: "token", property: "color", token: "color/brand/primary" }])).toBe(sentence);
    expect(
      refusalOf([{ type: "token", elementId: "hf-aaaa", rule: { block: 0, selector: ".x", occurrence: 0 }, property: "color", token: "color/brand/primary" }]),
    ).toBe(sentence);
  });

  it("refuses a path the kit does not have, and a project with no kit", () => {
    expect(refusalOf([{ type: "token", elementId: "hf-aaaa", property: "color", token: "color/nope" }])).toBe("There is no token color/nope in the kit.");
    expect(refusalOf([{ type: "token", elementId: "hf-aaaa", property: "color", token: "color/brand/primary" }], PAGE, null)).toBe(
      "There is no token color/brand/primary in the kit.",
    );
  });

  it("refuses an element the source does not have", () => {
    expect(refusalOf([{ type: "token", elementId: "hf-zzzz", property: "color", token: "color/brand/primary" }])).toBe("There is no element hf-zzzz in this page any more.");
  });

  it("refuses a property that is not a design field", () => {
    expect(refusalOf([{ type: "token", elementId: "hf-aaaa", property: "cursor", token: "color/brand/primary" }])).toBe("cursor cannot be edited here.");
  });
});

describe("var() in style values", () => {
  it("accepts a kit custom property, and a fallback that passes the field's rule", () => {
    expect(styleValueRefusal("color", "var(--color-brand-primary)", ["--color-brand-primary"])).toBeNull();
    expect(styleValueRefusal("color", "var(--color-brand-primary, #fff)", ["--color-brand-primary"])).toBeNull();
    expect(styleValueRefusal("color", "var(--color-brand-primary, red;x)", ["--color-brand-primary"])).toBe('Colour cannot be "var(--color-brand-primary, red;x)".');
  });

  it("refuses any var() that is not a kit name, and with no kit names at all", () => {
    expect(styleValueRefusal("color", "var(--other)", ["--color-brand-primary"])).toBe('Colour cannot be "var(--other)".');
    expect(styleValueRefusal("color", "var(--color-brand-primary)")).toBe('Colour cannot be "var(--color-brand-primary)".');
  });

  it("writes a style edit whose value is a kit name, and refuses it with no kit", () => {
    const next = okHtml([{ type: "style", elementId: "hf-aaaa", property: "color", value: "var(--color-brand-primary)" }]);
    expect(next).toContain('style="color: var(--color-brand-primary); font-size: 12px !important"');
    expect(refusalOf([{ type: "style", elementId: "hf-aaaa", property: "color", value: "var(--color-brand-primary)" }], PAGE, null)).toBe(
      'Colour cannot be "var(--color-brand-primary)".',
    );
  });
});
