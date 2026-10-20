import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyStyleEdits,
  composeSelection,
  STYLE_EDIT_ARGUMENTS,
  STYLE_EDIT_TEXT,
  STYLE_LINE_TEMPLATE,
  STYLE_READ_ARGUMENTS,
  STYLE_READ_TEXT,
  STYLE_SIZE_LIMIT,
  STYLE_WRITE_ARGUMENTS,
  STYLE_WRITE_TEXT,
  styleCard,
  styleDocument,
  styleExcerpt,
  styleHeading,
  styleLine,
  styleOfSelection,
  styleSwatches,
  styleTitleFor,
  toolbarState,
} from "../../src/index.ts";
import { group, image, prompt, style } from "../shapes.ts";

const DOC = `---
name: Linear
---
# Linear Design System

A calm, dense interface for **focused** work. See [the guide](https://example.com).

## Colours

| Token | Value |
| --- | --- |
| Accent | #5E6AD2 |

- Background: #08090a
- Text: #f7f8f8 and the accent again #5e6ad2
- Muted: #8A8F98, link #ABC, overlay #00000080

\`\`\`css
--brand: #123456;
\`\`\`
`;

describe("what a style card shows", () => {
  it("takes the first few distinct hex colours, in the order they appear, as six-digit lowercase", () => {
    expect(styleSwatches(DOC)).toEqual(["#5e6ad2", "#08090a", "#f7f8f8", "#8a8f98", "#aabbcc", "#000000"]);
    expect(styleSwatches(DOC, 2)).toEqual(["#5e6ad2", "#08090a"]);
  });

  it("does not read anchors, entities or words with a hash as colours", () => {
    expect(styleSwatches("See #section-2, &#123; and issue #12, but #fff is white.")).toEqual(["#ffffff"]);
  });

  it("names the title by the first heading, past front matter, else the file name", () => {
    expect(styleHeading(DOC)).toBe("Linear Design System");
    expect(styleTitleFor(DOC, "x.md")).toBe("Linear Design System");
    expect(styleTitleFor("no heading here", "brand-notes.md")).toBe("brand-notes");
  });

  it("shows the opening prose as plain words, skipping headings, tables and code", () => {
    expect(styleExcerpt(DOC)).toBe(
      "A calm, dense interface for focused work. See the guide. Background: #08090a Text: #f7f8f8 and the accent again #5e6ad2 Muted: #8A8F98, link #ABC, overlay #00000080",
    );
    expect(styleExcerpt(`# T\n\n${"word ".repeat(100)}`).length).toBeLessThanOrEqual(220);
    expect(styleCard(DOC)).toEqual({ swatches: styleSwatches(DOC), excerpt: styleExcerpt(DOC) });
  });
});

describe("what a style write may save", () => {
  it("takes non-empty markdown up to 100 KiB and refuses the rest", () => {
    expect(styleDocument("# A")).toEqual({ markdown: "# A" });
    expect(styleDocument("a".repeat(STYLE_SIZE_LIMIT))).toEqual({ markdown: "a".repeat(STYLE_SIZE_LIMIT) });
    expect(styleDocument("é".repeat(STYLE_SIZE_LIMIT / 2 + 1))).toEqual({ error: "A style document is at most 100 KiB of markdown. Nothing was written." });
    expect(styleDocument("  ")).toEqual({ error: "markdown must be a non-empty string" });
    expect(styleDocument(42)).toEqual({ error: "markdown must be a non-empty string" });
  });

  it("edits by the page edit rules, naming style_read", () => {
    expect(applyStyleEdits("# A\nred #f00", [{ old_string: "#f00", new_string: "#0f0" }])).toEqual({ markdown: "# A\nred #0f0" });
    expect(applyStyleEdits("a a", [{ old_string: "a", new_string: "b" }])).toEqual({
      error: "edit 1: old_string matched 2 times; it must match exactly once. Nothing was written. Include more of the surrounding text so it is unique.",
    });
    expect(applyStyleEdits("a", [{ old_string: "z", new_string: "b" }])).toEqual({
      error: "edit 1: old_string matched 0 times; it must match exactly once. Nothing was written. Read the current text with style_read and quote it exactly.",
    });
  });
});

