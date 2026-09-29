/**
 * A result's actions. Regenerate and Vary repeat the recorded recipe through `run.image`;
 * they read only the sidecar and the project files, so deleting a source never breaks them.
 */
import type { RecipeRef, ResultRecipe } from "@unframed/contracts";
import { joinPromptParts, modelParams } from "@unframed/domain";
import type { Editor, TLShapeId } from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";
import { knownCatalogue } from "./catalogue.ts";
import { mediaSource, pageBox } from "./facts.ts";
import { imageParams } from "./imageMedium.ts";
import { repeatVideo } from "./videoMedium.ts";

/** The Vary tooltip when the recipe already uses every reference the model takes. */
export const varyCapMessage = (cap: number) => `This model takes at most ${cap} references, and this recipe already uses them.`;

/** The model's reference cap, when Vary would send more references than it takes. */
export const varyBlocked = (recipe: ResultRecipe): number | undefined => {
  const cap = modelParams(knownCatalogue("image")?.models.find((entry) => entry.id === recipe.model)).referenceCap;
  const images = recipe.references.filter((ref) => ref.kind === "image").length;
  return cap !== undefined && images + 1 > cap ? cap : undefined;
};

/**
 * Regenerate: the recipe exactly, one output, beside the result. Vary: the same with the
 * result's own file appended as the last image reference.
 */
export const repeatResult = async (
  editor: Editor,
  engine: EngineConnection,
  project: string,
  shapeId: TLShapeId,
  action: "regenerate" | "vary",
  recipe?: ResultRecipe,
): Promise<void> => {
  const recorded = recipe ?? (await engine.call("recipe.read", { project, shapeId }));
  if (recorded.medium === "video") return repeatVideo(editor, engine, project, shapeId, action, recorded);
  if (recorded.medium === "text") {
    // A text result (spec 05) has no Vary: Regenerate repeats its run through the text medium.
    await engine.call("run.text", {
      project,
      model: recorded.model,
      selectionPrompt: recorded.selectionPrompt,
      instruction: recorded.instruction,
      prompt: joinPromptParts(recorded.selectionPrompt, recorded.instruction),
      references: [...recorded.references],
      sources: [...recorded.sources],
      anchor: pageBox(editor, shapeId) ?? { x: 0, y: 0, w: 0, h: 0 },
      of: { shapeId, action: "regenerate" },
    });
    return;
  }
  const references: RecipeRef[] = [...recorded.references];
  if (action === "vary") {
    const shape = editor.getShape(shapeId);
    const file = shape ? mediaSource(editor, shape).file : undefined;
    if (file === undefined) throw new Error("This result has no picture to vary.");
    references.push({ kind: "image", file });
  }
  await engine.call("run.image", {
    project,
    model: recorded.model,
    params: imageParams(recorded.params),
    selectionPrompt: recorded.selectionPrompt,
    instruction: recorded.instruction,
    outputs: [{ prompt: joinPromptParts(recorded.selectionPrompt, recorded.instruction), references }],
    sources: [...recorded.sources],
    anchor: pageBox(editor, shapeId) ?? { x: 0, y: 0, w: 0, h: 0 },
    of: { shapeId, action },
  });
};
