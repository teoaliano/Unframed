import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPONENT_READ_SHAPE_ID,
  COMPONENT_READ_TEXT,
  COMPONENT_WRITE_ARGUMENTS,
  COMPONENT_WRITE_TEXT,
  MAKE_COMPONENT_TEMPLATE,
} from "../../src/index.ts";

/** Spec 20: the component tools' model-facing text is the assets' text. */

const prompts = join(import.meta.dirname, "../../../../assets/prompts");
const read = (file: string) => readFileSync(join(prompts, file), "utf8");

/** The first fenced `text` block of a prompt asset. */
const block = (file: string): string => /^(`{3,})text\n([\s\S]*?)\n\1$/m.exec(read(file))![2]!;

/** A file's `## Arguments` bullets. */
const args = (file: string): Record<string, string> =>
  Object.fromEntries([...read(file).split("## Arguments")[1]!.matchAll(/^- `([^`]+)`: (.*)$/gm)].map((match) => [match[1]!, match[2]!]));

describe("the component tools' model-facing text is the assets' text", () => {
  it("holds the write and read descriptions and the make-component instruction", () => {
    expect(COMPONENT_WRITE_TEXT).toBe(block("component-write-tool.md"));
    expect(COMPONENT_READ_TEXT).toBe(block("component-read-tool.md"));
    expect(MAKE_COMPONENT_TEMPLATE).toBe(block("make-component-instruction.md"));
  });

  it("holds the write arguments and the read argument", () => {
    expect(COMPONENT_WRITE_ARGUMENTS).toEqual({ html: args("component-write-tool.md").html, shapeId: args("component-write-tool.md").shapeId, title: args("component-write-tool.md").title });
    expect(COMPONENT_READ_SHAPE_ID).toBe(args("component-read-tool.md").shapeId);
  });

  it("names the four sheet parts and the limits in the write description", () => {
    for (const part of ["data-uf-component>", "data-uf-component-style>", "data-uf-template hidden>", "data-uf-example hidden>"]) expect(COMPONENT_WRITE_TEXT).toContain(part);
    expect(COMPONENT_WRITE_TEXT).toContain("at most 4 variants");
  });
});
