import { describe, expect, it } from "vitest";
import { instantiate, placeAt, presetFiles, resolvePresetFiles } from "../src/index.ts";
import { content, groupShape, imageAsset, imageShape, promptShape, textOf } from "./presets.ts";

/** A minter that counts up from `from`, as the canvas's next ref would. */
const counter = (from: number) => {
  let next = from;
  return () => String(next++);
};

const preset = (name: string) =>
  content([
    groupShape("shape:g", name),
    promptShape("shape:a", "120", "@121 wears a red scarf, like @character in @200", { x: 28, y: 56 }, "shape:g"),
    promptShape("shape:b", "121", "a fox called @120-ish, not @1210", { x: 28, y: 120 }, "shape:g"),
    imageShape("shape:i", "122", null, { x: 28, y: 200 }, "shape:g"),
  ]);

const byId = (made: ReturnType<typeof instantiate>, id: string) => made.content.shapes.find((shape) => shape.id === id)!;

describe("instantiate", () => {
  it("mints a fresh @id for every prompt and medium, in order", () => {
    const made = instantiate(preset("character"), [], counter(300));
    expect(byId(made, "shape:a").meta.ref).toBe("300");
    expect(byId(made, "shape:b").meta.ref).toBe("301");
    expect(byId(made, "shape:i").meta.ref).toBe("302");
  });

  it("keeps a saved group's name when the canvas does not use it", () => {
    const made = instantiate(preset("character"), ["100", "fox"], counter(300));
    expect(byId(made, "shape:g").props.name).toBe("character");
    expect(made.rootId).toBe("shape:g");
  });

  it("suffixes a saved group's name when any @id on the canvas uses it", () => {
    expect(byId(instantiate(preset("character"), ["character"], counter(300)), "shape:g").props.name).toBe("character-2");
    expect(byId(instantiate(preset("character"), ["character", "character-2"], counter(300)), "shape:g").props.name).toBe("character-3");
  });

  it("re-mints a group whose @id was a minted one", () => {
    const made = instantiate(preset("150"), [], counter(300));
    expect(byId(made, "shape:g").props.name).toBe("300");
  });

  it("rewrites tokens that name a shape in the preset, and leaves the rest exactly as typed", () => {
    const made = instantiate(preset("character"), ["character"], counter(300));
    // @121 is the preset's own prompt; @character is the preset's group, now suffixed; @200 names nothing here.
    expect(textOf(byId(made, "shape:a"))).toBe("@301 wears a red scarf, like @character-2 in @200");
    // Whole tokens only: @120-ish and @1210 are other tokens.
    expect(textOf(byId(made, "shape:b"))).toBe("a fox called @120-ish, not @1210");
  });

  it("leaves the content it was given unchanged", () => {
    const original = preset("character");
    const copy = structuredClone(original);
    instantiate(original, ["character"], counter(300));
    expect(original).toEqual(copy);
  });
});

describe("placeAt", () => {
  it("centres the bounds on the point", () => {
    expect(placeAt({ x: 0, y: 0, w: 420, h: 280 }, { x: 1000, y: 500 })).toEqual({ x: 790, y: 360 });
    expect(placeAt({ x: -50, y: 20, w: 100, h: 60 }, { x: 0, y: 0 })).toEqual({ x: -50, y: -30 });
  });
});

describe("preset files", () => {
  const withFiles = content(
    [
      groupShape("shape:g", "set"),
      imageShape("shape:a", "1", "asset:a", { x: 0, y: 0 }, "shape:g"),
      imageShape("shape:b", "2", "asset:b", { x: 0, y: 0 }, "shape:g"),
      imageShape("shape:c", "3", "asset:c", { x: 0, y: 0 }, "shape:g"),
      imageShape("shape:d", "4", "asset:d", { x: 0, y: 0 }, "shape:g"),
    ],
    [
      imageAsset("asset:a", "preset-file:shoots/1-fox.png"),
      imageAsset("asset:b", "preset-file:/2-old.png"),
      imageAsset("asset:c", "preset-file:gone/3-lost.png"),
      imageAsset("asset:d", "https://example.com/clip.mp4"),
    ],
  );

  it("lists every file a preset points at, an empty project meaning the one it goes into", () => {
    expect(presetFiles(withFiles)).toEqual([
      { project: "shoots", file: "1-fox.png" },
      { project: "", file: "2-old.png" },
      { project: "gone", file: "3-lost.png" },
    ]);
  });

  it("puts each copy in place of its pointer under a fresh asset id, and empties the shapes whose file is missing", () => {
    let n = 0;
    const resolved = resolvePresetFiles(withFiles, [{ file: "9-fox.png" }, { file: "9-old.png" }, { missing: true }], () => `asset:new-${++n}`);
    expect(resolved.missing).toBe(1);
    expect(resolved.content.assets.map((asset) => [asset.id, asset.props.src])).toEqual([
      ["asset:new-1", "project-file:9-fox.png"],
      ["asset:new-2", "project-file:9-old.png"],
      ["asset:new-3", "https://example.com/clip.mp4"],
    ]);
    const assetOf = (id: string) => resolved.content.shapes.find((shape) => shape.id === id)!.props.assetId;
    expect([assetOf("shape:a"), assetOf("shape:b"), assetOf("shape:c"), assetOf("shape:d")]).toEqual(["asset:new-1", "asset:new-2", null, "asset:new-3"]);
    // Nothing that reaches the room holds a preset pointer.
    expect(JSON.stringify(resolved.content)).not.toContain("preset-file:");
  });
});
