import { describe, expect, it } from "vitest";
import { describePresetContent, presetCase, presetFromSelection, PRESET_SPLIT_MESSAGE, type PresetCase } from "../src/index.ts";
import { content, groupShape, imageAsset, imageShape, markShape, pageShape, promptShape } from "./presets.ts";

const RECIPE = { medium: "video", model: "google/veo-3", params: { duration: "5" }, runs: 1 };

describe("presetCase", () => {
  it.each<[string, Array<{ id: string; type: string; parent?: string }>, PresetCase["kind"]]>([
    ["exactly one group", [{ id: "g", type: "frame" }], "group"],
    ["one group with loose pages and motions", [{ id: "g", type: "frame" }, { id: "p", type: "page" }, { id: "m", type: "motion" }], "group"],
    ["a group and one of its own members", [{ id: "g", type: "frame" }, { id: "a", type: "text", parent: "g" }], "group"],
    ["loose prompts, media and marks", [{ id: "a", type: "text" }, { id: "b", type: "image" }, { id: "c", type: "draw" }], "wrap"],
    ["a member selected alone is loose", [{ id: "a", type: "image", parent: "g" }], "wrap"],
    ["loose shapes with a page", [{ id: "a", type: "text" }, { id: "p", type: "page" }], "wrap"],
    ["two groups", [{ id: "g", type: "frame" }, { id: "h", type: "frame" }], "split"],
    ["a group and loose groupable shapes", [{ id: "g", type: "frame" }, { id: "a", type: "text" }], "split"],
    ["nothing groupable", [{ id: "p", type: "page" }, { id: "m", type: "motion" }], "empty"],
    ["nothing at all", [], "empty"],
  ])("%s", (_case, selection, kind) => {
    expect(presetCase(selection).kind).toBe(kind);
  });
});

