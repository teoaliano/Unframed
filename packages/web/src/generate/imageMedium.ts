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
import { FinalPromptOverlay } from "./composer/FinalPromptDialog.tsx";
import { freeBlockers, mintBatchId, sendFree } from "./free.ts";
import { saveLastUsed } from "./lastUsed.ts";
import { registerMedium, type MediumDefinition, type PropValue, type RunSource, type SendInput, type SendOutcome, type TrayProps } from "./mediumRegistry.ts";
import { referencesFor } from "./render.ts";
import { runsOf, runsProp } from "./runsProp.tsx";

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
export const planOf = (source: RunSource) => {
  if (source.kind === "selection") {
    const { composition } = source;
    return { prompt: composition.prompt, error: composition.error, selectionPrompt: composition.promptParts.join("\n\n"), instruction: composition.instruction };
  }
  const { recipe } = source.recipe;
  return { prompt: joinPromptParts(recipe.selectionPrompt, source.instruction), error: source.error, selectionPrompt: recipe.selectionPrompt, instruction: source.instruction };
};

const send = async (input: SendInput): Promise<SendOutcome> => {
  const { editor, engine, project, values, source } = input;
  const runs = runsOf(values.props);
  const remember = () => {
    if (input.remember !== false) void saveLastUsed(engine, "image", { ...(values.picked && values.model !== undefined ? { model: values.model } : {}), props: { ...values.props } });
  };
  if (runs === "free") {
    const outcome = await sendFree(input, imageParams(values.props));
    remember();
    return outcome;
  }
  const plan = planOf(source);
  let request: Payload<"run.image">;
  const common = {
    project,
    batchId: mintBatchId(),
    ...(values.model === undefined ? {} : { model: values.model }),
    params: imageParams(values.props),
    selectionPrompt: plan.selectionPrompt,
    instruction: plan.instruction,
  };
  // A fixed count sends that many identical outputs as one batch.
  const outputs = (references: RecipeRef[]) => Array.from({ length: runs }, () => ({ prompt: plan.prompt, references }));
  if (source.kind === "selection") {
    const references: RecipeRef[] = await referencesFor(editor, project, source.composition.references);
    request = {
      ...common,
      outputs: outputs(references),
      sources: [...source.composition.sources],
      anchor: selectionBox(editor, source.selected as TLShapeId[]) ?? { x: 0, y: 0, w: 0, h: 0 },
    };
  } else {
    const { recipe, shapeId } = source.recipe;
    request = {
      ...common,
      outputs: outputs([...recipe.references]),
      sources: [...recipe.sources],
      anchor: pageBox(editor, shapeId as TLShapeId) ?? { x: 0, y: 0, w: 0, h: 0 },
      of: { shapeId, action: "recipe" },
    };
  }
  const started = await engine.call("run.image", request);
  remember();
  return { batchId: started.batchId };
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
    // Free prices one image, since nobody knows the count yet; a fixed count prices the batch.
    const runs = runsOf(props);
    const value = estimateImageRun({ endpoints: answer.endpoints, chosen, referenceImages: imageSlots(source), outputs: runs === "free" ? 1 : runs });
    if (value === null) return undefined;
    return runs === "free" ? `${formatEstimate(value)} / image` : formatEstimate(value);
  },
  status: ({ source, hasKey, props }) => {
    const blockers: string[] = [];
    if (props !== undefined && runsOf(props) === "free") blockers.push(...freeBlockers(source));
    else {
      const plan = planOf(source);
      if (plan.error !== undefined) blockers.push(plan.error);
      else if (plan.prompt.trim() === "") blockers.push(NOTHING_TO_MAKE);
    }
    if (!hasKey) blockers.push(NO_KEY_MESSAGE);
    return { warnings: source.kind === "selection" ? [...source.composition.warnings] : [], blockers };
  },
  sendLabel: (values) => {
    const runs = runsOf(values.props);
    return typeof runs === "number" && runs > 1 ? `Generate ${runs}×` : "Generate";
  },
  send,
  fromRecipe: (recipe) => ({ ...recipe.params }),
  trayProps: [runsProp],
  Overlay: FinalPromptOverlay,
};

registerMedium(imageMedium);
