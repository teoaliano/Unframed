import { describe, expect, it } from "vitest";
import { sourceTreeOf } from "../../src/html/index.ts";
import { PAGE } from "./fixture.ts";

const byId = (html: string, id: string) => {
  const found = sourceTreeOf(html).find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
};

describe("sourceTreeOf", () => {
  it("lists the id'd elements in document order with parent and sibling index", () => {
    expect(sourceTreeOf(PAGE).map((e) => [e.id, e.parent, e.index])).toEqual([
      ["hf-aaaa", null, 0],
      ["hf-bbbb", "hf-aaaa", 0],
      ["hf-cccc", "hf-aaaa", 1],
      ["hf-dddd", "hf-aaaa", 2],
      ["hf-eeee", "hf-aaaa", 3],
      ["hf-ffff", "hf-eeee", 0],
      ["hf-gggg", "hf-aaaa", 4],
    ]);
  });

  it("keeps a layer name and marks it named, else derives the label", () => {
    expect(byId(PAGE, "hf-bbbb")).toMatchObject({ name: "Hero title", named: true });
    expect(byId(PAGE, "hf-gggg")).toMatchObject({ name: "New", named: false });
    expect(byId(PAGE, "hf-cccc")).toMatchObject({ name: "p", named: false });
  });

  it("gives text only to elements whose children are text, with entities decoded", () => {
    expect(byId(PAGE, "hf-bbbb").text).toBe("Hello & welcome");
    expect(byId(PAGE, "hf-cccc").text).toBeNull();
    expect(byId(PAGE, "hf-aaaa").text).toBeNull();
  });

  it("reads inline declarations, property lowercased, value as written", () => {
    expect(byId(PAGE, "hf-aaaa").style).toEqual({ color: "red", "font-size": "12px !important" });
  });

  it("reports hidden from data-uf-hidden", () => {
    expect(byId(PAGE, "hf-aaaa").hidden).toBe(false);
    const hidden = '<body><div data-hf-id="hf-aaaa" data-uf-hidden style="display: none !important">x</div></body>';
    expect(byId(hidden, "hf-aaaa").hidden).toBe(true);
  });

  it("reads an image's src and whether it sits in a picture with sources", () => {
    expect(byId(PAGE, "hf-dddd")).toMatchObject({ src: "a.png", inPicture: false });
    expect(byId(PAGE, "hf-ffff")).toMatchObject({ src: "b.png", inPicture: true });
  });

  it("gives an id-less element's children the nearest id'd ancestor as parent", () => {
    const html = '<body><section><div data-hf-id="hf-aaaa"><span data-hf-id="hf-bbbb">x</span></div></section></body>';
    expect(sourceTreeOf(html).map((e) => [e.id, e.parent])).toEqual([
      ["hf-aaaa", null],
      ["hf-bbbb", "hf-aaaa"],
    ]);
  });

  it("reaches a composition template's content and not a plain template's", () => {
    const composition = '<body><template><div data-composition-id="main" data-hf-id="hf-aaaa">a</div></template></body>';
    const plain = '<body><template><div data-hf-id="hf-bbbb">b</div></template></body>';
    expect(sourceTreeOf(composition).map((e) => e.id)).toEqual(["hf-aaaa"]);
    expect(sourceTreeOf(plain)).toEqual([]);
  });
});

describe("derived labels", () => {
  const cases: [string, string][] = [
    ['<h1 class="a">Hello</h1>', "Hello"],
    ['<img alt="A cat" src="c.png">', "A cat"],
    ['<div id="hero" class="card">x</div>', "x"],
    ['<div id="hero" class="card big"><i></i></div>', "hero"],
    ['<div class="card big"><i></i></div>', "card"],
    ["<span></span>", "span"],
  ];
  it.each(cases)("labels %s", (markup, expected) => {
    const withId = markup.replace(/^<(\w+)/, (_, tag: string) => `<${tag} data-hf-id="hf-aaaa"`);
    expect(byId(`<body>${withId}</body>`, "hf-aaaa").name).toBe(expected);
  });

  it("cuts a long text to 32 characters and an ellipsis", () => {
    const long = "a".repeat(40);
    expect(byId(`<body><p data-hf-id="hf-aaaa">${long}</p></body>`, "hf-aaaa").name).toBe(`${"a".repeat(32)}…`);
  });
});
