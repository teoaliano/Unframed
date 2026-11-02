import { describe, expect, it } from "vitest";
import { parseStylesheet } from "../../src/kits/css.ts";

describe("the stylesheet scanner", () => {
  it("reads rules with their selectors and declarations, in order", () => {
    const rules = parseStylesheet(":root { --a: #fff; color: red }\n.hero h1 { font-size: 32px !important; }");
    expect(rules.map((rule) => rule.selector)).toEqual([":root", ".hero h1"]);
    expect(rules[0]!.declarations.map((d) => [d.property, d.value, d.important])).toEqual([
      ["--a", "#fff", false],
      ["color", "red", false],
    ]);
    expect(rules[1]!.declarations[0]!.important).toBe(true);
    expect(rules[1]!.declarations[0]!.value).toBe("32px");
  });

  it("gives the offsets of each value, so a replacement keeps every other byte", () => {
    const text = ".a { color:   #fff ;}";
    const decl = parseStylesheet(text)[0]!.declarations[0]!;
    expect(text.slice(decl.start, decl.end)).toBe("#fff");
  });

  it("reads the rules inside @media and records the at-rule they sit in", () => {
    const rules = parseStylesheet("@media (prefers-color-scheme: dark) { :root { --a: #000; } }\n:root { --a: #fff; }");
    expect(rules.map((rule) => [rule.selector, rule.atRules])).toEqual([
      [":root", ["@media (prefers-color-scheme: dark)"]],
      [":root", []],
    ]);
  });

  it("skips at-rules whose bodies are not rules, such as @keyframes and @font-face", () => {
    const rules = parseStylesheet("@keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } }\n@font-face { font-family: x; src: url(a.woff) }\n.b { color: red }");
    expect(rules.map((rule) => rule.selector)).toEqual([".b"]);
  });

  it("ignores comments, and a brace or semicolon inside a string or a bracket", () => {
    const rules = parseStylesheet('/* .x { color: red } */ .a[data-x="}"] { content: "a;b"; background: url(x;y) } ');
    expect(rules.map((rule) => rule.selector)).toEqual(['.a[data-x="}"]']);
    expect(rules[0]!.declarations.map((d) => [d.property, d.value])).toEqual([
      ["content", '"a;b"'],
      ["background", "url(x;y)"],
    ]);
  });

  it("reads a rule with nothing in it, and an empty stylesheet", () => {
    expect(parseStylesheet(".a {}")[0]!.declarations).toEqual([]);
    expect(parseStylesheet("")).toEqual([]);
  });
});
