import { describe, expect, it } from "vitest";
import { applySourceEdits, type InstanceDeclarations } from "../../src/html/sourceEdits.ts";

/** Spec 20, task 27: `applySourceEdits` sets and removes an instance's declared variant and property attributes. */

const PAGE = `<!doctype html><html><head></head><body><uf-button data-hf-id="hf-aaaa" kind="primary" label="Buy"></uf-button><p data-hf-id="hf-bbbb">Plain</p></body></html>`;

const instances: InstanceDeclarations = new Map([
  [
    "uf-button",
    {
      title: "Button",
      declaration: { tag: "uf-button", variants: { kind: ["primary", "secondary"] }, props: { label: "text", disabled: "boolean", icon: "image" }, slots: [] },
    },
  ],
]);

const attribute = (elementId: string, name: string, value: string | null) => ({ type: "attribute" as const, elementId, name, value });

describe("an instance's declared attributes (spec 20)", () => {
  it("sets a variant's value, with the summary line in the instance's name", () => {
    const result = applySourceEdits(PAGE, [attribute("hf-aaaa", "kind", "secondary")], "page", null, instances);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain('<uf-button data-hf-id="hf-aaaa" kind="secondary" label="Buy">');
    expect(result.summary[0]).toMatch(/^Kind · /);
  });

  it("removes the attribute when a variant is set to its default", () => {
    const result = applySourceEdits(PAGE, [attribute("hf-aaaa", "kind", "primary")], "page", null, instances);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.html).toContain('<uf-button data-hf-id="hf-aaaa" label="Buy">');
  });

  it("sets a text property, and removes it with null", () => {
    const set = applySourceEdits(PAGE, [attribute("hf-aaaa", "label", "Buy now")], "page", null, instances);
    expect(set).toMatchObject({ ok: true });
    if (set.ok) expect(set.html).toContain('label="Buy now"');
    const removed = applySourceEdits(PAGE, [attribute("hf-aaaa", "label", null)], "page", null, instances);
    expect(removed).toMatchObject({ ok: true });
    if (removed.ok) expect(removed.html).not.toContain("label=");
  });

  it("sets a boolean property to an empty value, and refuses any other value", () => {
    const on = applySourceEdits(PAGE, [attribute("hf-aaaa", "disabled", "")], "page", null, instances);
    expect(on).toMatchObject({ ok: true });
    if (on.ok) expect(on.html).toContain('disabled=""');
    expect(applySourceEdits(PAGE, [attribute("hf-aaaa", "disabled", "yes")], "page", null, instances).ok).toBe(false);
  });

  it("sets an image property to an image file, and refuses a file that is not an image", () => {
    expect(applySourceEdits(PAGE, [attribute("hf-aaaa", "icon", "logo.png")], "page", null, instances)).toMatchObject({ ok: true });
    expect(applySourceEdits(PAGE, [attribute("hf-aaaa", "icon", "notes.txt")], "page", null, instances)).toEqual({
      ok: false,
      refusal: "notes.txt is not an image this component can show.",
    });
  });

  it("refuses an undeclared name and a value outside a variant's list, with the sentences", () => {
    expect(applySourceEdits(PAGE, [attribute("hf-aaaa", "color", "red")], "page", null, instances)).toEqual({
      ok: false,
      refusal: "The attribute color cannot be edited here.",
    });
    expect(applySourceEdits(PAGE, [attribute("hf-aaaa", "kind", "tertiary")], "page", null, instances)).toEqual({
      ok: false,
      refusal: "tertiary is not a kind of Button.",
    });
  });

  it("refuses a declared name on an element that is not an instance, and keeps the layer name for every element", () => {
    expect(applySourceEdits(PAGE, [attribute("hf-bbbb", "kind", "secondary")], "page", null, instances)).toEqual({
      ok: false,
      refusal: "The attribute kind cannot be edited here.",
    });
    const named = applySourceEdits(PAGE, [attribute("hf-bbbb", "data-uf-name", "Intro")], "page", null, instances);
    expect(named).toMatchObject({ ok: true, summary: ["Name · Intro"] });
  });
});
