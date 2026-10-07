import { describe, expect, it } from "vitest";
import { isMintedRef, planRename, refOnPaste, renamePlan, slugName, uniqueName } from "../src/index.ts";
import { artifact, group, image, mark, prompt, textResult, video } from "./shapes.ts";

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

describe("planRename", () => {
  const board = [
    group("g", {}, "fox"),
    group("h", {}, "vixen"),
    prompt("p", "@fox by the river, @102 in front, @104 behind", {}, "100"),
    textResult("t", "@fox and @102", {}, "101"),
    { ...image("i", "1-a.png"), ref: "102" },
    { ...video("v", { file: "1-a.mp4" }), ref: "103" },
    { ...artifact("pg", "page"), ref: "104" },
    { ...artifact("mo", "motion"), ref: "landing" },
    mark("m"),
  ];

  it("commits the slug, and every prompt that references the old name", () => {
    expect(planRename(board, "g", "Red Fox")).toEqual({ id: "g", kind: "group", from: "fox", to: "red-fox", rewrites: [{ id: "p", text: "@red-fox by the river, @102 in front, @104 behind" }] });
  });

  it("names a prompt, an image, a video, a page and a motion the same way", () => {
    expect(planRename(board, "p", "Scene")).toMatchObject({ id: "p", kind: "prompt", from: "100", to: "scene", rewrites: [] });
    expect(planRename(board, "i", "Hero shot")).toEqual({
      id: "i",
      kind: "image",
      from: "102",
      to: "hero-shot",
      rewrites: [{ id: "p", text: "@fox by the river, @hero-shot in front, @104 behind" }],
    });
    expect(planRename(board, "v", "waves")).toMatchObject({ kind: "video", from: "103", to: "waves" });
    expect(planRename(board, "pg", "Pricing")).toMatchObject({ kind: "page", from: "104", to: "pricing", rewrites: [{ id: "p", text: "@fox by the river, @102 in front, @pricing behind" }] });
    expect(planRename(board, "mo", "intro")).toMatchObject({ kind: "motion", from: "landing", to: "intro" });
  });

  it("gives a renamed page or motion its name as its title too, and nothing else a title", () => {
    expect(planRename(board, "pg", "Pricing")?.title).toBe("pricing");
    expect(planRename(board, "mo", "Intro")?.title).toBe("intro");
    expect(planRename(board, "i", "hero")?.title).toBeUndefined();
    expect(planRename(board, "g", "den")?.title).toBeUndefined();
  });

  it("never rewrites a text result, even when it is the shape renamed", () => {
    expect(planRename(board, "t", "answer")).toEqual({ id: "t", kind: "prompt", from: "101", to: "answer", rewrites: [] });
  });

  it("suffixes a name any @id on the canvas uses", () => {
    expect(planRename(board, "g", "Vixen")?.to).toBe("vixen-2");
    expect(planRename(board, "g", "100")?.to).toBe("100-2");
    expect(planRename(board, "g", "102")?.to).toBe("102-2");
    expect(planRename(board, "i", "landing")?.to).toBe("landing-2");
    expect(planRename(board, "p", "fox")?.to).toBe("fox-2");
  });

  it("changes nothing for an empty slug or the current name", () => {
    expect(planRename(board, "g", "  ")).toBeUndefined();
    expect(planRename(board, "g", "!!")).toBeUndefined();
    expect(planRename(board, "g", "FOX")).toBeUndefined();
    expect(planRename(board, "i", "@102")).toBeUndefined();
  });

  it("answers nothing for a mark or a shape that is not there", () => {
    expect(planRename(board, "m", "fox")).toBeUndefined();
    expect(planRename(board, "missing", "fox")).toBeUndefined();
  });
});

describe("isMintedRef", () => {
  it("is true for the counter's numbers and false for a name", () => {
    expect(isMintedRef("100")).toBe(true);
    expect(isMintedRef("hero")).toBe(false);
    expect(isMintedRef("100-2")).toBe(false);
    expect(isMintedRef("")).toBe(false);
  });
});

describe("refOnPaste", () => {
  let count = 200;
  const mint = () => String(count++);

  it("keeps a name, suffixed while the canvas holds it", () => {
    expect(refOnPaste("hero", new Set(["100"]), mint)).toBe("hero");
    expect(refOnPaste("hero", new Set(["hero", "hero-2"]), mint)).toBe("hero-3");
  });

  it("mints a fresh ref for a minted one, an empty one or none", () => {
    count = 200;
    expect(refOnPaste("100", new Set(), mint)).toBe("200");
    expect(refOnPaste("", new Set(), mint)).toBe("201");
    expect(refOnPaste(undefined, new Set(), mint)).toBe("202");
  });
});
