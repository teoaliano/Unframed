import { describe, expect, it } from "vitest";
import { legacyRecords } from "../../src/index.ts";
import { mapSample, shapesOf } from "./facts.ts";
import { edge, group, image, prompt, type Json } from "./journal.ts";
import { at, mapNodes, section } from "./mapping.ts";

const ids = { page: "page:page", shape: (key: string) => `shape:${key}`, asset: (key: string) => `asset:${key}` };
const output = (id: string, type: string, x: number, y: number, data: Json = {}): Json => ({ id, type, ...at(x, y), data });

describe("the recipe an output makes", () => {
  it("image: its model and the params it sets, runs, and Free; the final-prompt setting is dropped", () => {
    const { key } = shapesOf(mapSample("everything"));
    expect(key("group:140").recipe).toEqual({ medium: "image", model: "openai/gpt-image-2", params: { resolution: "1K", quality: "low", aspect_ratio: "3:2" }, runs: 3 });
    expect(key("group:150").recipe).toEqual({ medium: "image", model: "openai/gpt-image-2", params: { background: "transparent", output_format: "png" }, runs: "free" });
    expect(key("node:character").recipe).toEqual({ medium: "image", model: "openai/gpt-image-2", params: { quality: "high", size: "1024x1536" }, runs: 3 });
  });

  it("image: the default model and one run when the output sets neither", () => {
    const { key } = shapesOf(mapNodes([output("140", "imageOutput", 0, 0, {})]));
    expect(key("group:140").recipe).toEqual({ medium: "image", model: "openai/gpt-image-2", params: {}, runs: 1 });
  });

  it("video: its model and params as the tray names them, input mode defaulting to reference and sharing to on", () => {
    const { key } = shapesOf(mapSample("everything"));
    expect(key("group:160").recipe).toEqual({
      medium: "video",
      model: "bytedance/seedance-2.0",
      params: { duration: 5, resolution: "480p", aspect_ratio: "16:9", generate_audio: false, inputMode: "first_frame", shareLocalVideos: true },
      runs: 1,
    });
    expect(key("group:163").recipe).toEqual({ medium: "video", model: "bytedance/seedance-2.0", params: { duration: 5, resolution: "720p", inputMode: "reference", shareLocalVideos: false }, runs: 1 });
    const defaults = shapesOf(mapNodes([output("160", "videoOutput", 0, 0, {})]));
    expect(defaults.key("group:160").recipe).toEqual({ medium: "video", model: "bytedance/seedance-2.0", params: { inputMode: "reference", shareLocalVideos: true }, runs: 1 });
  });

  it("text: its model, no params, one run", () => {
    const { key } = shapesOf(mapSample("everything"));
    expect(key("group:170").recipe).toEqual({ medium: "text", model: "google/gemini-3.5-flash-lite", params: {}, runs: 1 });
    const defaults = shapesOf(mapNodes([output("170", "textOutput", 0, 0, { text: "", result: "" })]));
    expect(defaults.key("group:170").recipe).toEqual({ medium: "text", model: "google/gemini-3.5-flash-lite", params: {}, runs: 1 });
  });

  it("is stored on the group as its standing recipe", () => {
    const records = legacyRecords(mapSample("everything").canvas.shapes, ids).shapes;
    expect(records.find((record) => record.id === "shape:group:140")).toMatchObject({ type: "frame", props: { name: "140" }, meta: { unframed: { recipe: { medium: "image", runs: 3 } } } });
  });
});

describe("rule 1: one group", () => {
  it("puts the recipe on the one group wired into the output, and reports it", () => {
    const mapped = mapSample("everything");
    const { key, list } = shapesOf(mapped);
    expect(key("node:character").recipe?.medium).toBe("image");
    expect(list.some((shape) => shape.key === "group:180")).toBe(false);
    expect(section(mapped, "changed")).toContain("@180 was an image output wired from @character. @character now holds its settings.");
  });

  it("puts a text output's recipe on its group when it has no instructions", () => {
    const mapped = mapNodes([group("box", at(0, 0)), prompt("120", "fox", { parentId: "box", ...at(28, 56) }), output("170", "textOutput", 600, 0, { text: "  ", result: "" })], [edge("box", "170")]);
    expect(shapesOf(mapped).key("node:box").recipe).toEqual({ medium: "text", model: "google/gemini-3.5-flash-lite", params: {}, runs: 1 });
    expect(section(mapped, "changed")).toContain("@170 was a text output wired from @box. @box now holds its settings.");
  });

  it("keeps a text output's instructions out of the group: the group gets no recipe and a recipe group stands where the output was", () => {
    const mapped = mapNodes(
      [group("box", at(0, 0)), prompt("120", "fox", { parentId: "box", ...at(28, 56) }), output("170", "textOutput", 600, 0, { text: "Describe it.", result: "" })],
      [edge("box", "170")],
    );
    const { key } = shapesOf(mapped);
    expect(key("node:box").recipe).toBeUndefined();
    expect(key("group:170")).toMatchObject({ x: 600, y: 0, recipe: { medium: "text" } });
    expect(key("instructions:170")).toMatchObject({ parent: "group:170", text: "Describe it." });
  });

  it("does not apply to a group that also feeds another output", () => {
    const mapped = mapNodes([group("box", at(0, 0)), output("140", "imageOutput", 600, 0), output("141", "imageOutput", 600, 400)], [edge("box", "140"), edge("box", "141")]);
    const { key } = shapesOf(mapped);
    expect(key("node:box").recipe).toBeUndefined();
    expect(key("group:140")).toMatchObject({ x: 600, y: 0 });
    expect(key("group:141")).toMatchObject({ x: 600, y: 400 });
  });
});

