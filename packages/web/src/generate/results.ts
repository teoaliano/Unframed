/**
 * A result's actions. Regenerate and Vary repeat the recorded recipe through `run.image`;
 * they read only the sidecar and the project files, so deleting a source never breaks them.
 */
import type { RecipeRef, ResultRecipe } from "@unframed/contracts";
import { modelParams } from "@unframed/domain";
import type { Editor, TLShapeId } from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";
import { knownCatalogue } from "./catalogue.ts";
import { mediaSource, pageBox } from "./facts.ts";
import { imageParams } from "./imageMedium.ts";

const join = (...parts: ReadonlyArray<string>) =>
  parts
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");

/** The Vary tooltip when the recipe already uses every reference the model takes. */
export const varyCapMessage = (cap: number) => `This model takes at most ${cap} references, and this recipe already uses them.`;

/** The reference cap of a recipe's model, from the session's catalogue. */
export const capOf = (model: string): number | undefined =>
  modelParams(knownCatalogue("image")?.models.find((entry) => entry.id === model)).referenceCap;

/** Whether Vary would send more references than the recipe's model takes. */
export const varyBlocked = (recipe: ResultRecipe): number | undefined => {
  const cap = capOf(recipe.model);
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
  const references: RecipeRef[] = [...recorded.references];
  if (action === "vary") {
    const shape = editor.getShape(shapeId);
    const file = shape ? mediaSource(editor, shape).file : undefined;
    if (file === undefined) throw new Error("This result has no picture to vary.");
    references.push({ kind: "image", file });
  }
  const anchor = pageBox(editor, shapeId) ?? { x: 0, y: 0, w: 0, h: 0 };
  await engine.call("run.image", {
    project,
    model: recorded.model,
    params: imageParams(recorded.params),
    selectionPrompt: recorded.selectionPrompt,
    instruction: recorded.instruction,
    outputs: [{ prompt: join(recorded.selectionPrompt, recorded.instruction), references }],
    sources: [...recorded.sources],
    anchor,
    of: { shapeId, action },
  });
};
