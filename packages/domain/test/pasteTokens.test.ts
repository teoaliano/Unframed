import { describe, expect, it } from "vitest";
import { rewriteRichTextTokens, rewriteTokensOnPaste } from "../src/index.ts";

const ids = new Map([
  ["100", "120"],
  ["101", "121"],
]);

describe("rewriteTokensOnPaste", () => {
  it("rewrites a token that names a pasted shape to that shape's new ref", () => {
    expect(rewriteTokensOnPaste(["A @100 on a cliff"], ids)).toEqual(["A @120 on a cliff"]);
  });

  it("rewrites whole tokens only", () => {
    expect(rewriteTokensOnPaste(["@1000 and @100x and @100-b but @100."], ids)).toEqual([
      "@1000 and @100x and @100-b but @120.",
    ]);
  });

  it("leaves unknown tokens exactly as typed", () => {
    expect(rewriteTokensOnPaste(["@fox then @999 then @ alone"], ids)).toEqual(["@fox then @999 then @ alone"]);
  });

  it("rewrites every token in every text, each against the original refs", () => {
    expect(rewriteTokensOnPaste(["@100 @101", "@101@100"], ids)).toEqual(["@120 @121", "@121@120"]);
  });

  it("does not chain: a new ref that is also an old one is not rewritten again", () => {
    const swap = new Map([
      ["100", "101"],
      ["101", "102"],
    ]);
    expect(rewriteTokensOnPaste(["@100 @101"], swap)).toEqual(["@101 @102"]);
  });

  it("takes a plain object as the id map too", () => {
    expect(rewriteTokensOnPaste(["@100"], { "100": "130" })).toEqual(["@130"]);
  });
});

describe("rewriteRichTextTokens", () => {
  it("rewrites the tokens inside every text node and keeps the rest of the document", () => {
    const richText = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A @100 " }, { type: "text", text: "@101", marks: [{ type: "bold" }] }] },
        { type: "paragraph" },
      ],
    };
    expect(rewriteRichTextTokens(richText, ids)).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A @120 " }, { type: "text", text: "@121", marks: [{ type: "bold" }] }] },
        { type: "paragraph" },
      ],
    });
  });
});
