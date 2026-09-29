/**
 * Approximate recipes (spec 03, for spec 11's imported results): the old app recorded what
 * it sent as one prompt, never which shapes or files. Regenerate, Vary and Recipe on such a
 * result recompose the run from its sources as they are on the canvas now, by the selection
 * to request rule, skipping any that are gone, with the recipe's model and params.
 */
import type { ResultRecipe } from "@unframed/contracts";
import { composeSelection, type Composition } from "@unframed/domain";
import type { Editor, TLShapeId } from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";
import { canvasShapes, mediaSource, pageBox } from "./facts.ts";
import { imageParams, NOTHING_TO_MAKE } from "./imageMedium.ts";
import type { RunSource } from "./mediumRegistry.ts";
import { referencesFor } from "./render.ts";
import { textRunRequest } from "./textMedium.ts";
import { entryFor, fromRecipe, recordedSettings, videoStartRequest } from "./videoMedium.ts";

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

/** Vary: the result's own file, after everything the sources send. */
const withOwnFile = (composition: Composition, kind: "image" | "video", shapeId: string, file: string): Composition => {
  const number = composition.references.filter((slot) => slot.kind === kind).length + 1;
  return { ...composition, references: [...composition.references, { kind, number, shapeId, source: { type: "file", file } }], usable: true };
};

export const repeatApproximate = async (
  editor: Editor,
  engine: EngineConnection,
  project: string,
  shapeId: TLShapeId,
  action: "regenerate" | "vary",
  recipe: ResultRecipe,
): Promise<void> => {
  const live = liveSource(editor, shapeId, recipe, "");
  if (live.composition.error !== undefined) throw new Error(live.composition.error);
  const shape = editor.getShape(shapeId);
  const own = shape ? mediaSource(editor, shape).file : undefined;
  if (action === "vary" && own === undefined) throw new Error("This result has no file to vary.");
  const composition = action === "vary" && recipe.medium !== "text" ? withOwnFile(live.composition, recipe.medium, shapeId, own!) : live.composition;
  if (composition.prompt.trim() === "" && composition.references.length === 0) throw new Error(NOTHING_TO_MAKE);
  const source = { ...live, composition };
  const anchor = pageBox(editor, shapeId) ?? { x: 0, y: 0, w: 0, h: 0 };
  const of = { shapeId, action };

  if (recipe.medium === "video") {
    const request = await videoStartRequest({
      editor,
      project,
      model: recipe.model,
      props: fromRecipe(recipe),
      source,
      entry: entryFor(recipe.model),
      anchor,
      settings: recordedSettings(recipe.params),
    });
    await engine.call("video.start", request);
    return;
  }
  if (recipe.medium === "text") {
    const request = await textRunRequest({ editor, project, values: { model: recipe.model, picked: false, props: {} }, source });
    await engine.call("run.text", { ...request, anchor, of: { shapeId, action: "regenerate" } });
    return;
  }
  await engine.call("run.image", {
    project,
    model: recipe.model,
    params: imageParams(recipe.params),
    selectionPrompt: composition.promptParts.join("\n\n"),
    instruction: "",
    outputs: [{ prompt: composition.prompt, references: await referencesFor(editor, project, composition.references) }],
    sources: [...composition.sources],
    anchor,
    of,
  });
};
