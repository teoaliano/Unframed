import { describe, expect, it } from "vitest";
import { resultLine, selectionHint, toolbarState, type ToolbarShape } from "../src/index.ts";

const promptShape: ToolbarShape = { id: "p", kind: "prompt" };
const emptyImage: ToolbarShape = { id: "e", kind: "image" };
const result = (id: string, batchId = `b-${id}`, cost: number | null = 0.1, extra: Partial<ToolbarShape> = {}): ToolbarShape => ({
  id,
  kind: "image",
  result: { batchId, cost },
  ...extra,
});

describe("the toolbar's state", () => {
  it.each<[string, ReadonlyArray<ToolbarShape>, boolean, unknown]>([
    ["nothing selected: no bar", [], false, { kind: "none" }],
    ["exactly one result: its actions", [result("r")], true, { kind: "result", shapeId: "r", vary: true }],
    [
      "exactly one text result: no Vary",
      [result("t", "b-t", 0.01, { kind: "prompt", textResult: true })],
      true,
      { kind: "result", shapeId: "t", vary: false },
    ],
    ["exactly one result still generating", [result("r", "b-r", null, { generating: true })], true, { kind: "generating", shapeId: "r" }],
    ["exactly one page with a file: Open", [{ id: "a", kind: "page", file: "a.html" }], false, { kind: "open", shapeId: "a" }],
    ["exactly one motion with a file: Open", [{ id: "m", kind: "motion", file: "m.html" }], false, { kind: "open", shapeId: "m" }],
    ["an empty page is not opened", [{ id: "a", kind: "page" }], false, { kind: "agent" }],
    ["a usable selection: Generate with the count", [promptShape, emptyImage], true, { kind: "generate", hint: "2 selected" }],
    ["a usable single prompt", [promptShape], true, { kind: "generate", hint: "1 selected" }],
    ["exactly one group: its name", [{ id: "g", kind: "group", ref: "character" }], true, { kind: "generate", hint: "@character" }],
    ["an unusable selection: Agent only", [emptyImage], false, { kind: "agent" }],
    ["a result among other shapes is a plain selection", [result("r"), promptShape], true, { kind: "generate", hint: "2 selected" }],
  ])("%s", (_case, selected, usable, expected) => {
    expect(toolbarState({ selected, usable, results: selected.filter((shape) => shape.result) })).toEqual(expected);
  });
});

describe("the selection hint", () => {
  const batch = [result("a", "b-1", 0.168), result("b", "b-1", 0.168), result("c", "b-1", 0.168), result("d", "b-1", 0.168)];

  it("reads the batch's count and total when the selection is exactly every member of one batch", () => {
    expect(selectionHint(batch, [...batch, result("x", "b-2")])).toBe("4 images · $0.6720");
  });

  it("counts a batch's extra cost once", () => {
    const members = [result("a", "b-1", 0.1, { result: { batchId: "b-1", cost: 0.1, batchExtraCost: 0.002 } }), result("b", "b-1", 0.1, { result: { batchId: "b-1", cost: 0.1, batchExtraCost: 0.002 } })];
    expect(selectionHint(members, members)).toBe("2 images · $0.2020");
  });

  it("drops the total when no member's cost is known", () => {
    const members = [result("a", "b-1", null), result("b", "b-1", null)];
    expect(selectionHint(members, members)).toBe("2 images");
  });

  it("is a plain count for part of a batch, a lone result or a mixed selection", () => {
    expect(selectionHint(batch.slice(0, 3), batch)).toBe("3 selected");
    expect(selectionHint([batch[0]!], [batch[0]!])).toBe("1 selected");
    expect(selectionHint([result("a", "b-1"), result("b", "b-2")], [result("a", "b-1"), result("b", "b-2")])).toBe("2 selected");
  });
});

describe("a result's line", () => {
  it.each([
    ["every part", { model: "openai/gpt-image-2", width: 1024, height: 1536, cost: 0.19 }, "gpt-image-2 · 1024×1536 · $0.1900"],
    ["no cost", { model: "openai/gpt-image-2", width: 1024, height: 1024, cost: null }, "gpt-image-2 · 1024×1024"],
    ["no size", { model: "google/gemini-3-pro-image", cost: 0.0421 }, "gemini-3-pro-image · $0.0421"],
    ["a model with no provider prefix", { model: "local", cost: null }, "local"],
    ["a slug with more slashes keeps all after the first", { model: "a/b/c", cost: 0 }, "b/c · $0.0000"],
  ])("%s", (_case, facts, line) => {
    expect(resultLine(facts)).toBe(line);
  });
});