describe("presetFromSelection", () => {
  it("one group: the group, its members and its recipe, with no loose page", () => {
    const captured = content(
      [
        groupShape("shape:g", "character", { x: 100, y: 50 }, { unframed: { recipe: RECIPE } }),
        promptShape("shape:p", "120", "a fox", { x: 28, y: 56 }, "shape:g"),
        imageShape("shape:i", "121", "asset:a", { x: 28, y: 120 }, "shape:g"),
        pageShape("shape:page", "122", { x: 800, y: 0 }),
      ],
      [imageAsset("asset:a", "project-file:1-fox.png")],
    );
    const made = presetFromSelection({ project: "shoots", content: captured, bounds: {} }, { name: "Fox" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made).toMatchObject({ kind: "recipe", medium: "video", members: 2 });
    expect(made.content.rootShapeIds).toEqual(["shape:g"]);
    expect(made.content.shapes.map((shape) => shape.id)).toEqual(["shape:g", "shape:p", "shape:i"]);
    expect(made.content.schema).toEqual(captured.schema);
    // A saved preset names the project its files came from and carries no bytes.
    expect(made.content.assets).toEqual([imageAsset("asset:a", "preset-file:shoots/1-fox.png")]);
  });

  it("a plain group is kind group with no medium", () => {
    const made = presetFromSelection(
      { project: "p", content: content([groupShape("shape:g", "set"), markShape("shape:m", { x: 28, y: 56 }, "shape:g")]), bounds: {} },
      { name: "Set" },
    );
    expect(made).toMatchObject({ ok: true, kind: "group", members: 1 });
    expect(made.ok && "medium" in made).toBe(false);
  });

  it("loose shapes: a new group wrapped around them, named after the preset, pages left out", () => {
    const captured = content([
      promptShape("shape:p", "130", "a fox", { x: 100, y: 200 }),
      imageShape("shape:i", "131", null, { x: 460, y: 200 }),
      pageShape("shape:page", "132", { x: 900, y: 0 }),
    ]);
    const bounds = { "shape:p": { x: 100, y: 200, w: 320, h: 40 }, "shape:i": { x: 460, y: 200, w: 240, h: 140 }, "shape:page": { x: 900, y: 0, w: 480, h: 320 } };
    const made = presetFromSelection({ project: "p", content: captured, bounds }, { name: "Red Fox  " });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made).toMatchObject({ kind: "group", members: 2 });
    const [root] = made.content.rootShapeIds;
    const group = made.content.shapes.find((shape) => shape.id === root)!;
    // The wrap rule: the members' box plus 28 left, right and bottom and 56 on top.
    expect(group).toMatchObject({ type: "frame", parentId: "page:page", x: 72, y: 144, props: { w: 656, h: 224, name: "red-fox" } });
    expect(made.content.shapes.filter((shape) => shape.id !== root)).toEqual([
      expect.objectContaining({ id: "shape:p", parentId: root, x: 28, y: 56 }),
      expect.objectContaining({ id: "shape:i", parentId: root, x: 388, y: 56 }),
    ]);
  });

  it("loose shapes under a name with no slug: a minted @id", () => {
    const captured = content([promptShape("shape:p", "130", "@150 and a fox", { x: 0, y: 0 })]);
    const made = presetFromSelection({ project: "p", content: captured, bounds: { "shape:p": { x: 0, y: 0, w: 100, h: 40 } } }, { name: "!!!" });
    expect(made.ok && made.content.shapes.find((shape) => shape.type === "frame")?.props.name).toBe("151");
  });

  it("strips run markers, run errors and unfilled result meta, and keeps a filled result", () => {
    const filled = { result: { sidecar: "1-a.json", medium: "image", model: "m", batchId: "b-1", runIndex: 1, runCount: 1, cost: 0.1, sources: [] } };
    const captured = content([
      groupShape("shape:g", "set"),
      imageShape("shape:a", "140", null, { x: 0, y: 0 }, "shape:g", { unframed: { run: { runId: "r", runIndex: 1, startedAt: 1 }, result: { ...filled.result, sidecar: null } } }),
      imageShape("shape:b", "141", null, { x: 0, y: 0 }, "shape:g", { unframed: { runError: "failed" } }),
      imageShape("shape:c", "142", null, { x: 0, y: 0 }, "shape:g", { unframed: filled }),
    ]);
    const made = presetFromSelection({ project: "p", content: captured, bounds: {} }, { name: "Set" });
    if (!made.ok) throw new Error("expected a preset");
    const meta = Object.fromEntries(made.content.shapes.map((shape) => [shape.id, shape.meta]));
    expect(meta["shape:a"]).toEqual({ ref: "140" });
    expect(meta["shape:b"]).toEqual({ ref: "141" });
    expect(meta["shape:c"]).toEqual({ ref: "142", unframed: filled });
  });

  it("keeps a link and an empty source, and assets and bindings only of kept shapes", () => {
    const captured = content(
      [groupShape("shape:g", "set"), imageShape("shape:a", "150", "asset:link", { x: 0, y: 0 }, "shape:g"), pageShape("shape:page", "151")],
      [imageAsset("asset:link", "https://example.com/clip.mp4"), imageAsset("asset:empty", null)],
      { bindings: [{ id: "binding:1", typeName: "binding", fromId: "shape:a", toId: "shape:page" }] },
    );
    const made = presetFromSelection({ project: "p", content: captured, bounds: {} }, { name: "Set" });
    if (!made.ok) throw new Error("expected a preset");
    expect(made.content.assets).toEqual([imageAsset("asset:link", "https://example.com/clip.mp4")]);
    expect(made.content.bindings).toEqual([]);
  });

  it.each([
    ["two groups", content([groupShape("shape:g", "a"), groupShape("shape:h", "b")]), PRESET_SPLIT_MESSAGE],
    ["a group and a loose prompt", content([groupShape("shape:g", "a"), promptShape("shape:p", "1", "x")]), PRESET_SPLIT_MESSAGE],
    ["nothing groupable", content([pageShape("shape:page", "1")]), "A preset is one group."],
  ])("refuses %s", (_case, captured, error) => {
    expect(presetFromSelection({ project: "p", content: captured, bounds: {} }, { name: "x" })).toEqual({ ok: false, error });
  });
});

describe("describePresetContent", () => {
  it("reads the kind and medium from the one root group", () => {
    expect(describePresetContent(content([groupShape("shape:g", "a", { x: 0, y: 0 }, { unframed: { recipe: RECIPE } })]))).toEqual({ ok: true, kind: "recipe", medium: "video" });
    expect(describePresetContent(content([groupShape("shape:g", "a")]))).toEqual({ ok: true, kind: "group" });
  });

  it.each([
    ["two roots", content([groupShape("shape:g", "a"), groupShape("shape:h", "b")])],
    ["a root that is not a group", content([promptShape("shape:p", "1", "x")])],
    ["a root id with no shape", { ...content([]), rootShapeIds: ["shape:gone"] }],
    ["not content at all", "a string"],
    ["shapes that are not a list", { schema: {}, shapes: "x", rootShapeIds: ["a"], assets: [] }],
  ])("refuses %s", (_case, value) => {
    expect(describePresetContent(value)).toEqual({ ok: false });
  });
});
