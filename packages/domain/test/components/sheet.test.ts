import { describe, expect, it } from "vitest";
import { readComponentSheet } from "../../src/index.ts";

const declaration = (json: string, extra = "") => `<!doctype html><html><head>
<script type="application/json" data-uf-component>${json}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
${extra}
</head><body>
<div data-uf-template hidden><button data-uf-prop="label">Buy</button><img data-uf-prop="icon" src="a.png"><slot></slot><slot name="end"></slot></div>
</body></html>`;

const GOOD = `{"tag":"uf-button","variants":{"kind":["primary","secondary"],"size":["md","sm"]},"props":{"label":"text","disabled":"boolean","icon":"image"},"slots":["","end"]}`;

const refusal = (html: string): string => {
  const read = readComponentSheet(html);
  if (read.ok) throw new Error("expected a refusal");
  return read.refusal;
};

describe("readComponentSheet", () => {
  it("reads the declaration, style, template and examples", () => {
    const html = `<!doctype html><html><head>
<script type="application/json" data-uf-component>${GOOD}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { color: red; }</style>
</head><body>
<div data-uf-template hidden><button data-uf-prop="label">Buy <span>now</span></button><img data-uf-prop="icon" src="a.png"><slot></slot><slot name="end"></slot></div>
<div data-uf-example hidden>Example text</div>
</body></html>`;
    const read = readComponentSheet(html);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.sheet.declaration).toEqual({
      tag: "uf-button",
      variants: { kind: ["primary", "secondary"], size: ["md", "sm"] },
      props: { label: "text", disabled: "boolean", icon: "image" },
      slots: ["", "end"],
    });
    expect(read.sheet.style).toBe(":host { color: red; }");
    expect(read.sheet.template).toBe(
      '<button data-uf-prop="label">Buy <span>now</span></button><img data-uf-prop="icon" src="a.png"><slot></slot><slot name="end"></slot>',
    );
    expect(read.sheet.examples).toBe("Example text");
  });

  it("returns empty examples when the sheet has none", () => {
    const read = readComponentSheet(declaration(`{"tag":"uf-chip","variants":{},"props":{},"slots":[]}`));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.sheet.examples).toBe("");
  });

  it("ignores markers inside comments", () => {
    const html = declaration(GOOD).replace("<head>", "<head><!-- <script type=\"application/json\" data-uf-component>{}</script> -->");
    expect(readComponentSheet(html).ok).toBe(true);
  });

  const cases: Array<[string, string, RegExp | string]> = [
    ["no declaration", `<!doctype html><html><head><style type="text/x-uf-component" data-uf-component-style>a{}</style></head><body><div data-uf-template hidden><p></p></div></body></html>`, "a component sheet needs one <script type=\"application/json\" data-uf-component> declaration"],
    ["two declarations", declaration(GOOD, `<script type="application/json" data-uf-component>${GOOD}</script>`), "a component sheet needs one <script type=\"application/json\" data-uf-component> declaration"],
    ["invalid JSON", declaration(`{"tag":`), /^the component declaration is not valid JSON: /],
    ["bad tag", declaration(GOOD.replace("uf-button", "button")), "the tag button is not a component tag; use uf- and lowercase words joined by hyphens, like uf-price-card"],
    ["tag with capitals", declaration(GOOD.replace("uf-button", "uf-Button")), "the tag uf-Button is not a component tag; use uf- and lowercase words joined by hyphens, like uf-price-card"],
    ["tag too long", declaration(GOOD.replace("uf-button", `uf-${"a".repeat(48)}`)), `the tag uf-${"a".repeat(48)} is not a component tag; use uf- and lowercase words joined by hyphens, like uf-price-card`],
    ["bad variant name", declaration(GOOD.replace('"kind"', '"Kind"')), "Kind: a variant or property name is lowercase letters, digits and hyphens, and is not id, class, style, slot, part, hidden, is, tabindex, or a data- or aria- name"],
    ["reserved variant name", declaration(GOOD.replace('"kind"', '"class"')), "class: a variant or property name is lowercase letters, digits and hyphens, and is not id, class, style, slot, part, hidden, is, tabindex, or a data- or aria- name"],
    ["data- prop name", declaration(GOOD.replace('"disabled"', '"data-x"')), "data-x: a variant or property name is lowercase letters, digits and hyphens, and is not id, class, style, slot, part, hidden, is, tabindex, or a data- or aria- name"],
    ["name in both lists", declaration(GOOD.replace('"label"', '"kind"')), "kind is both a variant and a property"],
    ["empty variant", declaration(GOOD.replace('["md","sm"]', "[]")), "variants.size: a variant is a list of 1 to 12 distinct values made of letters, digits, hyphens and underscores"],
    ["duplicate variant value", declaration(GOOD.replace('["md","sm"]', '["md","md"]')), "variants.size: a variant is a list of 1 to 12 distinct values made of letters, digits, hyphens and underscores"],
    ["variant value with a space", declaration(GOOD.replace('"sm"', '"s m"')), "variants.size: a variant is a list of 1 to 12 distinct values made of letters, digits, hyphens and underscores"],
    ["bad property type", declaration(GOOD.replace('"text"', '"number"')), 'props.label: a property is "text", "boolean" or "image"'],
    ["too many variants", declaration(`{"tag":"uf-x","variants":{"a":["1"],"b":["1"],"c":["1"],"d":["1"],"e":["1"]},"props":{},"slots":[]}`), "a component has at most 4 variants, 16 properties and 8 slots"],
    ["no style", declaration(GOOD).replace(/<style[\s\S]*?<\/style>/, ""), "a component sheet needs one <style type=\"text/x-uf-component\" data-uf-component-style>"],
    ["two styles", declaration(GOOD, `<style type="text/x-uf-component" data-uf-component-style>a{}</style>`), "a component sheet needs one <style type=\"text/x-uf-component\" data-uf-component-style>"],
    ["no template", declaration(GOOD).replace(/<div data-uf-template[\s\S]*?<\/div>/, ""), "a component sheet needs one <div data-uf-template hidden> holding its markup"],
    ["unbound property", declaration(GOOD).replace('data-uf-prop="label"', ""), 'props.label: no element in the template has data-uf-prop="label"'],
    ["missing named slot", declaration(GOOD).replace('<slot name="end"></slot>', ""), 'slots: the template has no <slot name="end">'],
    ["missing default slot", declaration(GOOD).replace("<slot></slot>", ""), "slots: the template has no <slot>"],
    ["script in template", declaration(GOOD).replace("<slot></slot>", "<script>x()</script><slot></slot>"), "a component's template cannot hold a script; put behaviour in the page that uses it"],
    ["nested component", declaration(GOOD).replace("<slot></slot>", "<uf-icon></uf-icon><slot></slot>"), "a component cannot hold another component yet; give it a slot and put uf-icon in that slot in the page instead"],
  ];

  it.each(cases)("refuses: %s", (_name, html, expected) => {
    const message = refusal(html);
    if (typeof expected === "string") expect(message).toBe(expected);
    else expect(message).toMatch(expected);
  });

  it("reports the first refusal in order", () => {
    const html = declaration(GOOD.replace("uf-button", "button")).replace(/<div data-uf-template[\s\S]*?<\/div>/, "");
    expect(refusal(html)).toMatch(/^the tag button is not a component tag/);
  });

  it("refuses a missing declaration before a missing template", () => {
    expect(refusal(`<html><head></head><body></body></html>`)).toBe(
      "a component sheet needs one <script type=\"application/json\" data-uf-component> declaration",
    );
  });
});
