import { describe, expect, it } from "vitest";
import { freeBatch, parsePicks, runReferences, splitList, type CanvasShape, type Slot } from "../src/index.ts";
import * as shape from "./shapes.ts";

const image = (number: number): Slot => ({ kind: "image", number, shapeId: `shape:i${number}`, source: { type: "file", file: `i${number}.png` } });
const video = (number: number): Slot => ({ kind: "video", number, shapeId: `shape:v${number}`, source: { type: "file", file: `v${number}.mp4` } });

describe("list splitting", () => {
  it.each<[string, string, string[], number]>([
    ["sections between standalone separators", "a fox\n---\na wolf\n---\na hare", ["a fox", "a wolf", "a hare"], 0],
    ["a separator with spaces around it", "a fox\n  ---  \na wolf", ["a fox", "a wolf"], 0],
    ["--- inside prose is left alone", "a fox --- running\n----\na wolf", ["a fox --- running\n----\na wolf"], 0],
    ["each section trimmed", "\n\n  a fox  \n\n---\n\n a wolf \n", ["a fox", "a wolf"], 0],
    ["empty sections dropped", "---\na fox\n---\n   \n---\n---\na wolf\n---", ["a fox", "a wolf"], 0],
    ["no separator is one section", "three versions of a fox", ["three versions of a fox"], 0],
    ["nothing is no section", "  \n ", [], 0],
    ["Windows line ends", "a fox\r\n---\r\na wolf", ["a fox", "a wolf"], 0],
    ["a section keeps its own lines", "images: 1\na fox\nat dawn\n---\na wolf", ["images: 1\na fox\nat dawn", "a wolf"], 0],
  ])("%s", (_case, text, sections, truncated) => {
    expect(splitList(text)).toEqual({ sections, truncated });
  });

  it("keeps the first 10 and counts how many more there were", () => {
    const text = Array.from({ length: 13 }, (_, index) => `item ${index + 1}`).join("\n---\n");
    const split = splitList(text);
    expect(split.sections).toEqual(Array.from({ length: 10 }, (_, index) => `item ${index + 1}`));
    expect(split.truncated).toBe(3);
  });

  it("counts truncation after empty sections are dropped", () => {
    const text = ["", ...Array.from({ length: 11 }, (_, index) => `item ${index + 1}`)].join("\n---\n");
    expect(splitList(text).truncated).toBe(1);
  });
});

describe("pick parsing: which line is a directive", () => {
  it.each<[string, string, string, ReadonlyArray<number> | null]>([
    ["images: on the first line", "images: 2, 5\na fox", "a fox", [2, 5]],
    ["the singular", "image: 3\na fox", "a fox", [3]],
    ["any case, spaces around the colon", "IMAGES :  1\na fox", "a fox", [1]],
    ["no space after the colon", "Images:4\na fox", "a fox", [4]],
    ["the first non-empty line, past blank ones", "\n\n  images: 1  \na fox", "a fox", [1]],
    ["a caption is left alone", "Image: 3 women in a row", "Image: 3 women in a row", null],
    ["words after the numbers make it prose", "images: 1, 2 of the fox\na fox", "images: 1, 2 of the fox\na fox", null],
    ["words before it make it prose", "use images: 1, 2\na fox", "use images: 1, 2\na fox", null],
    ["only the first line is read", "a fox\nimages: 1, 2", "a fox\nimages: 1, 2", null],
    ["no colon is not a directive", "images 1 2\na fox", "images 1 2\na fox", null],
    ["a plural spelled differently is prose", "imgs: 1\na fox", "imgs: 1\na fox", null],
  ])("%s", (_case, section, text, picks) => {
    expect(parsePicks(section)).toEqual({ text, picks });
  });
});

describe("pick parsing: the numbers", () => {
  it.each<[string, string, string, ReadonlyArray<number> | null]>([
    ["commas", "images: 1,2,3\na fox", "a fox", [1, 2, 3]],
    ["spaces", "images: 1 2  3\na fox", "a fox", [1, 2, 3]],
    ["commas and spaces", "images: 4, 1 ,2\na fox", "a fox", [4, 1, 2]],
    ["duplicates collapsed, first-listed order kept", "images: 3, 1, 3, 1, 2\na fox", "a fox", [3, 1, 2]],
    ["zero is not a pick", "images: 0, 2\na fox", "a fox", [2]],
    ["a negative is not a pick", "images: -1, 2\na fox", "a fox", [2]],
    ["the line stays when no number is usable", "images: 0\na fox", "images: 0\na fox", null],
    ["the line stays for negatives only", "images: -2, 0\na fox", "images: -2, 0\na fox", null],
  ])("%s", (_case, section, text, picks) => {
    expect(parsePicks(section)).toEqual({ text, picks });
  });
});

