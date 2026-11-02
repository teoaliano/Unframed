import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESIGN_FIELDS, styleValueRefusal } from "../src/index.ts";

describe("styleValueRefusal", () => {
  const cases: [string, string, boolean][] = [
    ["font-size", "12px", true],
    ["font-size", "1.5rem", true],
    ["font-size", "-4px", true],
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
  it("keeps the HTML parsers out of the root entry", () => {
    const srcRoot = new URL("../src/", import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "html") walk(path);
        } else if (name.endsWith(".ts")) files.push(path);
      }
    };
    walk(srcRoot);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from "(parse5|@hyperframes\/parsers[^"]*)"/);
      expect(text, file).not.toMatch(/from "\.\.?\/[^"]*html\//);
    }
    expect(readFileSync(join(srcRoot, "index.ts"), "utf8")).not.toMatch(/html\//);
  });
});