describe("rule 2: a box around the sources", () => {
  it("draws a recipe group around unshared top-level sources by the wrap rule, named by the output's id", () => {
    const mapped = mapSample("everything");
    const { key, ref } = shapesOf(mapped);
    expect(key("group:140")).toMatchObject({ kind: "group", ref: "140", x: -28, y: -56, w: 376, h: 374 });
    expect(ref("100")).toMatchObject({ parent: "group:140", x: 28, y: 56 });
    expect(ref("106")).toMatchObject({ parent: "group:140", x: 28, y: 196 });
    expect(key("group:160")).toMatchObject({ ref: "160", x: -28, y: 1344, w: 336, h: 294 });
    expect(section(mapped, "changed")).toEqual(
      expect.arrayContaining(["@140 was an image output. It is now a recipe group around its 2 sources.", "@160 was a video output. It is now a recipe group around its 2 sources."]),
    );
  });

  it("names a text output's recipe group with a minted @id: its own id goes to its answer", () => {
    const { key, ref } = shapesOf(mapSample("everything"));
    expect(key("group:170")).toMatchObject({ ref: "216", x: -28, y: 2244 });
    expect(ref("170")).toMatchObject({ kind: "prompt", text: "A patch of green grass under a pale sky." });
  });

  it("boxes a text output source as its answer", () => {
    const mapped = mapNodes(
      [prompt("100", "a fox", at(0, 0)), output("110", "textOutput", 400, 0, { text: "", result: "A red fox." }), output("140", "imageOutput", 400, 400)],
      [edge("100", "110"), edge("110", "140")],
    );
    const { key } = shapesOf(mapped);
    expect(key("answer:110")).toMatchObject({ parent: "group:140" });
    expect(key("group:140")).toMatchObject({ x: 372, y: -56 });
  });
});

describe("rule 2 refused", () => {
  it("when a source also feeds another output", () => {
    const mapped = mapSample("everything");
    const { key } = shapesOf(mapped);
    expect(key("group:150")).toMatchObject({ x: 820, y: 800, w: 320, h: 200 });
    expect(key("group:151")).toMatchObject({ x: 440, y: 800, w: 320, h: 200 });
    expect(shapesOf(mapped).ref("152").parent).toBeUndefined();
    expect(section(mapped, "changed")).toContain(
      "@150 was an image output whose sources also fed other outputs, or could not be boxed cleanly. It is now a recipe group where it stood. Select it with its sources to run it.",
    );
  });

  it("when the box would overlap another shape", () => {
    const mapped = mapSample("everything");
    expect(shapesOf(mapped).key("group:190")).toMatchObject({ x: 440, y: 4200 });
    expect(shapesOf(mapped).ref("191").parent).toBeUndefined();
  });

  it("when the box would overlap a group made earlier in the import", () => {
    const mapped = mapSample("everything");
    expect(shapesOf(mapped).key("group:132")).toMatchObject({ x: 1300, y: 360, w: 320, h: 200 });
    expect(shapesOf(mapped).ref("101").parent).toBeUndefined();
    expect(section(mapped, "changed")).toContain(
      "@132 was a text output whose sources also fed other outputs, or could not be boxed cleanly. It is now a recipe group where it stood. Select it with its sources to run it.",
    );
  });

  it("when a source is not a prompt, image, video or text output, or sits in a group", () => {
    const mapped = mapNodes(
      [
        { id: "200", type: "page", ...at(0, 0), data: { file: "", title: "", fileName: "" } },
        group("box", at(0, 600)),
        image("121", { parentId: "box", ...at(28, 56) }),
        output("140", "imageOutput", 700, 0),
        output("141", "imageOutput", 700, 600),
      ],
      [edge("200", "140"), edge("121", "141")],
    );
    const { key } = shapesOf(mapped);
    expect(key("group:140")).toMatchObject({ x: 700, y: 0 });
    expect(key("group:141")).toMatchObject({ x: 700, y: 600 });
  });
});

