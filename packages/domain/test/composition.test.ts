import { describe, expect, it } from "vitest";
import { composeSelection, type CanvasShape, type CompositionInput } from "../src/index.ts";
import { artifact, group, image, mark, prompt, textResult, video } from "./shapes.ts";

const compose = (shapes: CanvasShape[], selected: string[], extra: Partial<CompositionInput> = {}) =>
  composeSelection({ shapes, selected, instruction: "", medium: "image", ...extra });

const DASH = "\u2014";

describe("prompt order and joining", () => {
  it.each([
    [
      "top edge decides the order, smallest first",
      [prompt("b", "second", { y: 200 }), prompt("a", "first", { y: 10 }), prompt("c", "third", { y: 400 })],
      ["first", "second", "third"],
    ],
    [
      "a tie on the top edge breaks by the left edge",
      [prompt("right", "right", { x: 300, y: 10 }), prompt("left", "left", { x: 10, y: 10 })],
      ["left", "right"],
    ],
    [
      "a tie on both edges breaks by z rank",
      [prompt("over", "over", { x: 10, y: 10, z: 9 }), prompt("under", "under", { x: 10, y: 10, z: 2 })],
      ["under", "over"],
    ],
    [
      "parts are trimmed and empty parts dropped",
      [prompt("a", "  padded  \n", { y: 0 }), prompt("b", "   ", { y: 50 }), prompt("c", "", { y: 90 }), prompt("d", "kept", { y: 100 })],
      ["padded", "kept"],
    ],
    [
      "a text result contributes its text literally",
      [textResult("t", "an answer with @a in it", { y: 0 }), prompt("a", "nope", { y: 500 })],
      ["an answer with @a in it", "nope"],
    ],
  ])("%s", (_case, shapes, parts) => {
    const composition = compose(shapes, shapes.map((shape) => shape.id));
    expect(composition.promptParts).toEqual(parts);
    expect(composition.prompt).toBe(parts.join("\n\n"));
  });

  it("resolves each prompt's references", () => {
    const shapes = [prompt("scene", "A @subject on a cliff", { y: 0 }), prompt("subject", "fox", { y: 900 })];
    expect(compose(shapes, ["scene"]).promptParts).toEqual(["A fox on a cliff"]);
  });

  it("appends the instruction last, resolved like a prompt's text, and keeps it out of the parts", () => {
    const shapes = [prompt("a", "a fox", { y: 0 }), prompt("style", "watercolour", { y: 900 })];
    const composition = compose(shapes, ["a"], { instruction: "  in @style, please  " });
    expect(composition.promptParts).toEqual(["a fox"]);
    expect(composition.prompt).toBe("a fox\n\nin watercolour, please");
    expect(composition.instruction).toBe("in watercolour, please");
  });

  it("uses the instruction alone when no prompt is selected", () => {
    expect(compose([image("i", "a.png")], ["i"], { instruction: "make it blue" }).prompt).toBe("make it blue");
  });

  it("reports a cycle as its error and never throws", () => {
    const shapes = [prompt("a", "@b", { y: 0 }), prompt("b", "@a", { y: 100 })];
    expect(compose(shapes, ["a"]).error).toBe("Circular reference: a -> b -> a");
    expect(compose([prompt("x", "fine")], ["x"], { instruction: "@loop" }).error).toBeUndefined();
    expect(compose([prompt("loop", "@loop")], [], { instruction: "@loop" }).error).toBe("Circular reference: loop -> loop");
  });
});

