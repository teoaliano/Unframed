import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describePresetContent, fencedText, plainText, presetWithTextModel, systemPresets } from "../src/index.ts";

const asset = (name: string) => readFileSync(new URL(`../../../assets/prompts/${name}`, import.meta.url), "utf8");
const layerizePlan = fencedText(asset("preset-layerize-plan.md"));
const proseToJson = fencedText(asset("preset-prose-to-json.md"));

describe("fencedText", () => {
  it("is the text block of a prompt asset, verbatim", () => {
    expect(layerizePlan.startsWith("You are writing prompts for an image generator, in plain prose only")).toBe(true);
    expect(layerizePlan).toContain('Start each section with "From image 1, recreate"');
    expect(layerizePlan.endsWith("No preamble, no numbering.")).toBe(true);
    // Its three blank-line paragraph breaks.
    expect(proseToJson.split("\n\n")).toHaveLength(4);
    expect(proseToJson.endsWith("rather than part of the prompt.")).toBe(true);
  });
});

describe("systemPresets", () => {
  const schema = { schemaVersion: 2, sequences: {} };
  const [layerize, toJson] = systemPresets({ layerizePlan, proseToJson, schema });

  it("builds Layerize: a text recipe group of a planner prompt over an empty image", () => {
    expect(layerize).toMatchObject({
      format: 2,
      id: "layerize",
      source: "system",
      name: "Layerize",
      summary: "Split an image into its parts as separate generations",
      needs: "Drop your picture into the image, then Generate to write the plan. Then select the plan with your picture, set Runs to Free and Generate.",
      kind: "recipe",
      medium: "text",
    });
    expect(layerize!.savedAt).toBeUndefined();
    const { shapes, rootShapeIds } = layerize!.content;
    const group = shapes.find((shape) => shape.id === rootShapeIds[0])!;
    expect(group).toMatchObject({ type: "frame", props: { w: 420, name: "layerize" }, meta: { unframed: { recipe: { medium: "text", model: "", params: {}, runs: 1 } } } });
    const members = shapes.filter((shape) => shape.parentId === group.id).sort((a, b) => a.y - b.y);
    expect(members.map((shape) => shape.type)).toEqual(["text", "image"]);
    expect(plainText(members[0]!.props.richText)).toBe(layerizePlan);
    expect(members[1]!.props.assetId).toBeNull();
    // Every member sits inside the box.
    for (const member of members) {
      expect(member.x).toBeGreaterThanOrEqual(0);
      expect(member.y + Number(member.props.h ?? 0)).toBeLessThanOrEqual(Number(group.props.h));
    }
    expect(describePresetContent(layerize!.content)).toEqual({ ok: true, kind: "recipe", medium: "text" });
  });

  it("builds Prose to JSON: a text recipe group of one prompt", () => {
    expect(toJson).toMatchObject({
      format: 2,
      id: "to-json",
      source: "system",
      name: "Prose to JSON",
      summary: "Turn a written prompt into a structured JSON spec you can reuse",
      needs: "Select your prompt together with this box, then Generate.",
      kind: "recipe",
      medium: "text",
    });
    const { shapes, rootShapeIds } = toJson!.content;
    const group = shapes.find((shape) => shape.id === rootShapeIds[0])!;
    expect(group).toMatchObject({ type: "frame", props: { name: "to-json" } });
    const members = shapes.filter((shape) => shape.parentId === group.id);
    expect(members).toHaveLength(1);
    expect(plainText(members[0]!.props.richText)).toBe(proseToJson);
    expect(toJson!.content.schema).toBe(schema);
  });

  it("takes the default text model when it is inserted", () => {
    const filled = presetWithTextModel(layerize!, "google/gemini-3-flash");
    const group = filled.content.shapes.find((shape) => shape.id === filled.content.rootShapeIds[0])!;
    expect(group.meta).toEqual({ unframed: { recipe: { medium: "text", model: "google/gemini-3-flash", params: {}, runs: 1 } } });
    // The built preset itself never pins a model.
    expect(layerize!.content.shapes.find((shape) => shape.type === "frame")!.meta).toMatchObject({ unframed: { recipe: { model: "" } } });
  });
});
