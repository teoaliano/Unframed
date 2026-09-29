import { describe, expect, it } from "vitest";
import { convertPreset, describePresetContent, type ContentShape } from "../../src/index.ts";
import { DEFAULTS } from "./facts.ts";
import { edge, group, image, prompt, type Json } from "./journal.ts";
import { at, PNG_64x40 } from "./mapping.ts";
import { sampleText } from "./samples.ts";

const SAMPLE = JSON.parse(sampleText("presets.json")!) as Json[];
const sample = (id: string) => SAMPLE.find((entry) => entry.id === id)!;
const convert = (entry: unknown) => convertPreset(entry, { defaults: DEFAULTS });
const oldPreset = (nodes: Json[], edges: Json[] = [], extra: Json = {}): Json => ({ id: "user-test", source: "user", name: "Test preset", summary: "", type: "flow", kind: "image", fragment: { nodes, edges }, ...extra });
const output = (id: string, type: string, x: number, y: number, data: Json = {}): Json => ({ id, type, ...at(x, y), data });

/** The converted content's root group and its members by `@id`. */
const contentOf = (converted: ReturnType<typeof convert>) => {
  const content = converted!.preset.content;
  const root = content.shapes.find((shape) => shape.id === content.rootShapeIds[0])!;
  const member = (ref: string): ContentShape | undefined =>
    content.shapes.find((shape) => shape.parentId === root.id && (shape.type === "frame" ? shape.props.name === ref : shape.meta.ref === ref));
  return { content, root, member, members: content.shapes.filter((shape) => shape.parentId === root.id) };
};

describe("convertPreset: what is an old preset", () => {
  it("converts entries without a format key that hold a fragment, and answers nothing for the rest", () => {
    expect(convert(sample("user-mfe1q9w2"))).toBeUndefined();
    expect(convert({ id: "p-1700000000000", name: "Old flow", nodes: [{ type: "output" }] })).toBeUndefined();
    expect(convert("not an entry")).toBeUndefined();
    for (const id of ["user-mf2k8a1c", "user-mf1x9k4b", "user-mf1b5y2e", "user-mf0a3z7d"]) expect(convert(sample(id))).toBeDefined();
  });

  it("keeps id, name, summary, needs and savedAt, is a user preset marked legacy, and leaves the schema to be stamped", () => {
    const { preset } = convert(sample("user-mf2k8a1c"))!;
    expect(preset).toMatchObject({
      format: 2,
      id: "user-mf2k8a1c",
      source: "user",
      savedAt: "2026-09-08T07:00:00.000Z",
      name: "Split into parts",
      summary: "Plan the parts of a picture, then make one image per part",
      needs: "Drop your picture into the image, run the planner, then run the image output",
      legacy: true,
    });
    expect(preset.content.schema).toBeNull();
    expect(convert(sample("user-mf0a3z7d"))!.preset).not.toHaveProperty("savedAt");
  });
});

describe("convertPreset: the recipe output", () => {
  it("is the output that feeds no other output, and makes a recipe preset of its medium", () => {
    const converted = convert(sample("user-mf2k8a1c"))!;
    expect(converted.preset).toMatchObject({ kind: "recipe", medium: "image" });
    expect(contentOf(converted).root.meta.unframed).toEqual({ recipe: { medium: "image", model: "openai/gpt-image-2", params: {}, runs: "free" } });
    expect(describePresetContent(converted.preset.content)).toEqual({ ok: true, kind: "recipe", medium: "image" });
  });

  it("is the topmost of several, ties left to right", () => {
    const tie = convert(oldPreset([output("right", "imageOutput", 500, 0), output("left", "videoOutput", 100, 0), output("low", "textOutput", 0, 400, { text: "", result: "" })]))!;
    expect(tie.preset).toMatchObject({ kind: "recipe", medium: "video" });
    expect(tie.notes).toEqual(["@right, a second image output, was not kept.", "@low, a second text output, was not kept."]);
    const clip = convert(sample("user-mf1x9k4b"))!;
    expect(clip.preset).toMatchObject({ kind: "recipe", medium: "video" });
    expect(contentOf(clip).root.meta.unframed).toEqual({
      recipe: { medium: "video", model: "bytedance/seedance-2.0", params: { duration: 5, resolution: "480p", inputMode: "reference", shareLocalVideos: true }, runs: 1 },
    });
  });

  it("makes a lone text output a text recipe group", () => {
    const converted = convert(sample("user-mf1b5y2e"))!;
    expect(converted.preset).toMatchObject({ kind: "recipe", medium: "text" });
    expect(contentOf(converted).root.meta.unframed).toEqual({ recipe: { medium: "text", model: "google/gemini-3.5-flash-lite", params: {}, runs: 1 } });
  });

  it("is missing from a block with no output, which is a plain group", () => {
    const converted = convert(sample("user-mf0a3z7d"))!;
    expect(converted.preset.kind).toBe("group");
    expect(converted.preset).not.toHaveProperty("medium");
    expect(contentOf(converted).root.meta).toEqual({});
  });
});