describe("groups in the order", () => {
  const board = () => [
    prompt("above", "above the group", { y: 0 }),
    group("g", { x: 0, y: 100 }),
    image("m2", "two.png", { x: 20, y: 300, parent: "g" }),
    prompt("m1", "inside, first", { x: 20, y: 150, parent: "g" }),
    image("m3", "three.png", { x: 200, y: 300, parent: "g" }),
    prompt("below", "below the group", { y: 600 }),
    image("loose", "loose.png", { y: 50 }),
  ];

  it("takes one slot at the group's top edge, its members filling it in their own order", () => {
    const composition = compose(board(), ["below", "g", "above", "loose"]);
    expect(composition.promptParts).toEqual(["above the group", "inside, first", "below the group"]);
    expect(composition.references.map((slot) => [slot.shapeId, slot.number])).toEqual([
      ["loose", 1],
      ["m2", 2],
      ["m3", 3],
    ]);
  });

  it("counts a member selected with its group once, in the group's slot", () => {
    const composition = compose(board(), ["m3", "g", "m1"]);
    expect(composition.promptParts).toEqual(["inside, first"]);
    expect(composition.references.map((slot) => slot.shapeId)).toEqual(["m2", "m3"]);
  });

  it("gives artifacts nothing to contribute, loose or inside a group, and shows a dash on them", () => {
    const shapes = [
      group("g", { y: 0 }),
      artifact("page", "page", { y: 20, parent: "g" }),
      artifact("motion", "motion", { y: 500 }),
      prompt("p", "text", { y: 40, parent: "g" }),
    ];
    const composition = compose(shapes, ["g", "motion"]);
    expect(composition.promptParts).toEqual(["text"]);
    expect(composition.references).toEqual([]);
    expect(composition.roles).toEqual({ page: DASH, motion: DASH });
  });
});

describe("media slots", () => {
  it("numbers images and videos per kind in list order", () => {
    const shapes = [
      image("i1", "a.png", { y: 0 }),
      video("v1", { file: "clip.mp4" }, { y: 100 }),
      image("i2", "b.png", { y: 200 }),
      video("v2", { link: "https://example.com/clip.mp4" }, { y: 300 }),
    ];
    expect(compose(shapes, ["v2", "i2", "v1", "i1"]).references).toEqual([
      { kind: "image", number: 1, shapeId: "i1", source: { type: "file", file: "a.png" } },
      { kind: "video", number: 1, shapeId: "v1", source: { type: "file", file: "clip.mp4" } },
      { kind: "image", number: 2, shapeId: "i2", source: { type: "file", file: "b.png" } },
      { kind: "video", number: 2, shapeId: "v2", source: { type: "link", url: "https://example.com/clip.mp4" } },
    ]);
  });

  it("gives an empty image or video no slot", () => {
    const shapes = [image("empty", undefined, { y: 0 }), video("blank", {}, { y: 100 }), image("full", "a.png", { y: 200 })];
    expect(compose(shapes, ["empty", "blank", "full"]).references.map((slot) => [slot.shapeId, slot.number])).toEqual([["full", 1]]);
  });

  it("never truncates slots to a reference cap", () => {
    const shapes = [1, 2, 3, 4, 5].map((n) => image(`i${n}`, `${n}.png`, { y: n * 100 }));
    expect(compose(shapes, shapes.map((shape) => shape.id), { referenceCap: 2 }).references).toHaveLength(5);
  });
});

describe("roles", () => {
  it("badges numbered slots, dashes empty media and artifacts, and leaves prompts and marks alone", () => {
    const shapes = [
      prompt("p", "text", { y: 0 }),
      image("i1", "a.png", { y: 100 }),
      image("empty", undefined, { y: 200 }),
      video("v1", { file: "clip.mp4" }, { y: 300 }),
      video("blank", {}, { y: 400 }),
      artifact("page", "page", { y: 500 }),
      mark("scribble", { x: 5000, y: 600 }),
    ];
    expect(compose(shapes, shapes.map((shape) => shape.id)).roles).toEqual({
      i1: "image 1",
      empty: DASH,
      v1: "video 1",
      blank: DASH,
      page: DASH,
      sketch: "image 2",
    });
  });

  it("badges media inside a selected group", () => {
    const shapes = [group("g", { y: 0 }), image("inside", "a.png", { y: 30, parent: "g" })];
    expect(compose(shapes, ["g"]).roles).toEqual({ inside: "image 1" });
  });
});

