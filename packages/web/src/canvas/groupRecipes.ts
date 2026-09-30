/**
 * Recipe groups (spec 06): a group's standing recipe lives in `meta.unframed.recipe` and
 * syncs like any shape property. Saving, updating and clearing it are each one undo step,
 * and a group losing its recipe keeps its members and name.
 */
import { unframedMetaOf } from "@unframed/contracts";
import { readGroupRecipe, recipeGroupOf, type GroupRecipe } from "@unframed/domain";
import type { Editor, TLShape, TLShapeId } from "tldraw";
import { toolbarShape } from "../generate/facts.ts";

/** A group's standing recipe, if it has one. */
export const groupRecipeOf = (shape: TLShape | undefined): GroupRecipe | undefined =>
  shape?.type === "frame" ? readGroupRecipe(unframedMetaOf(shape).recipe) : undefined;

/** Writes (or with `undefined` removes) group `id`'s recipe as one undo step. */
export const setGroupRecipe = (editor: Editor, id: TLShapeId, recipe: GroupRecipe | undefined): void => {
  const shape = editor.getShape(id);
  if (shape?.type !== "frame") return;
  const { recipe: _old, ...rest } = unframedMetaOf(shape);
  const unframed = recipe ? { ...rest, recipe } : rest;
  editor.markHistoryStoppingPoint(recipe ? "save recipe" : "clear recipe");
  // tldraw merges a partial's meta into the shape's, so a field goes away only when set to undefined.
  editor.updateShape({ id, type: "frame", meta: { unframed: Object.keys(unframed).length > 0 ? unframed : undefined } } as never);
};

/** The one recipe group in the selection, whatever else is selected; none with two or more. */
export const appliedRecipe = (editor: Editor): { readonly group: TLShape; readonly recipe: GroupRecipe } | undefined => {
  const selected = editor.getSelectedShapes();
  const found = recipeGroupOf(selected.map((shape) => toolbarShape(editor, shape)));
  const group = found ? editor.getShape(found.id as TLShapeId) : undefined;
  const recipe = groupRecipeOf(group);
  return group && recipe ? { group, recipe } : undefined;
};
