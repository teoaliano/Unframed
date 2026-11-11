import { parseGsapScriptAcornForWrite } from "@hyperframes/parsers/gsap-parser-acorn";
import { describe, expect, it } from "vitest";
import { dialsCallback, ownerContextFor, ownerOf, type Owner } from "../../src/index.ts";

const ownerOfExpression = (expr: string, { inCallback = true, body }: { inCallback?: boolean; body?: string } = {}): Owner => {
  const call = `window.__timelines = window.__timelines || {};\nwindow.__timelines.main = gsap.timeline({ paused: true });\nwindow.__timelines.main.to('#a', { x: ${expr} }, 0);`;
  const source = inCallback
    ? `unframed.dials('Scene', { speed: [1, 0, 2], scene: { speed: 1 } }, function (v) {\n${body ?? ""}\n${call}\n});`
    : call;
  const parsed = parseGsapScriptAcornForWrite(source);
  if (!parsed) throw new Error("the fixture script does not parse");
  const located = parsed.located.find((entry) => entry.call.selector === "#a")!;
  const property = (located.call.varsArg as { properties: { key: { name: string }; value: unknown }[] }).properties.find(
    (p) => p.key.name === "x",
  )!;
  return ownerOf(property.value as never, ownerContextFor(parsed.ast, source));
};

describe("ownerOf: values", () => {
  it.each([
    ["an integer", "1", { kind: "source", value: 1 }],
    ["a decimal", "0.25", { kind: "source", value: 0.25 }],
    ["a negative number", "-2", { kind: "source", value: -2 }],
    ["arithmetic on numbers alone", "0.5 * 2 + 1", { kind: "source", value: 2 }],
    ["a string with a unit", "'120px'", { kind: "source", value: "120px" }],
    ["a colour string", "'#a78bfa'", { kind: "source", value: "#a78bfa" }],
    ["a relative add", "'+=100'", { kind: "script", text: "'+=100'" }],
    ["a relative subtract", "'-=1'", { kind: "script", text: "'-=1'" }],
    ["a relative position", "'<'", { kind: "script", text: "'<'" }],
    ["random", "'random(0, 10)'", { kind: "script", text: "'random(0, 10)'" }],
    ["a function call", "Math.random() * 10", { kind: "script", text: "Math.random() * 10" }],
    ["an unknown identifier", "offset", { kind: "script", text: "offset" }],
    ["a template literal", "`${1}px`", { kind: "script", text: "`${1}px`" }],
  ])("%s", (_name, expr, owner) => {
    expect(ownerOfExpression(expr, { inCallback: false })).toEqual(owner);
  });
});

describe("ownerOf: dial paths", () => {
  it.each([
    ["a top-level parameter", "v.speed", { kind: "dial", path: ["speed"] }],
    ["a nested folder", "v.scene.speed", { kind: "dial", path: ["scene", "speed"] }],
    ["a string-literal bracket step", "v[\"speed\"]", { kind: "dial", path: ["speed"] }],
    ["a folder with a bracket step", "v['scene'].speed", { kind: "dial", path: ["scene", "speed"] }],
    ["a computed key", "v[key]", { kind: "script", text: "v[key]" }],
    ["arithmetic on a parameter", "v.speed * 2", { kind: "script", text: "v.speed * 2" }],
    ["an addition on a parameter", "v.speed + 0.5", { kind: "script", text: "v.speed + 0.5" }],
    ["a call on a parameter", "v.speed()", { kind: "script", text: "v.speed()" }],
  ])("%s", (_name, expr, owner) => {
    expect(ownerOfExpression(expr)).toEqual(owner);
  });

  it("is script when the parameter is reassigned in the callback", () => {
    expect(ownerOfExpression("v.speed", { body: "v = {};" })).toEqual({ kind: "script", text: "v.speed" });
  });

  it("is script when the callback destructures its parameter", () => {
    const source = `window.__timelines = window.__timelines || {};
window.__timelines.main = gsap.timeline({ paused: true });
unframed.dials('S', {}, function ({ speed }) {\nwindow.__timelines.main.to('#a', { x: speed }, 0);\n});`;
    const parsed = parseGsapScriptAcornForWrite(source)!;
    const node = (parsed.located[0]!.call.varsArg as { properties: { value: unknown }[] }).properties[0]!.value;
    expect(ownerOf(node as never, ownerContextFor(parsed.ast, source))).toEqual({ kind: "script", text: "speed" });
  });

  it("is script outside any dials callback", () => {
    expect(ownerOfExpression("v.speed", { inCallback: false })).toEqual({ kind: "script", text: "v.speed" });
  });
});

describe("ownerOf: tokens", () => {
  it("reads one string-literal token call", () => {
    expect(ownerOfExpression("unframed.token(\"duration/fast\")")).toEqual({ kind: "token", name: "duration/fast" });
  });

  it.each([
    ["a token name from a variable", "unframed.token(name)"],
    ["two arguments", "unframed.token('a', 'b')"],
    ["another call", "other.token('a')"],
  ])("is script for %s", (_name, expr) => {
    expect(ownerOfExpression(expr).kind).toBe("script");
  });
});

describe("dialsCallback", () => {
  const find = (source: string) => {
    const parsed = parseGsapScriptAcornForWrite(source)!;
    return dialsCallback(parsed.ast as never);
  };

  it("finds a function expression and its parameter", () => {
    const found = find("unframed.dials('S', {}, function (v) { v.x; });");
    expect(found?.scope).toEqual({ param: "v", reassigned: false, destructured: false });
  });

  it("finds an arrow function", () => {
    expect(find("unframed.dials('S', {}, (v) => { v.x; });")?.scope.param).toBe("v");
  });

  it("finds a function declared in the same script", () => {
    const found = find("function apply(v) { v.x; }\nunframed.dials('S', {}, apply);");
    expect(found?.scope.param).toBe("v");
  });

  it("takes the last declaration", () => {
    const found = find("unframed.dials('A', {}, function (first) { first; });\nunframed.dials('B', {}, function (second) { second; });");
    expect(found?.scope.param).toBe("second");
  });

  it("is null when the script declares no dials", () => {
    expect(find("window.__timelines.main.to('#a', {}, 0);")).toBeNull();
  });

  it("marks a reassigned parameter", () => {
    expect(find("unframed.dials('S', {}, function (v) { v = 1; });")?.scope.reassigned).toBe(true);
  });
});
