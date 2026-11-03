import { describe, expect, it } from "vitest";
import { readComponentSheet, sheetRefusal, type ComponentSheet } from "../../src/index.ts";

const SHEET_HTML = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

const sheet = (): ComponentSheet => {
  const read = readComponentSheet(SHEET_HTML);
  if (!read.ok) throw new Error(read.refusal);
  return read.sheet;
};

describe("sheetRefusal", () => {
  it("accepts a sheet whose tag no other shape holds", () => {
    expect(sheetRefusal(sheet(), [{ id: "shape:a", tag: "uf-card" }])).toBeUndefined();
    expect(sheetRefusal(sheet(), [{ id: "shape:a", tag: "uf-button" }], "shape:a")).toBeUndefined();
  });

  it("refuses a tag another component shape already holds, naming that shape", () => {
    expect(sheetRefusal(sheet(), [{ id: "shape:old", tag: "uf-button" }])).toBe(
      "uf-button is already the component shape:old; write to that shape, or choose another tag",
    );
  });

  it("does not refuse the shape's own tag when that shape is the one written", () => {
    expect(sheetRefusal(sheet(), [{ id: "shape:me", tag: "uf-button" }], "shape:me")).toBeUndefined();
  });

  it("refuses a write to a shape whose tag is different, naming the shape and its tag", () => {
    expect(sheetRefusal(sheet(), [{ id: "shape:me", tag: "uf-card" }], "shape:me")).toBe(
      "component shape:me is uf-card; a component keeps its tag",
    );
  });

  it("refuses the tag taken before a tag change, as the spec orders them", () => {
    const canvas = [
      { id: "shape:me", tag: "uf-card" },
      { id: "shape:other", tag: "uf-button" },
    ];
    expect(sheetRefusal(sheet(), canvas, "shape:me")).toBe(
      "uf-button is already the component shape:other; write to that shape, or choose another tag",
    );
  });
});
