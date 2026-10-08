import { describe, expect, it } from "vitest";
import { createResolver, resolveReferences } from "../src/index.ts";
import { group, image, prompt, textResult, video } from "./shapes.ts";

describe("resolving @id references", () => {
  const board = [
    prompt("100", "lone red fox"),
    prompt("101", "A @100 on a cliff"),
    prompt("102", "@101, cinematic, @100 again"),
    image("103", "fox.png"),
  ];

  it.each([
    ["a prompt resolves to its own text", "Show @100.", "Show lone red fox."],
    ["references resolve recursively", "@102", "A lone red fox on a cliff, cinematic, lone red fox again"],
    ["an unknown token is left exactly as typed", "at @golden-hour and @golden_hour", "at @golden-hour and @golden_hour"],
    ["an image's ref is not a reference target", "like @103", "like @103"],
    ["a token is @ then word characters and hyphens", "@100's tail", "lone red fox's tail"],
    ["text without tokens is unchanged", "a plain line\n\nand another", "a plain line\n\nand another"],
  ])("%s", (_case, text, expected) => {
    expect(resolveReferences(text, board)).toEqual({ ok: true, text: expected });
  });

  it("resolves against every prompt on the canvas, not only a selection", () => {
    expect(resolveReferences("@101", board, "999")).toEqual({ ok: true, text: "A lone red fox on a cliff" });
  });

  it("asks the attach rule what an image or video stands for, and leaves it as typed when the rule has no answer", () => {
    const shapes = [...board, video("104", { file: "waves.mp4" }), image("105", undefined)];
    const asked: string[] = [];
    const resolver = createResolver(shapes, (shape) => {
      asked.push(shape.id);
      return shape.file === undefined ? undefined : `${shape.kind} ${asked.length}`;
    });
    expect(resolver.resolve("@103, @104 and @105")).toEqual({ ok: true, text: "image 1, video 2 and @105" });
    expect(asked).toEqual(["103", "104", "105"]);
  });
});

describe("circular references", () => {
  it.each([
    ["two prompts that name each other", [prompt("a", "see @b"), prompt("b", "see @a")], "@a", undefined, "Circular reference: a -> b -> a"],
    ["a prompt that names itself", [prompt("a", "me @a")], "@a", undefined, "Circular reference: a -> a"],
    ["a loop entered from the middle", [prompt("a", "@b"), prompt("b", "@c"), prompt("c", "@b")], "@a", undefined, "Circular reference: b -> c -> b"],
    ["a prompt's own text naming itself through another", [prompt("a", "@b"), prompt("b", "@a")], "@b", "a", "Circular reference: a -> b -> a"],
  ])("%s fails with the ids along the loop", (_case, shapes, text, self, message) => {
    expect(resolveReferences(text, shapes, self)).toEqual({ ok: false, error: message });
  });

  it("a reference used twice without a loop is not a cycle", () => {
    expect(resolveReferences("@a @a", [prompt("a", "@b and @b"), prompt("b", "x")])).toEqual({ ok: true, text: "x and x x and x" });
  });
});

describe("text results", () => {
  it("are inserted literally and never re-scanned for tokens", () => {
    const shapes = [textResult("answer", "call @100 and @answer"), prompt("100", "SHOULD NOT APPEAR")];
    expect(resolveReferences("The model said: @answer", shapes)).toEqual({ ok: true, text: "The model said: call @100 and @answer" });
  });

  it("end a reference loop that runs through them", () => {
    const shapes = [prompt("a", "ask @r"), textResult("r", "then @a")];
    expect(resolveReferences("@a", shapes)).toEqual({ ok: true, text: "ask then @a" });
  });
});

describe("groups", () => {
  const board = [
    group("character", { x: 0, y: 0 }),
    prompt("p2", "second, lower", { x: 20, y: 200, parent: "character" }),
    prompt("p1", "  first, higher  ", { x: 200, y: 60, parent: "character" }),
    textResult("t1", "a text result", { x: 20, y: 250, parent: "character" }),
    prompt("empty", "   ", { x: 20, y: 120, parent: "character" }),
    image("img", "fox.png", { x: 20, y: 80, parent: "character" }),
    prompt("outside", "not a member", { x: 900, y: 0 }),
    prompt("ref", "see @p1"),
  ];

  it("resolve to their prompt and text-result members in box order, trimmed, empties dropped, never media", () => {
    expect(resolveReferences("@character", board)).toEqual({ ok: true, text: "first, higher\n\nsecond, lower\n\na text result" });
  });

  it("resolve their members' own references", () => {
    const shapes = [group("g"), prompt("m", "a @x", { parent: "g" }), prompt("x", "fox")];
    expect(resolveReferences("@g", shapes)).toEqual({ ok: true, text: "a fox" });
  });

  it("fail as a cycle when a member names the group", () => {
    const shapes = [group("g"), prompt("m", "inside @g", { parent: "g" })];
    expect(resolveReferences("@g", shapes)).toEqual({ ok: false, error: "Circular reference: g -> m -> g" });
  });
});
