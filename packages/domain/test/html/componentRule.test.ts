import { describe, expect, it } from "vitest";
import { applySourceEdits } from "../../src/html/sourceEdits.ts";


const SHEET = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button"}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }
:host([kind="secondary"]) button { background-color: #eee;   padding-top: 4px; }
button { color: red; }
button { color: blue; }
</style>
<style>.other { color: green }</style>
</head><body><div data-uf-template hidden><button data-hf-id="hf-aaaa">Buy</button></div></body></html>`;

const edit = (rule: { block: number; selector: string; occurrence: number }, property: string, value: string) => ({ type: "componentRule" as const, rule, property, value });

describe("the componentRule edit (spec 20)", () => {
  it("changes the value in the named rule and keeps every other byte", () => {
    const result = applySourceEdits(SHEET, [edit({ block: 0, selector: ':host([kind="secondary"]) button', occurrence: 0 }, "background-color", "#111")]);
    expect(result).toEqual({
      ok: true,
      html: SHEET.replace("background-color: #eee;", "background-color: #111;"),
      summary: ['Background · :host([kind="secondary"]) button'],
    });
  });

  it("counts occurrences of the same selector, so each identical rule is its own", () => {
    const second = applySourceEdits(SHEET, [edit({ block: 0, selector: "button", occurrence: 1 }, "color", "#00f")]);
    expect(second).toMatchObject({ ok: true });
    if (!second.ok) return;
    expect(second.html).toContain("button { color: red; }");
    expect(second.html).toContain("button { color: #00f; }");
  });

  it("adds the declaration when the rule lacks it, after the others", () => {
    const result = applySourceEdits(SHEET, [edit({ block: 0, selector: ":host", occurrence: 0 }, "padding-top", "8px")]);
    expect(result).toMatchObject({ ok: true, summary: ["Padding top · :host"] });
    if (!result.ok) return;
    expect(result.html).toContain(":host { display: inline-block; padding-top: 8px; }");
  });

  it("finds its block among the sheet's style elements, not the page's", () => {
    const result = applySourceEdits(SHEET, [edit({ block: 0, selector: ".other", occurrence: 0 }, "color", "red")]);
    expect(result).toMatchObject({ ok: false, refusal: "That style rule is no longer in this component." });
  });

  it("refuses a rule that is gone, and a value the field cannot take", () => {
    expect(applySourceEdits(SHEET, [edit({ block: 0, selector: "span", occurrence: 0 }, "color", "red")])).toEqual({
      ok: false,
      refusal: "That style rule is no longer in this component.",
    });
    const bad = applySourceEdits(SHEET, [edit({ block: 0, selector: "button", occurrence: 0 }, "color", "not a colour")]);
    expect(bad.ok).toBe(false);
  });

  it("refuses a property the Design tab does not edit", () => {
    expect(applySourceEdits(SHEET, [edit({ block: 0, selector: "button", occurrence: 0 }, "display", "none")])).toEqual({
      ok: false,
      refusal: "display cannot be edited here.",
    });
  });
});
