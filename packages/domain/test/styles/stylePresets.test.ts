import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describePresetContent,
  presetCase,
  presetFiles,
  presetFromSelection,
  resolvePresetFiles,
  STYLE_PRESETS,
  STYLE_SIZE_LIMIT,
  stylePresets,
} from "../../src/index.ts";
import { content, groupShape, promptShape, styleShape } from "../presets.ts";

const designMd = join(import.meta.dirname, "../../../../assets/design-md");

describe("the shipped styles", () => {
  it("are the ten DESIGN.md files under assets, each within the style size limit, as style presets", () => {
    expect(STYLE_PRESETS.map((style) => style.folder)).toEqual(["apple", "claude", "vercel", "notion", "airbnb", "linear.app", "stripe", "figma", "bmw-m", "coinbase"]);
    for (const style of STYLE_PRESETS) {
      const size = statSync(join(designMd, style.folder, "DESIGN.md")).size;
      expect(size, style.folder).toBeGreaterThan(0);
      expect(size, style.folder).toBeLessThanOrEqual(STYLE_SIZE_LIMIT);
    }
    expect(readFileSync(join(designMd, "LICENSE"), "utf8")).toContain("MIT License");
    const presets = stylePresets({});
    expect(presets.map((preset) => [preset.id, preset.kind, preset.source])).toContainEqual(["style-linear", "style", "system"]);
    expect(presets.every((preset) => describePresetContent(preset.content).ok)).toBe(true);
  });
});

describe("a style in the library", () => {
  it("is its own preset when selected alone, its file a pointer to the project it came from", () => {
    expect(presetCase([{ id: "s", type: "style" }]).kind).toBe("style");
    expect(presetCase([{ id: "s", type: "style" }, { id: "p", type: "text" }]).kind).toBe("wrap");
    const made = presetFromSelection({ project: "brand", content: content([styleShape("shape:s", "linear", "1-linear.md", { x: 300, y: 40 })]), bounds: {} }, { name: "Linear" });
    expect(made).toMatchObject({ ok: true, kind: "style", members: 1 });
    if (!made.ok) return;
    expect(made.content.rootShapeIds).toEqual(["shape:s"]);
    expect(made.content.shapes[0]!.props.file).toBe("preset-file:brand/1-linear.md");
    expect(describePresetContent(made.content)).toEqual({ ok: true, kind: "style" });
  });

  it("travels inside a saved group too, and its file is copied in on insert, or left empty when it is gone", () => {
    const made = presetFromSelection(
      { project: "brand", content: content([groupShape("shape:g", "kit"), styleShape("shape:s", "linear", "1-linear.md", { x: 28, y: 56 }, "shape:g"), promptShape("shape:p", "101", "hero", { x: 28, y: 320 }, "shape:g")]), bounds: {} },
      { name: "Kit" },
    );
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(presetFiles(made.content)).toEqual([{ project: "brand", file: "1-linear.md" }]);
    const copied = resolvePresetFiles(made.content, [{ file: "9-linear.md" }], () => "asset:new");
    expect(copied.content.shapes.find((shape) => shape.type === "style")?.props.file).toBe("9-linear.md");
    const gone = resolvePresetFiles(made.content, [{ missing: true }], () => "asset:new");
    expect(gone.missing).toBe(1);
    expect(gone.content.shapes.find((shape) => shape.type === "style")?.props.file).toBe("");
  });
});