describe("slot expansion", () => {
  it.each<[string, string, string, ReadonlyArray<number> | null]>([
    ["with a directive", "images: 1, 3\nApply the style of [1] to [2].", "Apply the style of image 1 to image 2.", [1, 3]],
    ["without a directive", "Apply the style of [1] to [2], twice [2].", "Apply the style of image 1 to image 2, twice image 2.", null],
    ["a kept directive line is expanded too", "images: 0\nsee [1]", "images: 0\nsee image 1", null],
    ["several digits", "compare [12] and [3]", "compare image 12 and image 3", null],
    ["only digits in brackets", "keep [a] and [ 1 ] and [1a] as typed", "keep [a] and [ 1 ] and [1a] as typed", null],
  ])("%s", (_case, section, text, picks) => {
    expect(parsePicks(section)).toEqual({ text, picks });
  });
});

describe("run references", () => {
  // Images and videos interleaved as the composition numbers them: image 1, video 1, image 2, image 3, video 2.
  const slots = [image(1), video(1), image(2), image(3), video(2)];

  it("sends every slot in order when the section picks nothing", () => {
    expect(runReferences(slots, null)).toEqual({ references: slots, used: null, dropped: [] });
  });

  it("sends the picked images in listed order, then every video", () => {
    expect(runReferences(slots, [3, 1])).toEqual({ references: [image(3), image(1), video(1), video(2)], used: [3, 1], dropped: [] });
  });

  it("drops numbers that name no image and reports them", () => {
    expect(runReferences(slots, [2, 5, 9])).toEqual({ references: [image(2), video(1), video(2)], used: [2], dropped: [5, 9] });
  });

  it("falls back to every slot when every number misses", () => {
    expect(runReferences(slots, [4, 7])).toEqual({ references: slots, used: null, dropped: [4, 7] });
  });

  it("counts images only: a pick never names a video", () => {
    expect(runReferences([video(1), image(1)], [2])).toEqual({ references: [video(1), image(1)], used: null, dropped: [2] });
  });

  it("with nothing selected every pick misses", () => {
    expect(runReferences([], [1])).toEqual({ references: [], used: null, dropped: [1] });
  });
});

