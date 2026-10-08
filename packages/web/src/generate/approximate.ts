/**
 * Approximate recipes (spec 03, for spec 11's imported results): the old app recorded what
 * it sent as one prompt, never which shapes or files. Recipe mode on such a result
 * recomposes the run from its sources as they are on the canvas now, by the selection to
 * request rule, skipping any that are gone, with the recipe's model and params.
 */
import type { ResultRecipe } from "@unframed/contracts";
import { composeSelection } from "@unframed/domain";
import type { Editor } from "tldraw";
import { canvasShapes } from "./facts.ts";
import type { RunSource } from "./mediumRegistry.ts";

/** What the Recipe mode of an imported result says above the box. */
export const IMPORTED_RECIPE_NOTE = "Imported from the old app. It sent:";

/** The recipe's sources still on the canvas, composed as a selection with `instruction`, answering for result `shapeId`. */
export const liveSource = (editor: Editor, shapeId: string, recipe: ResultRecipe, instruction: string): Extract<RunSource, { kind: "selection" }> => {
  const shapes = canvasShapes(editor);
  const present = new Set(shapes.map((shape) => shape.id));
  const selected = recipe.sources.filter((id) => present.has(id));
  const composition = composeSelection({ shapes, selected, instruction, medium: recipe.medium });
  return { kind: "selection", composition, selected, shapes, instruction, answersFor: shapeId };
};