describe("which image a mark belongs to", () => {
  const photo = (id: string, z: number, at = { x: 0, y: 0 }) => image(id, `${id}.png`, { ...at, w: 200, h: 200, z });

  it.each([
    ["a mark overlapping an image above it in z belongs to it", [photo("img", 1), mark("m", { x: 50, y: 50, z: 5 })], "img"],
    ["a mark below the image in z does not", [photo("img", 5), mark("m", { x: 50, y: 50, z: 1 })], undefined],
    ["a mark that does not overlap does not", [photo("img", 1), mark("m", { x: 500, y: 500, z: 5 })], undefined],
    [
      "over several images below it, the topmost wins",
      [photo("low", 1), photo("high", 3, { x: 40, y: 40 }), photo("above", 9, { x: 60, y: 60 }), mark("m", { x: 50, y: 50, z: 5 })],
      "high",
    ],
  ])("%s", (_case, shapes, owner) => {
    const composition = compose(shapes, shapes.filter((shape) => shape.kind === "image").map((shape) => shape.id));
    const composite = composition.references.find((slot) => slot.source.type === "composite");
    expect(composite?.shapeId).toBe(owner);
  });

  it("is computed against every image on the canvas, so a mark over an unselected image is loose", () => {
    const shapes = [photo("unselected", 1), photo("selected", 2, { x: 1000, y: 0 }), mark("m", { x: 50, y: 50, z: 5 })];
    const composition = compose(shapes, ["selected", "m"]);
    expect(composition.references.map((slot) => slot.source.type)).toEqual(["file", "sketch"]);
  });
});

describe("composites and the sketch", () => {
  it("composites a selected image's marks into its slot, even when the marks are not selected", () => {
    const shapes = [
      image("img", "photo.png", { x: 0, y: 100, w: 200, h: 200, z: 1 }),
      mark("m2", { x: 100, y: 150, z: 3 }),
      mark("m1", { x: 20, y: 120, z: 2 }),
      image("other", "other.png", { x: 0, y: 900, z: 4 }),
    ];
    expect(compose(shapes, ["other", "img"]).references).toEqual([
      { kind: "image", number: 1, shapeId: "img", source: { type: "composite", image: "img", file: "photo.png", marks: ["m1", "m2"], crop: null } },
      { kind: "image", number: 2, shapeId: "other", source: { type: "file", file: "other.png" } },
    ]);
  });

  it("sends a cropped image as a composite even with no marks", () => {
    const crop = { topLeft: { x: 0.1, y: 0.2 }, bottomRight: { x: 0.9, y: 0.8 } };
    const shapes = [image("img", "photo.png", {}, crop)];
    expect(compose(shapes, ["img"]).references[0]!.source).toEqual({ type: "composite", image: "img", file: "photo.png", marks: [], crop });
  });

  it("sends an image whose crop is the whole picture unchanged", () => {
    const shapes = [image("img", "photo.png", {}, { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } })];
    expect(compose(shapes, ["img"]).references[0]!.source).toEqual({ type: "file", file: "photo.png" });
  });

  it("renders every loose selected mark into one sketch in the first loose mark's slot, which counts as an image", () => {
    const shapes = [
      image("top", "top.png", { y: 0, w: 100, h: 100, z: 1 }),
      mark("l2", { x: 400, y: 500, z: 2 }),
      mark("l1", { x: 300, y: 200, z: 3 }),
      image("bottom", "bottom.png", { y: 300, x: 900, z: 4 }),
      video("clip", { file: "c.mp4" }, { y: 800 }),
    ];
    const composition = compose(shapes, ["top", "l1", "l2", "bottom", "clip"]);
    expect(composition.references).toEqual([
      { kind: "image", number: 1, shapeId: "top", source: { type: "file", file: "top.png" } },
      { kind: "image", number: 2, shapeId: "sketch", source: { type: "sketch", marks: ["l1", "l2"], bounds: { x: 300, y: 200, w: 120, h: 320 } } },
      { kind: "image", number: 3, shapeId: "bottom", source: { type: "file", file: "bottom.png" } },
      { kind: "video", number: 1, shapeId: "clip", source: { type: "file", file: "c.mp4" } },
    ]);
    expect(composition.roles.sketch).toBe("image 2");
  });

  it("makes a selection of marks alone usable through its sketch", () => {
    const composition = compose([mark("m", { x: 10, y: 10 })], ["m"]);
    expect(composition.usable).toBe(true);
    expect(composition.references).toHaveLength(1);
  });
});

