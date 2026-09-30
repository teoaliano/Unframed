/**
 * The two presets that ship with the app (spec 06), Layerize and Prose to JSON: text recipe
 * groups built from the prompt text in assets, verbatim. They are never written to
 * `presets.json`, and their recipe takes the app's default text model when inserted.
 */
import { readGroupRecipe } from "./recipeRules.ts";
import type { ContentShape, Preset } from "./presetRules.ts";

const PAGE = "page:page";

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** The text inside a prompt asset's fenced block: model-facing text, used verbatim. */
export const fencedText = (markdown: string): string => {
  const match = /```[a-z]*\n([\s\S]*?)\n```/.exec(markdown);
  return match ? match[1]! : markdown.trim();
};

const richTextOf = (text: string) => ({
  type: "doc",
  content: text.split("\n").map((line) => (line === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] })),
});

const shapeBase = (id: string, type: string, x: number, y: number, parentId: string, index: string) => ({
  id,
  typeName: "shape" as const,
  type,
  x,
  y,
  rotation: 0,
  index,
  parentId,
  isLocked: false,
  opacity: 1,
});

const GROUP_WIDTH = 420;
const SIDE = 28;
const TOP = 56;
const GAP = 24;
const PROMPT_WIDTH = GROUP_WIDTH - 2 * SIDE;
const IMAGE = { w: 240, h: 140 };

/** A text recipe with no model yet: the default text model is filled in when it is inserted. */
const textRecipe = { medium: "text", model: "", params: {}, runs: 1 };

const promptMember = (id: string, ref: string, text: string, y: number, parent: string, index: string): ContentShape => ({
  ...shapeBase(id, "text", SIDE, y, parent, index),
  props: { color: "black", size: "s", w: PROMPT_WIDTH, font: "sans", textAlign: "start", autoSize: false, scale: 1, richText: richTextOf(text) },
  meta: { ref, sized: true },
});

const recipeGroup = (id: string, name: string, h: number): ContentShape => ({
  ...shapeBase(id, "frame", 0, 0, PAGE, "a1"),
  props: { w: GROUP_WIDTH, h, name, color: "black" },
  meta: { unframed: { recipe: textRecipe } },
});

/**
 * Layerize and Prose to JSON, both text recipe groups, their prompt text from the assets.
 * `layerizeTextHeight` and `proseTextHeight` are room for each prompt at the group's width.
 */
export const systemPresets = (input: {
  readonly layerizePlan: string;
  readonly proseToJson: string;
  readonly schema: unknown;
  readonly layerizeTextHeight?: number;
  readonly proseTextHeight?: number;
}): Preset[] => {
  const planHeight = input.layerizeTextHeight ?? 520;
  const imageY = TOP + planHeight + GAP;
  const layerize: Preset = {
    format: 2,
    id: "layerize",
    source: "system",
    name: "Layerize",
    summary: "Split an image into its parts as separate generations",
    needs: "Drop your picture into the image, then Generate to write the plan. Then select the plan with your picture, set Runs to Free and Generate.",
    kind: "recipe",
    medium: "text",
    content: {
      schema: input.schema,
      shapes: [
        recipeGroup("shape:layerize", "layerize", imageY + IMAGE.h + SIDE),
        promptMember("shape:layerize-plan", "100", input.layerizePlan, TOP, "shape:layerize", "a1"),
        {
          ...shapeBase("shape:layerize-image", "image", SIDE, imageY, "shape:layerize", "a2"),
          props: { ...IMAGE, playing: true, url: "", assetId: null, crop: null, flipX: false, flipY: false, altText: "" },
          meta: { ref: "101" },
        },
      ],
      rootShapeIds: ["shape:layerize"],
      assets: [],
      bindings: [],
    },
  };
  const proseHeight = input.proseTextHeight ?? 720;
  const toJson: Preset = {
    format: 2,
    id: "to-json",
    source: "system",
    name: "Prose to JSON",
    summary: "Turn a written prompt into a structured JSON spec you can reuse",
    needs: "Select your prompt together with this box, then Generate.",
    kind: "recipe",
    medium: "text",
    content: {
      schema: input.schema,
      shapes: [recipeGroup("shape:to-json", "to-json", TOP + proseHeight + SIDE), promptMember("shape:to-json-convert", "100", input.proseToJson, TOP, "shape:to-json", "a1")],
      rootShapeIds: ["shape:to-json"],
      assets: [],
      bindings: [],
    },
  };
  return [layerize, toJson];
};

/** A system preset with the app's default text model in its recipe, as it is inserted. */
export const presetWithTextModel = (preset: Preset, model: string): Preset => ({
  ...preset,
  content: {
    ...preset.content,
    shapes: preset.content.shapes.map((shape) => {
      const recipe = readGroupRecipe(record(shape.meta.unframed)?.recipe);
      if (shape.type !== "frame" || !preset.content.rootShapeIds.includes(shape.id) || recipe?.medium !== "text") return shape;
      return { ...shape, meta: { ...shape.meta, unframed: { ...record(shape.meta.unframed), recipe: { ...recipe, model } } } };
    }),
  },
});