describe("rule 3: where the output stood", () => {
  it("places a recipe group at the output's position with its size, for an unwired output", () => {
    const mapped = mapSample("everything");
    expect(shapesOf(mapped).key("group:130")).toMatchObject({ ref: "130", x: 440, y: 3700, w: 320, h: 200, recipe: { medium: "image", runs: 2 } });
    expect(section(mapped, "changed")).toContain("@130 was an image output with no sources. It is now a recipe group where it stood.");
    expect(section(mapped, "changed")).toContain("@131 was a video output with no sources. It is now a recipe group where it stood.");
  });

  it("keeps an output's own size", () => {
    const mapped = mapNodes([{ ...output("140", "imageOutput", 10, 20), width: 400, height: 260 }]);
    expect(shapesOf(mapped).key("group:140")).toMatchObject({ x: 10, y: 20, w: 400, h: 260 });
  });
});

describe("a text output's instructions", () => {
  it("become a minted prompt below the lowest member with a gap of 28, and the box grows to hold them", () => {
    const mapped = mapSample("everything");
    const { key } = shapesOf(mapped);
    expect(key("instructions:170")).toMatchObject({ kind: "prompt", ref: "217", parent: "group:170", x: 28, y: 234, text: "Describe image 1 in one sentence.", sized: false });
    expect(key("group:170").h).toBe(234 + key("instructions:170").h + 28);
    expect(section(mapped, "changed")).toEqual(
      expect.arrayContaining(["@170 was a text output. Its answer is now a text result with the same @id.", "Its instructions are now the prompt @217."]),
    );
    const texts = section(mapped, "changed");
    expect(texts.indexOf("Its instructions are now the prompt @217.")).toBe(texts.indexOf("@170 was a text output. Its answer is now a text result with the same @id.") + 1);
  });

  it("sit at the top-left inside the label margin of an empty box", () => {
    const mapped = mapNodes([output("170", "textOutput", 100, 100, { text: "Write a haiku about foxes in the snow at night.", result: "" })]);
    const { key } = shapesOf(mapped);
    expect(key("instructions:170")).toMatchObject({ parent: "group:170", x: 28, y: 56 });
    expect(key("group:170").h).toBeGreaterThanOrEqual(56 + key("instructions:170").h + 28);
    expect(key("group:170").w).toBeGreaterThanOrEqual(320);
  });

  it("come last in the group's paint order, after the members they follow", () => {
    const list = shapesOf(mapSample("everything")).list.map((shape) => shape.key);
    expect(list.indexOf("instructions:170")).toBeGreaterThan(list.indexOf("node:172"));
    expect(list.indexOf("node:172")).toBeGreaterThan(list.indexOf("group:170"));
  });

  it("grow the box before the overlap check", () => {
    const mapped = mapNodes(
      [image("172", { ...at(0, 0), data: { file: "g.png", fileName: "g.png", aspect: 1.6 } }), prompt("300", "below", at(0, 190)), output("170", "textOutput", 400, 0, { text: "Describe image 1 in one sentence.", result: "" })],
      [edge("172", "170")],
      { files: ["g.png"] },
    );
    expect(shapesOf(mapped).key("group:170")).toMatchObject({ x: 400, y: 0 });
  });
});

describe("a text output's answer", () => {
  it("becomes a text result with the output's id as its @id", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("151")).toMatchObject({ key: "answer:151", kind: "prompt", text: "The red fox\n---\nThe rocky cliff\n---\nThe evening sky", w: 240, sized: true, result: { medium: "text" } });
    const records = legacyRecords(mapSample("everything").canvas.shapes, ids).shapes;
    expect(records.find((record) => record.meta.ref === "151")).toMatchObject({ type: "text", meta: { ref: "151", unframed: { result: { medium: "text" } } } });
  });

  it("sits 24 below a recipe group that stands where the output was, and at the output's position otherwise", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("151")).toMatchObject({ x: 440, y: 1024 });
    expect(ref("170")).toMatchObject({ x: 440, y: 2300 });
  });

  it("gives no shape when empty, leaving tokens as typed, and the report says so", () => {
    const mapped = mapSample("everything");
    const { list, ref } = shapesOf(mapped);
    expect(list.some((shape) => shape.ref === "133" || shape.ref === "132")).toBe(false);
    expect(ref("105").text).toBe("Caption for the poster: @133");
    expect(section(mapped, "notKept")).toEqual(
      expect.arrayContaining([
        "@133 was a text output with no answer yet. Prompts that mention @133 now show the token as typed.",
        "@132 was a text output with no answer yet. Prompts that mention @132 now show the token as typed.",
      ]),
    );
  });
});
