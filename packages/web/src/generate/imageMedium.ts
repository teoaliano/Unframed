import type { ImageParams, ImagePricingAnswer, RecipeRef } from "@unframed/contracts";
import {
  defaultProps,
  estimateImageRun,
  formatEstimate,
  joinPromptParts,
  keepSupported,
  MODEL_DRIVEN_PROPS,
  modelParams,
  NO_KEY_MESSAGE,
  resetProps,
} from "@unframed/domain";
import type { TLShapeId } from "tldraw";
import type { Payload } from "../rpc/engine.ts";
import { pageBox, selectionBox } from "./facts.ts";
import { saveLastUsed } from "./lastUsed.ts";
import { registerMedium, type MediumDefinition, type PropValue, type RunSource, type SendInput, type TrayProps } from "./mediumRegistry.ts";
import { referencesFor } from "./render.ts";

export const NOTHING_TO_MAKE = "Nothing says what to make. Select a prompt, or type an instruction.";

/** The tray's props as the request's image params: model-driven keys only, as strings. */
export const imageParams = (props: TrayProps): ImageParams => {
  const params: Record<string, string> = {};
  for (const key of MODEL_DRIVEN_PROPS) {
    const value = props[key];
    if (value !== undefined) params[key] = String(value);
  }
  return params;
};

/** How many image slots a run sends: every one, over the cap included. */
const imageSlots = (source: RunSource): number =>
  source.kind === "selection"
    ? source.composition.references.filter((slot) => slot.kind === "image").length
    : source.recipe.recipe.references.filter((ref) => ref.kind === "image").length;

/** A run's prompt, its error and the rest of its request, from the live selection or a recipe. */
const planOf = (source: RunSource) => {
  if (source.kind === "selection") {
    const { composition } = source;
    return { prompt: composition.prompt, error: composition.error, selectionPrompt: composition.promptParts.join("\n\n"), instruction: composition.instruction };
  }
  const { recipe } = source.recipe;
  return { prompt: joinPromptParts(recipe.selectionPrompt, source.instruction), error: source.error, selectionPrompt: recipe.selectionPrompt, instruction: source.instruction };
};

const send = async ({ editor, engine, project, values, source }: SendInput) => {
  const plan = planOf(source);
  let request: Payload<"run.image">;
  const common = {
    project,
    ...(values.model === undefined ? {} : { model: values.model }),
    params: imageParams(values.props),
    selectionPrompt: plan.selectionPrompt,
    instruction: plan.instruction,
  };
  if (source.kind === "selection") {
    const references: RecipeRef[] = await referencesFor(editor, project, source.composition.references);
    request = {
      ...common,
      outputs: [{ prompt: plan.prompt, references }],
      sources: [...source.composition.sources],
      anchor: selectionBox(editor, source.selected as TLShapeId[]) ?? { x: 0, y: 0, w: 0, h: 0 },
    };
  } else {
    const { recipe, shapeId } = source.recipe;
    request = {
      ...common,
      outputs: [{ prompt: plan.prompt, references: [...recipe.references] }],
      sources: [...recipe.sources],
      anchor: pageBox(editor, shapeId as TLShapeId) ?? { x: 0, y: 0, w: 0, h: 0 },
      of: { shapeId, action: "recipe" },
    };
  }
  await engine.call("run.image", request);
  void saveLastUsed(engine, "image", { ...(values.picked && values.model !== undefined ? { model: values.model } : {}), props: { ...values.props } });
};

export const imageMedium: MediumDefinition = {
  medium: "image",
  label: "image",
  catalogue: "image",
  dialogTitle: "Image models",
  browseUrl: "https://openrouter.ai/models?output_modalities=image",
  params: (entry) => modelParams(entry),
  defaults: (params) => defaultProps(params),
  reset: (props, params) => resetProps(props, params) as Record<string, PropValue>,
  keep: (props, params) => keepSupported(props, params) as Record<string, PropValue>,
  pricing: (engine, id) => engine.call("models.imagePricing", { id }),
  estimate: ({ pricing, props, source }) => {
    const answer = pricing as ImagePricingAnswer | undefined;
    if (!answer) return undefined;
    const chosen = {
      ...(typeof props.quality === "string" ? { quality: props.quality } : {}),
      ...(typeof props.resolution === "string" ? { resolution: props.resolution } : {}),
    };
    const value = estimateImageRun({ endpoints: answer.endpoints, chosen, referenceImages: imageSlots(source), outputs: 1 });
    return value === null ? undefined : formatEstimate(value);
  },
  status: ({ source, hasKey }) => {
    const plan = planOf(source);
    const blockers: string[] = [];
    if (plan.error !== undefined) blockers.push(plan.error);
    else if (plan.prompt.trim() === "") blockers.push(NOTHING_TO_MAKE);
    if (!hasKey) blockers.push(NO_KEY_MESSAGE);
    return { warnings: source.kind === "selection" ? [...source.composition.warnings] : [], blockers };
  },
  sendLabel: () => "Generate",
  send,
  fromRecipe: (recipe) => ({ ...recipe.params }),
};

registerMedium(imageMedium);
