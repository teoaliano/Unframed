import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DESIGN_FIELDS, styleValueRefusal } from "../src/index.ts";

describe("styleValueRefusal", () => {
  const cases: [string, string, boolean][] = [
    ["font-size", "12px", true],
    ["font-size", "1.5rem", true],
    ["font-size", "-4px", false],
    ["font-size", "-0.5em", false],
    ["line-height", "-1", false],
    ["line-height", "-1px", false],
    ["gap", "-4px", false],
    ["padding-left", "-2px", false],
    ["border-width", "-1px", false],
    ["border-radius", "-2px", false],
    ["margin-top", "-4px", true],
    ["margin-left", "-0.5rem", true],
    ["letter-spacing", "-0.5px", true],
    ["box-shadow", "-2px 2px 4px #000", true],
    ["font-size", "0", true],
    ["font-size", "12", false],
    ["font-size", "12vw", false],
    ["line-height", "1.4", true],
    ["line-height", "18px", true],
    ["line-height", "1.4em", false],
    ["letter-spacing", "-0.5px", true],
    ["font-weight", "700", true],
    ["font-weight", "450", false],
    ["font-weight", "1000", false],
    ["text-align", "justify", true],
    ["text-align", "start", false],
    ["color", "#fff", true],
    ["color", "#a1b2c3", true],
    ["color", "#a1b2c380", true],
    ["color", "#ggg", false],
    ["color", "rgb(1 2 3 / 50%)", true],
    ["color", "red", true],
    ["color", "transparent", true],
    ["color", "red;x", false],
    ["background-color", "url(x.png)", false],
    ["opacity", "0.5", true],
    ["opacity", "1", true],
    ["opacity", "1.5", false],
    ["border-style", "dashed", true],
    ["border-style", "wavy", false],
    ["flex-direction", "column-reverse", true],
    ["align-items", "stretch", true],
    ["justify-content", "space-evenly", true],
    ["flex-wrap", "wrap", true],
    ["font-family", "Inter, sans-serif", true],
    ["font-family", "'Inter Tight', serif", true],
    ["font-family", "a{b}", false],
    ["box-shadow", "none", true],
    ["box-shadow", "0 2px 4px rgba(0,0,0,0.2)", true],
    ["box-shadow", "red", false],
    ["gap", "8px", true],
    ["padding-left", "", false],
    ["margin-top", "expression(1)", false],
    ["border-radius", "var(--r)", false],
    ["border-radius", "4px !important", false],
    ["border-radius", "4px\\", false],
    ["border-radius", "<4px>", false],
  ];

  it.each(cases)("%s = %s is %s", (property, value, allowed) => {
    expect(styleValueRefusal(property, value) === null).toBe(allowed);
  });

  it("words the refusal with the field's label and the value", () => {
    expect(styleValueRefusal("font-size", "12")).toBe('Font size cannot be "12".');
  });

  it("refuses a property that is not a design field", () => {
    expect(styleValueRefusal("cursor", "help")).toBe("cursor cannot be edited here.");
  });

  it("has a label and a property for every field", () => {
    for (const field of DESIGN_FIELDS) {
      expect(field.label).not.toBe("");
      expect(field.property).toMatch(/^[a-z-]+$/);
    }
  });
});

describe("the web-facing domain", () => {
  const PARSER = /from "(parse5|linkedom|@hyperframes\/parsers[^"]*)"/;
  const VALUE_IMPORT = /\b(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+"(\.{1,2}\/[^"]+)"/g;

  it("keeps the HTML parsers out of the root entry", () => {
    const srcRoot = new URL("../src/", import.meta.url).pathname;
    const root = join(srcRoot, "index.ts");
    const reached = new Set<string>();
    const visit = (file: string): void => {
      if (reached.has(file)) return;
      reached.add(file);
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(PARSER);
      expect(text, file).not.toMatch(/from "\.\.?\/[^"]*html\//);
      for (const match of text.matchAll(VALUE_IMPORT)) {
        const target = resolve(dirname(file), match[1]!);
        expect(target.startsWith(srcRoot), file).toBe(true);
        expect(target, file).not.toMatch(/\/src\/html\//);
        visit(target);
      }
    };
    visit(root);
    expect(reached.size).toBeGreaterThan(50);
    expect([...reached].some((file) => file.includes("/motion/"))).toBe(true);
    expect(readFileSync(root, "utf8")).not.toMatch(/html\//);
  });
});
