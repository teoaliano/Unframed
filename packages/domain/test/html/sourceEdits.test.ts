import { describe, expect, it } from "vitest";
import type { SourceEdit } from "@unframed/contracts";
import { applySourceEdits, summaryLines } from "../../src/html/index.ts";
import { PAGE } from "./fixture.ts";

const apply = (edits: SourceEdit[], html = PAGE, kind: "page" | "motion" = "page") => applySourceEdits(html, edits, kind);

const okHtml = (edits: SourceEdit[], html = PAGE): string => {
  const result = apply(edits, html);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.html;
};

const refusalOf = (edits: SourceEdit[], html = PAGE): string => {
  const result = apply(edits, html);
  if (result.ok) throw new Error("expected a refusal");
  return result.refusal;
};

describe("text edits", () => {
  it("replaces a text-only element's text, escaping &, < and >, and moves no other byte", () => {
    const next = okHtml([{ type: "text", elementId: "hf-bbbb", text: "Hi <you> & me" }]);
    expect(next).toBe(PAGE.replace("Hello &amp; welcome", "Hi &lt;you&gt; &amp; me"));
  });

  it("refuses an element with children, naming it", () => {
    expect(refusalOf([{ type: "text", elementId: "hf-cccc", text: "x" }])).toBe(
      "p holds more than text, so its text cannot be edited here.",
    );
  });

  it("refuses a void element, which has no text", () => {
    expect(refusalOf([{ type: "text", elementId: "hf-dddd", text: "x" }])).toBe(
      "A picture holds more than text, so its text cannot be edited here.",
    );
  });

  it("keeps a comment inside a text-only element", () => {
    const html = '<body><h2 data-hf-id="hf-aaaa">old<!-- note -->tail</h2></body>';
    expect(okHtml([{ type: "text", elementId: "hf-aaaa", text: "new" }], html)).toBe('<body><h2 data-hf-id="hf-aaaa">new<!-- note --></h2></body>');
  });
});

describe("style edits", () => {
  it("sets a declaration on an element with no style attribute, creating the attribute before the closing bracket", () => {
    const next = okHtml([{ type: "style", elementId: "hf-bbbb", property: "font-size", value: "48px" }]);
    expect(next).toContain('<h1 data-hf-id="hf-bbbb" data-uf-name="Hero title" style="font-size: 48px">Hello');
  });

  it("replaces an existing declaration in place and keeps its !important", () => {
    const next = okHtml([{ type: "style", elementId: "hf-aaaa", property: "font-size", value: "20px" }]);
    expect(next).toContain('style="color: red; font-size: 20px !important"');
  });

  it("appends a new declaration after the others", () => {
    const next = okHtml([{ type: "style", elementId: "hf-aaaa", property: "background-color", value: "#fff" }]);
    expect(next).toContain('style="color: red; font-size: 12px !important; background-color: #fff"');
  });

  it("removes a declaration and leaves the others", () => {
    const next = okHtml([{ type: "style", elementId: "hf-aaaa", property: "color", value: null }]);
    expect(next).toContain('style="font-size: 12px !important"');
  });

  it("removes the attribute when its last declaration goes", () => {
    const html = '<body><p data-hf-id="hf-aaaa" style="color: red">x</p></body>';
    expect(okHtml([{ type: "style", elementId: "hf-aaaa", property: "color", value: null }], html)).toBe('<body><p data-hf-id="hf-aaaa">x</p></body>');
  });

  it("refuses a property that is not a design field", () => {
    expect(refusalOf([{ type: "style", elementId: "hf-aaaa", property: "cursor", value: "help" }])).toBe("cursor cannot be edited here.");
  });

  it("refuses a value the field does not take, with the field's label", () => {
    expect(refusalOf([{ type: "style", elementId: "hf-aaaa", property: "color", value: "red;x" }])).toBe('Colour cannot be "red;x".');
  });
});

describe("attribute edits (data-uf-name)", () => {
  it("sets a layer name on an element without one", () => {
    const next = okHtml([{ type: "attribute", elementId: "hf-gggg", name: "data-uf-name", value: "Badge" }]);
    expect(next).toContain('<span data-hf-id="hf-gggg" class="badge chip" data-uf-name="Badge">New</span>');
  });

  it("removes the layer name on an empty value, taking the space before it", () => {
    const next = okHtml([{ type: "attribute", elementId: "hf-bbbb", name: "data-uf-name", value: "" }]);
    expect(next).toContain('<h1 data-hf-id="hf-bbbb">Hello');
  });

  it("trims the name and cuts it to 60 characters", () => {
    const next = okHtml([{ type: "attribute", elementId: "hf-gggg", name: "data-uf-name", value: `  ${"n".repeat(70)}  ` }]);
    expect(next).toContain(`data-uf-name="${"n".repeat(60)}"`);
  });

  it("refuses another attribute name", () => {
    expect(refusalOf([{ type: "attribute", elementId: "hf-gggg", name: "class", value: "x" }])).toBe("The attribute class cannot be edited here.");
  });
});

