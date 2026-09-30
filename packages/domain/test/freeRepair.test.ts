import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { repairSystemPrompt, repairUserTurn } from "../src/index.ts";

/** The two text blocks of the asset, exactly as written there. */
const assetBlocks = async () => {
  const text = await readFile(new URL("../../../assets/prompts/free-repair.md", import.meta.url), "utf8");
  const blocks = [...text.matchAll(/```text\n([\s\S]*?)\n```/g)].map((match) => match[1]!);
  if (blocks.length !== 2) throw new Error("free-repair.md no longer has its two text blocks");
  return { base: blocks[0]!, images: blocks[1]! };
};

describe("the Free repair prompt", () => {
  it("is the asset's base block alone when no image is selected", async () => {
    const { base } = await assetBlocks();
    expect(repairSystemPrompt(0)).toBe(base);
  });

  it("appends the image block with the count filled in", async () => {
    const { base, images } = await assetBlocks();
    expect(repairSystemPrompt(3)).toBe(`${base}\n${images.replaceAll("<N>", "3")}`);
    expect(repairSystemPrompt(3)).toContain("\n\n3 reference images are attached, numbered 1 to 3.\n");
  });

  it("agrees in number for a single image", async () => {
    const { base, images } = await assetBlocks();
    const singular = images.replace("<N> reference images are attached, numbered 1 to <N>.", "1 reference image is attached, numbered 1 to 1.");
    expect(repairSystemPrompt(1)).toBe(`${base}\n${singular}`);
  });

  it("puts the text in the user turn behind its label", () => {
    expect(repairUserTurn("three versions of a fox")).toBe("Text to rewrite:\n\nthree versions of a fox");
  });
});