describe("Free batch: assembling each run", () => {
  const batchOf = (shapes: CanvasShape[], sourceId: string, listText: string, instruction = "", selected = shapes.map((shape) => shape.id)) =>
    freeBatch({ shapes, selected, instruction, sourceId, listText });

  it("runs the shared context, then the section, then the instruction", () => {
    const shapes = [shape.prompt("context", "in watercolour", { y: 0 }), shape.prompt("list", "a fox\n---\na wolf", { y: 100 })];
    const batch = batchOf(shapes, "list", "a fox\n---\na wolf", "at dawn");
    expect(batch.shared).toBe("in watercolour");
    expect(batch.error).toBeUndefined();
    expect(batch.runs.map((run) => run.prompt)).toEqual(["in watercolour\n\na fox\n\nat dawn", "in watercolour\n\na wolf\n\nat dawn"]);
    expect(batch.runs.map((run) => run.selectionPrompt)).toEqual(["in watercolour\n\na fox", "in watercolour\n\na wolf"]);
  });

  it("blanks the source, so a reference to it resolves to nothing", () => {
    const shapes = [shape.prompt("context", "@list\nin watercolour", { y: 0 }), shape.prompt("list", "a fox\n---\na wolf", { y: 100 })];
    const batch = batchOf(shapes, "list", "a fox\n---\na wolf", "more @list");
    expect(batch.shared).toBe("in watercolour");
    expect(batch.runs[0]!.prompt).toBe("in watercolour\n\na fox\n\nmore");
  });

  it("blanks a text result source too", () => {
    const shapes = [shape.textResult("answer", "a fox\n---\na wolf", { y: 0 }), shape.prompt("style", "in ink", { y: 200 })];
    const batch = batchOf(shapes, "answer", "a fox\n---\na wolf");
    expect(batch.shared).toBe("in ink");
    expect(batch.runs.map((run) => run.prompt)).toEqual(["in ink\n\na fox", "in ink\n\na wolf"]);
  });

  it("leaves out whatever part is empty", () => {
    const batch = batchOf([shape.prompt("list", "a fox\n---\na wolf")], "list", "a fox\n---\na wolf");
    expect(batch.shared).toBe("");
    expect(batch.runs.map((run) => run.prompt)).toEqual(["a fox", "a wolf"]);
  });

  it("gives each run its own references", () => {
    const shapes = [
      shape.prompt("list", "", { y: 0 }),
      shape.image("style", "style.png", { y: 100 }),
      shape.image("subject", "subject.png", { y: 200 }),
      shape.video("clip", { file: "clip.mp4" }, { y: 300 }),
    ];
    const batch = batchOf(shapes, "list", "images: 2\n[1] alone\n---\nall of them\n---\nimages: 1, 7\nstyle only");
    expect(batch.runs.map((run) => run.references.map((slot) => `${slot.kind} ${slot.number}`))).toEqual([
      ["image 2", "video 1"],
      ["image 1", "image 2", "video 1"],
      ["image 1", "video 1"],
    ]);
    expect(batch.runs.map((run) => run.prompt)).toEqual(["image 1 alone", "all of them", "style only"]);
    expect(batch.runs.map((run) => [run.used, run.dropped])).toEqual([
      [[2], []],
      [null, []],
      [[1], [7]],
    ]);
  });

  it("resolves a prompt source's references in the list and reports a cycle, with no runs", () => {
    const shapes = [shape.prompt("list", "a fox"), shape.prompt("subject", "a wolf", { y: 900 })];
    expect(batchOf(shapes, "list", "@subject\n---\na hare", "", ["list"]).runs.map((run) => run.prompt)).toEqual(["a wolf", "a hare"]);
    const looped = batchOf(shapes, "list", "a fox\n---\n@list", "", ["list"]);
    expect(looped.error).toBe("Circular reference: list -> list");
    expect(looped.runs).toEqual([]);
  });

  it("reads a text result source's list literally", () => {
    const shapes = [shape.textResult("answer", "x"), shape.prompt("subject", "a wolf", { y: 900 })];
    expect(batchOf(shapes, "answer", "@subject\n---\n@answer", "", ["answer"]).runs.map((run) => run.prompt)).toEqual(["@subject", "@answer"]);
  });

  it("says when the source is no longer selected", () => {
    const shapes = [shape.prompt("list", "a fox\n---\na wolf"), shape.image("i", "i.png", { y: 300 })];
    const batch = batchOf(shapes, "list", "a fox\n---\na wolf", "", ["i"]);
    expect(batch.error).toBe("The list source is no longer selected.");
    expect(batch.runs).toEqual([]);
    expect(batchOf(shapes.slice(1), "list", "a fox", "", ["i"]).error).toBe("The list source is no longer selected.");
  });

  it("drops a section that is only an images: line and counts it, after counting truncation", () => {
    const sections = Array.from({ length: 12 }, (_, index) => (index === 1 || index === 11 ? "images: 1" : `item ${index + 1}`));
    const shapes = [shape.prompt("list", ""), shape.image("i", "i.png", { y: 200 })];
    const batch = batchOf(shapes, "list", sections.join("\n---\n"));
    expect(batch.truncated).toBe(2);
    expect(batch.empty).toBe(1);
    expect(batch.runs.map((run) => run.prompt)).toEqual(["item 1", "item 3", "item 4", "item 5", "item 6", "item 7", "item 8", "item 9", "item 10"]);
  });

  it("keeps a section whose directive line had no usable number", () => {
    const batch = batchOf([shape.prompt("list", "")], "list", "images: 0\n---\na wolf");
    expect(batch.empty).toBe(0);
    expect(batch.runs.map((run) => run.prompt)).toEqual(["images: 0", "a wolf"]);
  });

  it("reports a cycle in the shared context", () => {
    const shapes = [shape.prompt("loop", "@loop again", { y: 0 }), shape.prompt("list", "a fox\n---\na wolf", { y: 100 })];
    expect(batchOf(shapes, "list", "a fox\n---\na wolf").error).toBe("Circular reference: loop -> loop");
  });
});