describe("hide edits", () => {
  it("adds the attribute and the hide declaration last, and shows again to the same bytes", () => {
    const hidden = okHtml([{ type: "hide", elementId: "hf-cccc", hidden: true }]);
    expect(hidden).toContain('<p data-hf-id="hf-cccc" data-uf-hidden style="display: none !important">Plain');
    const shown = okHtml([{ type: "hide", elementId: "hf-cccc", hidden: false }], hidden);
    expect(shown).toBe(PAGE);
  });

  it("keeps the hide declaration last when a style is set on a hidden element", () => {
    const hidden = okHtml([{ type: "hide", elementId: "hf-aaaa", hidden: true }]);
    const next = okHtml([{ type: "style", elementId: "hf-aaaa", property: "opacity", value: "0.5" }], hidden);
    expect(next).toContain('style="color: red; font-size: 12px !important; opacity: 0.5; display: none !important"');
  });

  it("does nothing when the element is already hidden", () => {
    const hidden = okHtml([{ type: "hide", elementId: "hf-cccc", hidden: true }]);
    expect(okHtml([{ type: "hide", elementId: "hf-cccc", hidden: true }], hidden)).toBe(hidden);
  });
});

describe("image edits", () => {
  it("sets an image's src and drops srcset and sizes", () => {
    const next = okHtml([{ type: "image", elementId: "hf-dddd", target: "src", file: "c.png" }]);
    expect(next).toContain('<img data-hf-id="hf-dddd" src="c.png" alt="A picture">');
  });

  it("refuses an image inside a picture that has sources", () => {
    expect(refusalOf([{ type: "image", elementId: "hf-ffff", target: "src", file: "c.png" }])).toBe(
      "This picture chooses its file from a list of sources. Ask the agent to change it.",
    );
  });

  it("writes a background image as a background-image declaration", () => {
    const next = okHtml([{ type: "image", elementId: "hf-cccc", target: "background", file: "c.png" }]);
    expect(next).toContain('<p data-hf-id="hf-cccc" style="background-image: url(&quot;c.png&quot;)">Plain');
  });

  it("refuses a file that is not an image or not a bare name", () => {
    expect(refusalOf([{ type: "image", elementId: "hf-dddd", target: "src", file: "c.txt" }])).toBe("c.txt is not an image this page can show.");
    expect(refusalOf([{ type: "image", elementId: "hf-dddd", target: "src", file: "../c.png" }])).toBe("../c.png is not an image this page can show.");
  });
});

describe("every edit type", () => {
  it("refuses an id the source does not have", () => {
    expect(refusalOf([{ type: "hide", elementId: "hf-zzzz", hidden: true }], PAGE)).toBe("There is no element hf-zzzz in this page any more.");
  });

  it("names the artifact kind in that refusal", () => {
    const result = applySourceEdits(PAGE, [{ type: "hide", elementId: "hf-zzzz", hidden: true }], "motion");
    expect(result.ok ? "" : result.refusal).toBe("There is no element hf-zzzz in this motion any more.");
  });

  it("is all or nothing: a refusal late in the list gives no html", () => {
    const result = apply([
      { type: "text", elementId: "hf-bbbb", text: "changed" },
      { type: "style", elementId: "hf-aaaa", property: "color", value: "red;" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("applies two edits to one element in order", () => {
    const next = okHtml([
      { type: "style", elementId: "hf-bbbb", property: "font-size", value: "30px" },
      { type: "style", elementId: "hf-bbbb", property: "font-size", value: "40px" },
    ]);
    expect(next).toContain('style="font-size: 40px"');
    expect(next).not.toContain("30px");
  });

  it("returns the source untouched for an empty list", () => {
    const result = apply([]);
    expect(result).toEqual({ ok: true, html: PAGE, summary: [] });
  });
});

describe("summary lines", () => {
  it("writes one line per field and element, label from the element after the edit", () => {
    const result = apply([
      { type: "text", elementId: "hf-bbbb", text: "Hi" },
      { type: "style", elementId: "hf-bbbb", property: "font-size", value: "48px" },
      { type: "attribute", elementId: "hf-gggg", name: "data-uf-name", value: "Badge" },
      { type: "hide", elementId: "hf-cccc", hidden: true },
      { type: "image", elementId: "hf-dddd", target: "src", file: "c.png" },
    ]);
    expect(result.ok && result.summary).toEqual(["Text · Hero title", "Font size · Hero title","Name · Badge", "Hidden · p", "Image · A picture"]);
  });

  it("drops a repeated line", () => {
    const result = apply([
      { type: "style", elementId: "hf-bbbb", property: "font-size", value: "30px" },
      { type: "style", elementId: "hf-bbbb", property: "font-size", value: "40px" },
    ]);
    expect(result.ok && result.summary).toEqual(["Font size · Hero title"]);
  });

  it("caps at 20 lines and then says how many more", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `Text · ${i}`);
    const summary = summaryLines(lines);
    expect(summary).toHaveLength(21);
    expect(summary[20]).toBe("and 5 more");
    expect(summary[19]).toBe("Text · 19");
  });

  it("writes no 'and more' line at exactly 20", () => {
    expect(summaryLines(Array.from({ length: 20 }, (_, i) => `Text · ${i}`))).toHaveLength(20);
  });
});