describe("convertPreset: what is not kept, and its notes", () => {
  it("drops old results and run markers, noting only the results", () => {
    expect(convert(sample("user-mf2k8a1c"))!.notes).toContain("Its old results were not kept.");
    expect(convert(sample("user-mf1x9k4b"))!.notes).not.toContain("Its old results were not kept.");
    const content = JSON.stringify(convert(sample("user-mf1x9k4b"))!.preset.content);
    expect(content).not.toContain("vid_0c3e5a7b91");
    expect(content).not.toContain("running");
  });

  it("keeps a text step that feeds another output as its instructions and answer, and loses its model", () => {
    const converted = convert(
      oldPreset(
        [prompt("plan", "a fox", at(0, 0)), output("planner", "textOutput", 400, 0, { text: "Split it.", result: "A\n---\nB", model: "some/model" }), output("out", "imageOutput", 800, 0)],
        [edge("plan", "planner"), edge("planner", "out")],
      ),
    )!;
    const { member, members } = contentOf(converted);
    expect(converted.notes).toEqual(["The text step @planner lost its model. Run it with the composer."]);
    const answer = member("planner")!;
    expect(answer).toMatchObject({ type: "text", meta: { ref: "planner", unframed: { result: { medium: "text", sidecar: null } } } });
    const instructions = members.find((shape) => shape.type === "text" && JSON.stringify(shape.props.richText).includes("Split it."))!;
    expect(instructions.meta.unframed).toBeUndefined();
    expect(converted.preset.kind).toBe("recipe");
    expect(JSON.stringify(converted.preset.content)).not.toContain("some/model");
    const sampled = convert(sample("user-mf2k8a1c"))!;
    expect(sampled.notes).toEqual(["Its old results were not kept.", "The text step @planner lost its model. Run it with the composer."]);
  });

  it("drops any other output", () => {
    expect(convert(sample("user-mf1x9k4b"))!.notes).toContain("@still, a second image output, was not kept.");
  });

  it("drops pages and motions", () => {
    const converted = convert(sample("user-mf1x9k4b"))!;
    expect(converted.notes).toEqual([
      "@still, a second image output, was not kept.",
      "Group @pose was flattened into the preset's group.",
      "Pages and motions are not kept in a preset.",
    ]);
    expect(converted.preset.content.shapes.some((shape) => shape.type === "page" || shape.type === "motion")).toBe(false);
  });

  it("puts a text recipe output's instructions at the bottom of the group, below its answer", () => {
    const converted = convert(
      oldPreset([prompt("p", "a fox", at(0, 0)), output("t", "textOutput", 400, 0, { text: "Describe it.", result: "A fox." })], [edge("p", "t")]),
    )!;
    const { members } = contentOf(converted);
    const [first, answer, instructions] = [...members].sort((a, b) => a.y - b.y);
    expect(first!.meta.ref).toBe("p");
    expect(answer!.meta).toMatchObject({ ref: "t", unframed: { result: { medium: "text" } } });
    expect(JSON.stringify(instructions!.props.richText)).toContain("Describe it.");
    const detail = contentOf(convert(sample("user-mf1b5y2e")));
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0]).toMatchObject({ type: "text", x: 28, y: 56 });
    expect(JSON.stringify(detail.members[0]!.props.richText)).toContain("Rewrite the wired prompt as a short list of visual details");
  });
});

