import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KIT_OPS_DESCRIPTION, KIT_READ_DESCRIPTION, KIT_WRITE_DESCRIPTION } from "../../src/index.ts";

/** Spec 19: the kit tools' model-facing text is the asset's text. */

const blocks = (file: string): string[] => {
  const text = readFileSync(join(import.meta.dirname, "../../../../assets/prompts", file), "utf8");
  return [...text.matchAll(/^(`{3,})text\n([\s\S]*?)\n\1$/gm)].map((match) => match[2]!);
};

describe("the kit tools' model-facing text is the assets' text", () => {
  it("holds kit_read's and kit_write's descriptions and the ops argument", () => {
    expect([KIT_READ_DESCRIPTION, KIT_WRITE_DESCRIPTION, KIT_OPS_DESCRIPTION]).toEqual(blocks("kit-tools.md"));
  });
});
