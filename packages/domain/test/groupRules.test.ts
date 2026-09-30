import { describe, expect, it } from "vitest";
import { planGroupRename, renamePlan, slugName, uniqueName } from "../src/index.ts";
import { group, image, prompt, textResult } from "./shapes.ts";

describe("slugName", () => {
  it.each([
    ["a typed name becomes lowercase words joined by hyphens", "Red Fox", "red-fox"],
    ["runs of other characters collapse to one hyphen", "  hero__shot!!  v2 ", "hero-shot-v2"],
    ["a name that is already a slug is kept", "character", "character"],
    ["nothing a prompt can reference is left: empty", "!!!", ""],
    ["an @ typed in front is not part of the name", "@fox", "fox"],
    ["spec 01's 40-character cap", "a".repeat(50), "a".repeat(40)],
  ])("%s", (_case, typed, slug) => {
    expect(slugName(typed)).toBe(slug);
  });
});

describe("uniqueName", () => {
  it.each<[string, string, string[], string]>([
    ["a free name is kept", "fox", ["100", "character"], "fox"],
    ["a taken name gets -2", "fox", ["fox"], "fox-2"],
    ["the suffix counts up until the name is free", "fox", ["fox", "fox-2", "fox-3"], "fox-4"],
    ["a gap is not filled below the first free suffix", "fox", ["fox", "fox-3"], "fox-2"],
    ["only an exact match takes a name", "fox", ["foxes", "fox-x"], "fox"],
  ])("%s", (_case, wanted, taken, expected) => {
    expect(uniqueName(wanted, taken)).toBe(expected);
  });
});

describe("renamePlan", () => {
  it("rewrites every whole @old token in prompts, leaving longer tokens that start with it", () => {
    const shapes = [
      prompt("a", "a portrait of @fox in the snow"),
      prompt("b", "@fox and @fox again, but not @fox-2 or @foxes"),
      prompt("c", "nothing to see"),
      prompt("d", "email me at hi@fox, or @fox."),
    ];
    expect(renamePlan(shapes, "fox", "red-fox")).toEqual([
      { id: "a", text: "a portrait of @red-fox in the snow" },
      { id: "b", text: "@red-fox and @red-fox again, but not @fox-2 or @foxes" },
      { id: "d", text: "email me at hi@red-fox, or @red-fox." },
    ]);
  });

  it("never rewrites a text result, whose text is a model's answer", () => {
    const shapes = [textResult("t", "the answer mentions @fox"), prompt("p", "@fox")];
    expect(renamePlan(shapes, "fox", "vixen")).toEqual([{ id: "p", text: "@vixen" }]);
  });

  it("only prompts hold text to rewrite", () => {
    expect(renamePlan([group("g", {}, "fox"), image("i", "1-fox.png")], "fox", "vixen")).toEqual([]);
  });
});

describe("planGroupRename", () => {
  const board = [
    group("g", {}, "fox"),
    group("h", {}, "vixen"),
    prompt("p", "@fox by the river", {}, "100"),
    textResult("t", "@fox", {}, "101"),
    { ...image("i", "1-a.png"), ref: "102" },
  ];

  it("commits the slug, and every prompt that references the old name", () => {
    expect(planGroupRename(board, "g", "Red Fox")).toEqual({ groupId: "g", from: "fox", to: "red-fox", rewrites: [{ id: "p", text: "@red-fox by the river" }] });
  });

  it("suffixes a name any @id on the canvas uses", () => {
    expect(planGroupRename(board, "g", "Vixen")?.to).toBe("vixen-2");
    expect(planGroupRename(board, "g", "100")?.to).toBe("100-2");
    expect(planGroupRename(board, "g", "102")?.to).toBe("102-2");
  });

  it("changes nothing for an empty slug or the current name", () => {
    expect(planGroupRename(board, "g", "  ")).toBeUndefined();
    expect(planGroupRename(board, "g", "!!")).toBeUndefined();
    expect(planGroupRename(board, "g", "FOX")).toBeUndefined();
  });

  it("answers nothing for a shape that is not a group", () => {
    expect(planGroupRename(board, "p", "fox")).toBeUndefined();
    expect(planGroupRename(board, "missing", "fox")).toBeUndefined();
  });
});