describe("usable, sources and warnings", () => {
  it.each([
    ["an empty image alone", [image("e", undefined)], ["e"], false],
    ["an empty prompt alone", [prompt("p", "  ")], ["p"], false],
    ["an artifact alone", [artifact("a", "page")], ["a"], false],
    ["a prompt with text", [prompt("p", "fox")], ["p"], true],
    ["a filled image", [image("i", "a.png")], ["i"], true],
    ["a linked video", [video("v", { link: "https://example.com/c.mp4" })], ["v"], true],
    ["nothing", [prompt("p", "fox")], [], false],
    // Its text does not resolve, but the composer has to open to say why.
    ["a prompt caught in a loop", [prompt("a", "@b"), prompt("b", "@a")], ["a"], true],
  ])("%s: usable is %s", (_case, shapes, selected, usable) => {
    expect(compose(shapes, selected).usable).toBe(usable);
  });

  it("lists every contributing shape in order as the sources", () => {
    const shapes = [
      prompt("p", "fox", { y: 0 }),
      prompt("blank", " ", { y: 50 }),
      image("i", "a.png", { y: 100, x: 0, w: 100, h: 100, z: 1 }),
      mark("owned", { x: 10, y: 110, z: 2 }),
      image("empty", undefined, { y: 300 }),
      artifact("page", "page", { y: 400 }),
      mark("loose", { x: 3000, y: 500 }),
    ];
    expect(compose(shapes, shapes.map((shape) => shape.id)).sources).toEqual(["p", "i", "owned", "loose"]);
  });

  it.each([
    ["one video", 1, 4, 1, ["A video is selected, but image models do not take video input. It will be sent and probably ignored."]],
    ["three videos", 1, 4, 3, ["3 videos are selected, but image models do not take video input. They will be sent and probably ignored."]],
    ["images over the cap", 5, 4, 0, ["5 images are selected, but this model takes at most 4. Deselect the rest, or pick a model that takes more."]],
    ["images over a cap of one", 2, 1, 0, ["2 images are selected, but this model takes only one. Deselect the rest, or pick a model that takes more."]],
    ["images at the cap", 4, 4, 0, []],
    [
      "both",
      3,
      2,
      2,
      [
        "2 videos are selected, but image models do not take video input. They will be sent and probably ignored.",
        "3 images are selected, but this model takes at most 2. Deselect the rest, or pick a model that takes more.",
      ],
    ],
  ])("warns for %s", (_case, images, cap, videos, warnings) => {
    const shapes = [
      ...Array.from({ length: images }, (_, n) => image(`i${n}`, `${n}.png`, { y: n * 100 })),
      ...Array.from({ length: videos }, (_, n) => video(`v${n}`, { file: `${n}.mp4` }, { y: 5000 + n * 100 })),
    ];
    expect(compose(shapes, shapes.map((shape) => shape.id), { referenceCap: cap }).warnings).toEqual(warnings);
  });

  it("counts composites and the sketch against the cap", () => {
    const shapes = [image("i", "a.png", { x: 0, y: 0, w: 100, h: 100, z: 1 }), mark("on", { x: 10, y: 10, z: 2 }), mark("loose", { x: 900, y: 900 })];
    expect(compose(shapes, ["i", "loose"], { referenceCap: 1 }).warnings).toEqual([
      "2 images are selected, but this model takes only one. Deselect the rest, or pick a model that takes more.",
    ]);
  });

  it("does not warn about videos or the cap for other media", () => {
    const shapes = [image("a", "a.png"), image("b", "b.png"), video("v", { file: "v.mp4" })];
    expect(compose(shapes, ["a", "b", "v"], { referenceCap: 1, medium: "text" }).warnings).toEqual([]);
  });
});
