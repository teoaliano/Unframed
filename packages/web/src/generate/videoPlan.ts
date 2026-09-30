/**
 * The video request of a tray: the live selection's composition, or a recipe's recorded
 * references, put through the one video request rule.
 */
import type { ModelEntry, ResultRecipe } from "@unframed/contracts";
import { composeVideoRequest, joinPromptParts, type Composition, type Slot, type VideoCounts, type VideoRequestPlan } from "@unframed/domain";
import type { RunSource, TrayProps } from "./mediumRegistry.ts";

/** The shape id a recorded reference goes by in a recipe's composition. */
export const recipeSlotId = (index: number): string => `recipe:${index}`;

export const recipeSlotIndex = (id: string): number => Number(id.slice("recipe:".length));

/** A recipe's recorded references as the slots of a composition, in the order they were sent. */
export const recipeComposition = (recipe: ResultRecipe, instruction: string): Composition => {
  let images = 0;
  let videos = 0;
  const references: Slot[] = recipe.references.map((ref, index) => ({
    kind: ref.kind,
    number: ref.kind === "image" ? ++images : ++videos,
    shapeId: recipeSlotId(index),
    source: "url" in ref ? { type: "link", url: ref.url } : { type: "file", file: ref.file },
  }));
  const promptParts = recipe.selectionPrompt.split(/\n\n+/).filter((part) => part.trim() !== "");
  return {
    promptParts,
    prompt: joinPromptParts(recipe.selectionPrompt, instruction),
    instruction,
    references,
    roles: {},
    usable: true,
    sources: [...recipe.sources],
    warnings: [],
  };
};

export const videoPlan = (source: RunSource, props: TrayProps, entry: ModelEntry | undefined, urlOf?: (slot: Slot) => string): VideoRequestPlan =>
  composeVideoRequest({
    composition: source.kind === "selection" ? source.composition : recipeComposition(source.recipe.recipe, source.instruction),
    entry,
    props,
    ...(urlOf === undefined ? {} : { urlOf }),
  });

export const videoCounts = (source: RunSource, props: TrayProps, entry: ModelEntry | undefined): VideoCounts => videoPlan(source, props, entry).counts;