describe("which style a message attaches", () => {
  it("is the first style in reading order, a selected group's members included", () => {
    const shapes = [group("g", { x: 0, y: 0 }), style("s1", { x: 10, y: 60, parent: "g" }), style("s2", { x: 500, y: 0 }), prompt("p", "hi", { x: 0, y: 900 })];
    expect(styleOfSelection(shapes, ["p", "s2"])?.id).toBe("s2");
    expect(styleOfSelection(shapes, ["g", "s2"])?.id).toBe("s1");
    expect(styleOfSelection(shapes, ["s1", "s2"])?.id).toBe("s2");
    expect(styleOfSelection(shapes, ["g"])?.id).toBe("s1");
    expect(styleOfSelection(shapes, ["p"])).toBeUndefined();
  });

  it("is named in the preamble by id, title and file, never by its text", () => {
    expect(styleLine({ id: "s204", title: "Linear", file: "1-linear-2.md" })).toBe(
      'This chat follows the style "Linear" (style s204, file 1-linear-2.md). Read it with style_read before designing if it is not in your context or the file changed.',
    );
    expect(styleLine({ id: "s", title: 'The "Big" one $&', file: "f.md" })).toContain("\"The 'Big' one $&\"");
  });
});

describe("Generate ignores styles", () => {
  it("sends nothing of a selected style, gives it no badge and leaves it out of the count", () => {
    const shapes = [prompt("p", "a fox", { x: 0 }), image("i", "fox.png", { x: 200 }), style("s", { x: 400 })];
    const composed = composeSelection({ shapes, selected: ["p", "i", "s"], instruction: "", medium: "image" });
    expect(composed.sources).toEqual(["p", "i"]);
    expect(composed.references.map((slot) => slot.shapeId)).toEqual(["i"]);
    expect(composed.roles).toEqual({ i: "image 1" });
    expect(composed.prompt).toBe("a fox");
    const alone = composeSelection({ shapes, selected: ["s"], instruction: "", medium: "image" });
    expect(alone.usable).toBe(false);
    expect(toolbarState({ selected: [{ id: "p", kind: "prompt" }, { id: "s", kind: "style", file: "a.md" }], usable: true, results: [] })).toEqual({ kind: "generate", hint: "1 selected" });
    expect(toolbarState({ selected: [{ id: "s", kind: "style", file: "a.md" }], usable: false, results: [] })).toEqual({ kind: "open", shapeId: "s" });
  });
});

const sections = (file: string) =>
  readFileSync(join(import.meta.dirname, "../../../../assets/prompts", file), "utf8")
    .split(/^## /m)
    .slice(1)
    .map((part) => ({
      name: part.split("\n")[0]!.trim(),
      text: /^(`{3,})text\n([\s\S]*?)\n\1$/m.exec(part)?.[2],
      args: Object.fromEntries([...part.matchAll(/^- `([^`]+)`: (.*)$/gm)].map((match) => [match[1]!, match[2]!])),
    }));

describe("the style tools' model-facing text is the asset's text", () => {
  it("holds the three tools, their arguments and the preamble line", () => {
    const [read, write, edit, line] = sections("style-tools.md");
    expect([read!.name, write!.name, edit!.name]).toEqual(["style_read", "style_write", "style_edit"]);
    expect([STYLE_READ_TEXT, STYLE_READ_ARGUMENTS]).toEqual([read!.text, read!.args]);
    expect([STYLE_WRITE_TEXT, STYLE_WRITE_ARGUMENTS]).toEqual([write!.text, write!.args]);
    expect([STYLE_EDIT_TEXT, STYLE_EDIT_ARGUMENTS]).toEqual([edit!.text, edit!.args]);
    expect(STYLE_LINE_TEMPLATE).toBe(line!.text);
  });
});

describe("front matter", () => {
  it("splits off exactly, so the body can be edited and the two joined again byte for byte", async () => {
    const { splitFrontMatter } = await import("../../src/index.ts");
    const doc = "---\nname: x\ncolors:\n  a: \"#fff\"\n---\n\n## Overview\nText\n";
    const split = splitFrontMatter(doc);
    expect(split).toEqual({ frontMatter: "---\nname: x\ncolors:\n  a: \"#fff\"\n---\n", body: "\n## Overview\nText\n" });
    expect(split.frontMatter + split.body).toBe(doc);
    expect(splitFrontMatter("# Title\n---\nnot front matter")).toEqual({ frontMatter: "", body: "# Title\n---\nnot front matter" });
  });
});
