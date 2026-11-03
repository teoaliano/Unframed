import { describe, expect, it } from "vitest";
import { compiledFileName, compileComponent, readComponentSheet } from "../../src/index.ts";

const SHEET = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-chip","variants":{"tone":["calm","loud"]},"props":{"label":"text"},"slots":[""]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { color: var(--ink); }
:host([tone="loud"]) span { font-weight: 700; }</style>
</head><body>
<div data-uf-template hidden><span data-uf-prop="label">Chip</span><slot></slot></div>
</body></html>`;

describe("compiledFileName", () => {
  it("puts .component.js beside the sheet", () => {
    expect(compiledFileName("1761400000000-button.html")).toBe("1761400000000-button.component.js");
    expect(compiledFileName("1761400000000-button-2.html")).toBe("1761400000000-button-2.component.js");
  });
});

describe("compileComponent", () => {
  const compiled = compileComponent(SHEET, "1761400000000-chip.html");

  it("carries the declaration, style and template as literals", () => {
    const sheet = readComponentSheet(SHEET);
    if (!sheet.ok) throw new Error(sheet.refusal);
    const literal = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
    expect(compiled).toContain(literal(sheet.sheet.declaration));
    expect(compiled).toContain(literal(sheet.sheet.style));
    expect(compiled).toContain(literal(sheet.sheet.template));
  });

  it("carries the component runtime and calls it once", () => {
    expect(compiled).toContain("function ufDefineComponent(");
    expect(compiled.match(/ufDefineComponent\(\{/g)?.length).toBe(1);
    expect(compiled).toContain("customElements.define(decl.tag, UfComponent)");
  });

  it("names its sheet in the header", () => {
    expect(compiled.split("\n")[0]).toContain("1761400000000-chip.html");
  });

  it("escapes a closing script tag in content", () => {
    const withTag = SHEET.replace("<slot></slot>", '<slot></slot><i title="</script>"></i>');
    const out = compileComponent(withTag, "1761400000000-chip.html");
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script>");
  });

  it("gives the same bytes for the same sheet", () => {
    expect(compileComponent(SHEET, "1761400000000-chip.html")).toBe(compiled);
  });

  it("refuses a sheet the reader refuses", () => {
    expect(() => compileComponent("<html></html>", "x.html")).toThrow(/needs one <script/);
  });
});

describe("compileComponent header (spec 20)", () => {
  it("keeps line and paragraph separators out of the header comment", () => {
    const compiled = compileComponent(SHEET, "1761400000000\u2028chip\u2029.html");
    const header = compiled.split("\n")[0]!;
    expect(header).not.toMatch(/[\u2028\u2029]/);
    expect(header).toContain("1761400000000_chip_.html");
  });
});
