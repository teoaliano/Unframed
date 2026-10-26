import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyStyleEdits,
  composeSelection,
  droppedStyleRole,
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
  styleRoleOf,
  styleSwatches,
  styleTitleFor,
  selectionHint,
  toolbarState,
} from "../../src/index.ts";
import { group, image, prompt, style } from "../shapes.ts";

const preset = (folder: string) => readFileSync(join(import.meta.dirname, "../../../../assets/design-md", folder, "DESIGN.md"), "utf8");

/** A colour in OKLab, to judge how it looks. */
const oklab = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const neutral = (hex: string) => Math.hypot(oklab(hex)[1], oklab(hex)[2]) < 0.04;

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
  it("without colours in its front matter, takes distinct colours from the text, the first one first, as six-digit lowercase", () => {
    const swatches = styleSwatches(DOC);
    expect(swatches[0]).toBe("#5e6ad2");
    expect(swatches.every((colour) => /^#[0-9a-f]{6}$/.test(colour))).toBe(true);
    expect(new Set(swatches).size).toBe(swatches.length);
    // #000000 and #08090a are one near-black; the greys stop at two.
    expect(swatches.filter((colour) => colour === "#000000" || colour === "#08090a")).toHaveLength(1);
    expect(swatches.filter(neutral).length).toBeLessThanOrEqual(2);
    expect(styleSwatches(DOC, 2)).toHaveLength(2);
  });

  it("puts the front matter's primary, accent, brand, canvas and ink first, nested names included", () => {
    const doc = `---
colors:
  surface: "#f4f4f4"
  hover: "#123123"
  brand:
    primary: "#ff5a1f"
  accent: "#00a37a"
  on-primary: "#ffffff"
  canvas: "#fafafa"
  ink: "#111111"
---
# Brand
`;
    expect(styleSwatches(doc).slice(0, 4)).toEqual(["#ff5a1f", "#00a37a", "#fafafa", "#111111"]);
  });

  it("picks swatches that stand for the shipped styles", () => {
    const linear = styleSwatches(preset("linear.app"));
    expect(linear[0]).toBe("#5e6ad2");
    expect(linear.filter((colour) => neutral(colour) && oklab(colour)[0] < 0.3)).toHaveLength(1);
    expect(linear.filter(neutral).length).toBeLessThanOrEqual(2);

    const stripe = styleSwatches(preset("stripe"));
    expect(stripe[0]).toBe("#533afd");
    // The file names ruby, magenta, lemon and a cream beside its blues: one of them shows.
    expect(stripe.some((colour) => ["#ea2261", "#f96bee", "#9b6829", "#f5e9d4"].includes(colour))).toBe(true);

    const vercel = styleSwatches(preset("vercel"));
    expect(vercel.some((colour) => !neutral(colour))).toBe(true);
    expect(styleSwatches(`---\ncolors:\n  ink: "#171717"\n  canvas: "#ffffff"\n  mute: "#888888"\n---\n`).every(neutral)).toBe(true);

    for (const style of ["apple", "claude", "vercel", "notion", "airbnb", "linear.app", "stripe", "figma", "bmw-m", "coinbase"]) {
      const swatches = styleSwatches(preset(style));
      expect(swatches.length, style).toBeGreaterThanOrEqual(2);
      expect(swatches.length, style).toBeLessThanOrEqual(6);
      expect(swatches.filter(neutral).length, style).toBeLessThanOrEqual(2);
    }
  });

  it("does not read anchors, entities or words with a hash as colours", () => {
    expect(styleSwatches("See #section-2, &#123; and issue #12, but #fff is white.")).toEqual(["#ffffff"]);
  });

  it("names the title by the first heading, past front matter, else the file name", () => {
    expect(styleHeading(DOC)).toBe("Linear Design System");
    expect(styleTitleFor(DOC, "x.md")).toBe("Linear Design System");
    expect(styleTitleFor("no heading here", "brand-notes.md")).toBe("brand-notes");
  });

  it("reads a token reference in the excerpt as its value, or leaves it out when the front matter has none", () => {
    const doc = `---
colors:
  canvas: "#010102"
  surface-1: "#0f1011"
---
# Dark

The canvas is the deepest surface — {colors.canvas} is #010102, nearly black. Cards sit on \`{colors.surface-1}\` (charcoal), and links use {colors.link} where they show.
`;
    expect(styleExcerpt(doc)).toBe("The canvas is the deepest surface — #010102, nearly black. Cards sit on #0f1011 (charcoal), and links use where they show.");
    expect(styleExcerpt(preset("linear.app"))).not.toMatch(/[{}]/);
    expect(styleExcerpt(preset("claude"))).not.toMatch(/[{}]/);
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

  it("is never a document, which the selection skips for the next style in reading order", () => {
    const shapes = [style("notes", { x: 0, y: 0 }), style("s1", { x: 500, y: 0 })].map((shape) => (shape.id === "notes" ? { ...shape, document: true } : shape));
    expect(styleOfSelection(shapes, ["notes"])).toBeUndefined();
    expect(styleOfSelection(shapes, ["notes", "s1"])?.id).toBe("s1");
  });

  it("is named in the preamble by id, title and file, never by its text", () => {
    expect(styleLine({ id: "s204", title: "Linear", file: "1-linear-2.md" })).toBe(
      'This chat follows the style "Linear" (style s204, file 1-linear-2.md). Read it with style_read before designing if it is not in your context or the file changed.',
    );
    expect(styleLine({ id: "s", title: 'The "Big" one $&', file: "f.md" })).toContain("\"The 'Big' one $&\"");
  });
});

describe("a markdown shape's role", () => {
  it("is a style when a dropped file names colours, else a document", () => {
    expect(droppedStyleRole("# Linear\n\nCalm.\n\n- Accent: #5E6AD2\n")).toBe("style");
    expect(droppedStyleRole(preset("linear.app"))).toBe("style");
    expect(droppedStyleRole("# Standup notes\n\n- Ship the card by Friday\n- Issue #12 is open\n")).toBe("document");
    expect(droppedStyleRole("")).toBe("document");
  });

  it("reads as a style unless the props say document, so shapes made before roles stay styles", () => {
    expect(styleRoleOf({ file: "1-linear.md" })).toBe("style");
    expect(styleRoleOf({ role: "style" })).toBe("style");
    expect(styleRoleOf({ role: "document" })).toBe("document");
    expect(styleRoleOf(undefined)).toBe("style");
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
    // The Generate composer's header reads the same hint.
    expect(selectionHint([{ id: "i", kind: "image" }, { id: "s", kind: "style", file: "a.md" }], [])).toBe("1 selected");
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
