import { describe, expect, it } from "vitest";
import { freeSource, splitList, type CanvasShape } from "../src/index.ts";
import { group, image, mark, prompt, textResult } from "./shapes.ts";

const sourceOf = (shapes: CanvasShape[], selected: string[] = shapes.map((shape) => shape.id)) => freeSource({ shapes, selected });

describe("the Free source", () => {
  it.each<[string, CanvasShape[], string[] | undefined, string | undefined]>([
    ["the only prompt", [prompt("p", "a fox\n---\na wolf")], undefined, "p"],
    ["the topmost prompt when there is no text result", [prompt("low", "low", { y: 300 }), prompt("high", "high", { y: 10 })], undefined, "high"],
    [
      "a text result over a prompt above it",
      [prompt("context", "in watercolour", { y: 0 }), textResult("list", "a fox\n---\na wolf", { y: 400 })],
      undefined,
      "list",
    ],
    [
      "the topmost of several text results",
      [textResult("second", "b", { y: 500 }), textResult("first", "a", { y: 100 }), prompt("p", "c", { y: 0 })],
      undefined,
      "first",
    ],
    [
      "a member of a selected group, walked in place",
      [prompt("above", "above", { y: 0 }), group("g", { y: 100 }), textResult("member", "a\n---\nb", { y: 150, parent: "g" })],
      ["above", "g"],
      "member",
    ],
    ["a group's first prompt, never the group", [group("g", { y: 0 }), prompt("inside", "a fox", { y: 50, parent: "g" })], ["g"], "inside"],
    ["an empty prompt is still the source", [prompt("empty", "   "), image("i", "i.png")], undefined, "empty"],
    ["nothing when no prompt is selected", [image("i", "i.png"), mark("m")], undefined, undefined],
    ["nothing when the prompt is not selected", [prompt("p", "a fox"), image("i", "i.png")], ["i"], undefined],
  ])("is %s", (_case, shapes, selected, id) => {
    expect(sourceOf(shapes, selected).source?.id).toBe(id);
  });
});

describe("the Free list text", () => {
  it("expands a prompt's references before splitting", () => {
    const shapes = [prompt("list", "@animals\n---\na hare", { y: 0 }), prompt("animals", "a fox\n---\na wolf", { y: 900 })];
    const found = sourceOf(shapes, ["list"]);
    expect(found.text).toBe("@animals\n---\na hare");
    expect(found.listText).toBe("a fox\n---\na wolf\n---\na hare");
    expect(splitList(found.listText).sections).toEqual(["a fox", "a wolf", "a hare"]);
    expect(found.error).toBeUndefined();
  });

  it("expands a group reference to its members' text", () => {
    const shapes = [prompt("list", "three of @cast", { y: 0 }), group("cast", { y: 500 }), prompt("m", "a fox", { y: 550, parent: "cast" })];
    expect(sourceOf(shapes, ["list"]).listText).toBe("three of a fox");
  });

  it("reads a text result verbatim, its @ tokens never re-scanned", () => {
    const shapes = [textResult("answer", "draw @subject\n---\ndraw @subject again", { y: 0 }), prompt("subject", "a fox", { y: 900 })];
    const found = sourceOf(shapes, ["answer"]);
    expect(found.listText).toBe("draw @subject\n---\ndraw @subject again");
    expect(found.text).toBe(found.listText);
  });

  it.each<[string, CanvasShape[], string]>([
    ["a reference to the source itself", [prompt("list", "a fox\n---\n@list again")], "Circular reference: list -> list"],
    [
      "a loop back through another prompt",
      [prompt("list", "a fox\n---\n@other", { y: 0 }), prompt("other", "like @list", { y: 900 })],
      "Circular reference: list -> other -> list",
    ],
  ])("fails %s as a cycle", (_case, shapes, error) => {
    const found = sourceOf(shapes, ["list"]);
    expect(found.source?.id).toBe("list");
    expect(found.error).toBe(error);
    expect(found.listText).toBe("");
  });

  it("has no text without a source", () => {
    expect(sourceOf([image("i", "i.png")])).toEqual({ text: "", listText: "" });
  });
});
