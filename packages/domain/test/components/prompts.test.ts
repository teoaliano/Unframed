import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPONENT_READ_SHAPE_ID,
  COMPONENT_READ_TEXT,
  COMPONENT_WRITE_ARGUMENTS,
  COMPONENT_WRITE_TEXT,
  MAKE_COMPONENT_TEMPLATE,
  makeComponentInstruction,
} from "../../src/index.ts";

const prompts = join(import.meta.dirname, "../../../../assets/prompts");
const read = (file: string) => readFileSync(join(prompts, file), "utf8");

const block = (file: string): string => /^(`{3,})text\n([\s\S]*?)\n\1$/m.exec(read(file))![2]!;

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

describe("makeComponentInstruction (spec 20, Make component)", () => {
  it("fills the kind and the title into the asset's placeholders", () => {
    expect(makeComponentInstruction("page", "Landing")).toBe(
      'Make a component from the element attached to this message, in the page "Landing". Write it with component_write: its markup as the template, its styles in the project\'s tokens when it has a kit, a variant for each visible difference among the similar elements in this page, and a text property for each piece of text that differs between them. Then replace that element, and each of its look-alikes in this page, with an instance of the new component, keeping the element\'s data-hf-id on the instance that replaces it. Change nothing else in the page.',
    );
  });

  it("writes a title with $ patterns as typed", () => {
    expect(makeComponentInstruction("page", "Price $& $1 $$")).toContain('in the page "Price $& $1 $$"');
  });
});
