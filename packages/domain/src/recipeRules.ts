/**
 * Recipe groups (spec 06): a group's standing settings, spec 03's `GroupRecipe`, as the
 * composer's tray and the group's label speak it.
 */
import { readRunsValue, type RunsValue } from "./runsValue.ts";
import { modelPart } from "./toolbar.ts";

export type RecipeMedium = "image" | "video" | "text";
export type RecipeValue = string | number | boolean;

/** Spec 03's `GroupRecipe`: no instruction, no selection prompt, no references. */
export interface GroupRecipe {
  readonly medium: RecipeMedium;
  readonly model: string;
  readonly params: Readonly<Record<string, RecipeValue>>;
  /** 1 to 10, or Free; always 1 for video and text. */
  readonly runs: RunsValue;
}

/** What the Generate tray holds for one medium: its model and props, Runs among them for image. */
export interface RecipeTray {
  readonly medium: RecipeMedium;
  readonly model: string;
  readonly props: Readonly<Record<string, RecipeValue>>;
}

const RUNS = "runs";
const VIEW_FINAL_PROMPT = "viewFinalPrompt";
const MEDIA: ReadonlyArray<RecipeMedium> = ["image", "video", "text"];

const isValue = (value: unknown): value is RecipeValue => typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/** A recipe's params as stored: View final prompt only while it is on in Free, Runs never. */
const normalParams = (props: Readonly<Record<string, unknown>>, runs: RunsValue): Record<string, RecipeValue> => {
  const params: Record<string, RecipeValue> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === RUNS || key === VIEW_FINAL_PROMPT || !isValue(value)) continue;
    params[key] = value;
  }
  if (runs === "free" && props[VIEW_FINAL_PROMPT] === true) params[VIEW_FINAL_PROMPT] = true;
  return params;
};

const runsFor = (medium: RecipeMedium, value: unknown): RunsValue => (medium === "image" ? readRunsValue(value) : 1);

/** The tray as a group's recipe: the params are the tray's props, Runs is the recipe's runs. */
export const recipeFromTray = (tray: RecipeTray): GroupRecipe => {
  const runs = runsFor(tray.medium, tray.props[RUNS]);
  return { medium: tray.medium, model: tray.model, params: normalParams(tray.props, runs), runs };
};

/** A recipe as the tray holds it: its params, and Runs when it is not 1. */
export const trayFromRecipe = (recipe: GroupRecipe): RecipeTray => ({
  medium: recipe.medium,
  model: recipe.model,
  props: { ...normalParams(recipe.params, recipe.runs), ...(recipe.medium === "image" && recipe.runs !== 1 ? { [RUNS]: recipe.runs } : {}) },
});

/** A stored `meta.unframed.recipe` as a recipe, or `undefined` when it is not one. Anything but the four fields is dropped. */
export const readGroupRecipe = (value: unknown): GroupRecipe | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { medium, model, params, runs } = value as Record<string, unknown>;
  if (!MEDIA.includes(medium as RecipeMedium) || typeof model !== "string") return undefined;
  const kept: Record<string, RecipeValue> = {};
  if (typeof params === "object" && params !== null && !Array.isArray(params)) {
    for (const [key, each] of Object.entries(params)) if (isValue(each)) kept[key] = each;
  }
  return { medium: medium as RecipeMedium, model, params: kept, runs: runsFor(medium as RecipeMedium, runs) };
};

/** Whether two recipes would make the same run: same medium, model, runs and params, in any order. */
export const recipeEquals = (a: GroupRecipe, b: GroupRecipe): boolean => {
  if (a.medium !== b.medium || a.model !== b.model || a.runs !== b.runs) return false;
  const left = normalParams(a.params, a.runs);
  const right = normalParams(b.params, b.runs);
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && right[key] === left[key]);
};

const EXACT_SIZE = /^(\d+)x(\d+)$/;

const sizePart = (params: GroupRecipe["params"]): string | undefined => {
  const size = typeof params.size === "string" ? EXACT_SIZE.exec(params.size) : null;
  if (size) return size[1] === size[2] ? `${size[1]}²` : `${size[1]}×${size[2]}`;
  return typeof params.aspect_ratio === "string" && params.aspect_ratio !== "" ? params.aspect_ratio : undefined;
};

const durationPart = (duration: unknown): string | undefined =>
  (typeof duration === "number" && Number.isFinite(duration)) || (typeof duration === "string" && /^\d+(\.\d+)?$/.test(duration)) ? `${duration}s` : undefined;

/**
 * The chip on a recipe group's label: the model without its provider, then for image the
 * exact size (`1024²`, `1024×1536`) or else the ratio, for video the duration and the
 * resolution, then `×N` above one run or `Free`. Parts the recipe does not set are left out.
 */
export const recipeChip = (recipe: GroupRecipe): string => {
  const parts: Array<string | undefined> = [modelPart(recipe.model)];
  if (recipe.medium === "image") parts.push(sizePart(recipe.params));
  if (recipe.medium === "video") {
    parts.push(durationPart(recipe.params.duration));
    parts.push(typeof recipe.params.resolution === "string" && recipe.params.resolution !== "" ? recipe.params.resolution : undefined);
  }
  if (recipe.runs === "free") parts.push("Free");
  else if (recipe.runs > 1) parts.push(`×${recipe.runs}`);
  return parts.filter((part): part is string => part !== undefined).join(" · ");
};
