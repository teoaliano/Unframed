import { describe, expect, it } from "vitest";
import { sheetOwner, styleOwner, type StyleDeclaration, type StyleRule } from "../../src/index.ts";

const decl = (property: string, value: string, important = false): StyleDeclaration => ({ property, value, important });
const rule = (block: number, selector: string, declarations: StyleDeclaration[], occurrence = 0): StyleRule => ({
  ref: { block, selector, occurrence },
  declarations,
});
const yes = () => true;
const no = () => false;

describe("styleOwner", () => {
  it("reports no owner when nothing sets the property", () => {
    expect(styleOwner([rule(0, "button", [decl("color", "red")])], [], "padding", yes)).toEqual({ owner: "none" });
  });

  it("lets the inline style beat a matching rule", () => {
    const rules = [rule(0, "#b", [decl("color", "red")])];
    expect(styleOwner(rules, [decl("color", "blue")], "color", yes)).toEqual({ owner: "inline", value: "blue", important: false });
  });

  it("lets a more specific matching rule win over a less specific one", () => {
    const rules = [rule(0, "button", [decl("color", "red")]), rule(0, ".primary", [decl("color", "blue")])];
    expect(styleOwner(rules, [], "color", yes)).toMatchObject({ owner: "rule", value: "blue", rule: { selector: ".primary" } });
  });

  it("lets the later rule win when specificity is equal", () => {
    const rules = [rule(0, "button", [decl("color", "red")]), rule(1, "button", [decl("color", "blue")])];
    expect(styleOwner(rules, [], "color", yes)).toMatchObject({ owner: "rule", value: "blue", rule: { block: 1 } });
  });

  it("takes the later declaration inside one rule", () => {
    const rules = [rule(0, "button", [decl("color", "red"), decl("color", "green")])];
    expect(styleOwner(rules, [], "color", yes)).toMatchObject({ owner: "rule", value: "green" });
  });

  it("skips rules that do not match", () => {
    const rules = [rule(0, "button", [decl("color", "red")]), rule(0, ".nope", [decl("color", "blue")])];
    expect(styleOwner(rules, [], "color", (selector) => selector === "button")).toMatchObject({ value: "red" });
    expect(styleOwner(rules, [], "color", no)).toEqual({ owner: "none" });
  });

  it("lets an important rule beat an inline normal declaration", () => {
    const rules = [rule(0, "button", [decl("color", "red", true)])];
    expect(styleOwner(rules, [decl("color", "blue")], "color", yes)).toMatchObject({ owner: "rule", value: "red", important: true });
  });

  it("lets an important inline declaration beat an important rule", () => {
    const rules = [rule(0, "#x", [decl("color", "red", true)])];
    expect(styleOwner(rules, [decl("color", "blue", true)], "color", yes)).toEqual({ owner: "inline", value: "blue", important: true });
  });

  it("names a variant rule with its :host conditions", () => {
    const rules = [rule(2, ':host([kind="secondary"]) button', [decl("background", "#eee")], 1)];
    expect(styleOwner(rules, [], "background", yes)).toEqual({
      owner: "rule",
      rule: { block: 2, selector: ':host([kind="secondary"]) button', occurrence: 1 },
      value: "#eee",
      important: false,
      variants: [{ name: "kind", value: "secondary" }],
    });
  });

  it("gives a rule with no :host condition no variant conditions", () => {
    const rules = [rule(0, "button", [decl("padding", "4px")])];
    expect(styleOwner(rules, [], "padding", yes)).toMatchObject({ owner: "rule", variants: [] });
  });

  it("reads a bare attribute condition as a null value", () => {
    const rules = [rule(0, ":host([disabled]) button", [decl("opacity", "0.5")])];
    expect(styleOwner(rules, [], "opacity", yes)).toMatchObject({ variants: [{ name: "disabled", value: null }] });
  });

  it("is script when a rule of unknown match could win", () => {
    const rules = [rule(0, "button", [decl("color", "red")]), rule(0, "a:has(b)", [decl("color", "blue")])];
    expect(styleOwner(rules, [], "color", (selector) => (selector.includes(":has(") ? "unknown" : true))).toEqual({ owner: "script" });
  });

  it("is script when only an untestable rule sets the property", () => {
    expect(styleOwner([rule(0, "a:has(b)", [decl("color", "blue")])], [], "color", yes)).toEqual({ owner: "script" });
    expect(styleOwner([rule(0, "a", [decl("color", "blue")])], [], "color", () => "unknown")).toEqual({ owner: "script" });
  });

  it("ignores an untestable rule that loses to a known winner", () => {
    const rules = [rule(0, "#x", [decl("color", "red")]), rule(0, "a", [decl("color", "blue")])];
    expect(styleOwner(rules, [], "color", (selector) => (selector === "a" ? "unknown" : true))).toMatchObject({ value: "red" });
  });
});

describe("sheetOwner", () => {
  const style = { owner: "none" } as const;
  it("puts a locked element first, then a runtime element, then a token", () => {
    expect(sheetOwner({ locked: true, runtime: true, token: "color.ink", style })).toEqual({ owner: "locked" });
    expect(sheetOwner({ locked: false, runtime: true, token: "color.ink", style })).toEqual({ owner: "script" });
    expect(sheetOwner({ locked: false, runtime: false, token: "color.ink", style })).toEqual({ owner: "token", token: "color.ink" });
  });

  it("falls through to the style owner", () => {
    expect(sheetOwner({ locked: false, runtime: false, token: null, style })).toEqual({ owner: "style", style });
  });
});