describe("convertPreset: the group", () => {
  it("keeps the one top-level group as the preset's group, with its @id and members", () => {
    const { root, member, members } = contentOf(convert(sample("user-mf0a3z7d")));
    expect(root).toMatchObject({ type: "frame", parentId: "page:page", props: { name: "character", w: 420, h: 280 } });
    expect(members.map((shape) => shape.meta.ref)).toEqual(["c1", "c2"]);
    expect(member("c1")).toMatchObject({ type: "text", x: 28, y: 56 });
    expect(member("c2")).toMatchObject({ type: "image", x: 28, y: 130, props: { w: 160, h: 100 } });
  });

  it("puts kept text steps inside the one group below its lowest member", () => {
    const converted = convert(
      oldPreset(
        [group("box", at(0, 0)), prompt("120", "fox", { parentId: "box", ...at(28, 56), width: 200, height: 30 }), output("t", "textOutput", 600, 0, { text: "Plan it.", result: "" }), output("o", "imageOutput", 600, 400)],
        [edge("box", "t"), edge("t", "o")],
      ),
    )!;
    const { root, members } = contentOf(converted);
    expect(root.props.name).toBe("box");
    const plan = members.find((shape) => JSON.stringify(shape.props.richText ?? "").includes("Plan it."))!;
    expect(plan).toMatchObject({ x: 28, y: 56 + 30 + 28 });
  });

  it("otherwise wraps every kept top-level input in a new group named from the preset, by the wrap rule", () => {
    const { root, members } = contentOf(convert(sample("user-mf2k8a1c")));
    expect(root).toMatchObject({ type: "frame", props: { name: "split-into-parts", w: 296, h: 644 }, x: -28, y: -56 });
    expect(members.map((shape) => [shape.meta.ref, shape.x, shape.y])).toEqual([
      ["plan", 28, 56],
      ["ref", 28, 376],
    ]);
  });

  it("names the new group with a minted @id when the preset's name slugs to nothing", () => {
    const { root } = contentOf(convert(oldPreset([prompt("100", "fox"), prompt("101", "cliff", at(0, 200))], [], { name: "!!!" })));
    expect(root.props.name).toBe("102");
  });

  it("flattens other groups into it, their members at their absolute positions", () => {
    const { root, member } = contentOf(convert(sample("user-mf1x9k4b")));
    expect(root.props.name).toBe("fox-walk-clip");
    expect(member("pose")).toBeUndefined();
    const p1 = member("p1")!;
    expect({ x: p1.x + root.x, y: p1.y + root.y }).toEqual({ x: 28, y: -264 });
    expect(["walk", "sketch", "motion", "p1"].every((ref) => member(ref) !== undefined)).toBe(true);
  });
});

describe("convertPreset: media", () => {
  it("points a file at the target project, keeps a data URL inline, and keeps an https link as a linked clip", () => {
    const hiker = contentOf(convert(sample("user-mf0a3z7d")));
    expect(hiker.content.assets).toEqual([expect.objectContaining({ type: "image", props: expect.objectContaining({ src: "preset-file:/1789030920022-hiker.png", name: "hiker.png" }) })]);
    expect(hiker.member("c2")!.props.assetId).toBe(hiker.content.assets[0]!.id);
    const clip = contentOf(convert(sample("user-mf1x9k4b")));
    const sources = clip.content.assets.map((asset) => [asset.type, String(asset.props.src).slice(0, 22)]);
    expect(sources).toEqual([
      ["image", "data:image/png;base64,"],
      ["video", "https://media.example."],
    ]);
    expect(clip.content.assets[0]!.props).toMatchObject({ name: "sketch.png", w: 64, h: 40 });
  });

  it("reads an inline image's aspect from its bytes when the node has none", () => {
    const { member } = contentOf(convert(oldPreset([image("i", { width: 240, data: { fileName: "s.png", dataUrl: PNG_64x40 } })])));
    expect(member("i")!.props).toMatchObject({ w: 240, h: 150 });
  });
});

describe("convertPreset: determinism", () => {
  it("converts the same entry to the same preset every time", () => {
    for (const entry of SAMPLE) expect(convert(entry)).toEqual(convert(entry));
  });
});
