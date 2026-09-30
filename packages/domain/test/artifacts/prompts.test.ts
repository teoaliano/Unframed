import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADD_PARAMETER_TEMPLATE,
  ARTIFACT_PERFORMANCE,
  DIALS_CONTRACT,
  DIALS_TIMELINE,
  MOTION_READ_SHAPE_ID,
  MOTION_READ_TEXT,
  MOTION_WRITE_ARGUMENTS,
  MOTION_WRITE_TEXT,
  PAGE_READ_SHAPE_ID,
  PAGE_READ_TEXT,
  PAGE_WRITE_ARGUMENTS,
  PAGE_WRITE_TEXT,
  PREVIEW_TOOL_TEXT,
} from "../../src/index.ts";

const prompts = join(import.meta.dirname, "../../../../assets/prompts");
const read = (file: string) => readFileSync(join(prompts, file), "utf8");

/** Every fenced `text` block of a prompt asset, in order. */
const blocks = (file: string): string[] => [...read(file).matchAll(/^(`{3,})text\n([\s\S]*?)\n\1$/gm)].map((match) => match[2]!);

/** A file's `## ` sections, each with its text block and its `- \`arg\`: description` bullets. */
const sections = (file: string) =>
  read(file)
    .split(/^## /m)
    .slice(1)
    .map((part) => ({
      name: part.split("\n")[0]!.trim(),
      text: /^(`{3,})text\n([\s\S]*?)\n\1$/m.exec(part)?.[2],
      args: Object.fromEntries([...part.matchAll(/^- `([^`]+)`: (.*)$/gm)].map((match) => [match[1]!, match[2]!])),
    }));

describe("the artifact tools' model-facing text is the assets' text", () => {
  it("holds the write descriptions, the dials paragraphs and the performance paragraph", () => {
    expect(PAGE_WRITE_TEXT).toBe(blocks("page-write-tool.md")[0]);
    expect(MOTION_WRITE_TEXT).toBe(blocks("motion-write-tool.md")[0]);
    expect(DIALS_CONTRACT).toBe(blocks("dials-contract.md")[0]);
    expect(DIALS_TIMELINE).toBe(blocks("dials-timeline.md")[0]);
    expect(ARTIFACT_PERFORMANCE).toBe(blocks("artifact-performance.md")[0]);
    expect(ADD_PARAMETER_TEMPLATE).toBe(blocks("add-parameter-instruction.md")[0]);
  });

  it("holds the write arguments and the read tools", () => {
    expect(PAGE_WRITE_ARGUMENTS).toEqual(sections("page-write-tool.md").find((section) => section.name === "Arguments")!.args);
    expect(MOTION_WRITE_ARGUMENTS).toEqual(sections("motion-write-tool.md").find((section) => section.name === "Arguments")!.args);
    const [page, motion] = sections("artifact-read-tools.md");
    expect([PAGE_READ_TEXT, PAGE_READ_SHAPE_ID]).toEqual([page!.text, page!.args.shapeId]);
    expect([MOTION_READ_TEXT, MOTION_READ_SHAPE_ID]).toEqual([motion!.text, motion!.args.shapeId]);
  });

  it("holds all twelve preview tools and their arguments", () => {
    const expected = Object.fromEntries(sections("preview-tool-descriptions.md").map((section) => [section.name, { description: section.text, arguments: section.args }]));
    expect(Object.keys(expected)).toHaveLength(12);
    expect(PREVIEW_TOOL_TEXT).toEqual(expected);
  });
});
