import type { ImageParams, RecipeRef } from "@unframed/contracts";
import { defaultProps, estimateImageRun, formatEstimate, keepSupported, modelParams, resetProps } from "@unframed/domain";
import { pageBox, selectionBox } from "./facts.ts";
import { registerMedium, type MediumDefinition, type PropValue, type RunSource, type SendInput, type TrayProps } from "./media.ts";
import { referencesFor } from "./render.ts";
import { saveLastUsed } from "./lastUsed.ts";
import type { TLShapeId } from "tldraw";
import type { Payload } from "../rpc/engine.ts";

export const NO_KEY_LINE = "No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).";
export const NOTHING_TO_MAKE = "Nothing says what to make. Select a prompt, or type an instruction.";

const IMAGE_PARAM_KEYS = ["resolution", "quality", "aspect_ratio", "background", "output_format", "size"] as const;

/** The tray's props as the request's image params: model-driven keys only, as strings. */
export const imageParams = (props: TrayProps): ImageParams => {
  const params: Record<string, string> = {};
  for (const key of IMAGE_PARAM_KEYS) {
    const value = props[key];
    if (value !== undefined) params[key] = String(value);
  }
  return params;
};

const join = (...parts: ReadonlyArray<string>) =>
  parts
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");

/** How many image slots a run sends: every one, over the cap included. */
const imageSlots = (source: RunSource): number =>
  source.kind === "selection"
    ? source.composition.references.filter((slot) => slot.kind === "image").length
    : source.recipe.recipe.references.filter((ref) => ref.kind === "image").length;

const promptOf = (source: RunSource): string =>
  source.kind === "selection" ? source.composition.prompt : join(source.recipe.recipe.selectionPrompt, source.instruction);

const send = async ({ editor, engine, project, values, source }: SendInput) => {
  let references: RecipeRef[];
  let request: Payload<"run.image">;
  const params = imageParams(values.props);
  const model = values.model === undefined ? {} : { model: values.model };
  if (source.kind === "selection") {
    const { composition } = source;
    references = await referencesFor(editor, project, composition.references);
    const anchor = selectionBox(editor, source.selected as TLShapeId[]) ?? { x: 0, y: 0, w: 0, h: 0 };
    request = {
      project,
      ...model,
      params,
      selectionPrompt: composition.promptParts.join("\n\n"),
      instruction: composition.instruction,
      outputs: [{ prompt: composition.prompt, references }],
      sources: [...composition.sources],
      anchor,
    };
  } else {
    const { recipe, shapeId } = source.recipe;
    const anchor = pageBox(editor, shapeId as TLShapeId) ?? { x: 0, y: 0, w: 0, h: 0 };
    request = {
      project,
      ...model,
      params,
      selectionPrompt: recipe.selectionPrompt,
      instruction: source.instruction.trim(),
      outputs: [{ prompt: join(recipe.selectionPrompt, source.instruction), references: [...recipe.references] }],
      sources: [...recipe.sources],
      anchor,
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
  estimate: ({ pricing, props, source }) => {
    if (!pricing) return undefined;
    const chosen = { ...(typeof props.quality === "string" ? { quality: props.quality } : {}), ...(typeof props.resolution === "string" ? { resolution: props.resolution } : {}) };
    const value = estimateImageRun({ endpoints: pricing.endpoints, chosen, referenceImages: imageSlots(source), outputs: 1 });
    return value === null ? undefined : formatEstimate(value);
  },
  status: ({ source, hasKey }) => {
    const warnings = source.kind === "selection" ? [...source.composition.warnings] : [];
    const blockers: string[] = [];
    const error = source.kind === "selection" ? source.composition.error : undefined;
    if (error !== undefined) blockers.push(error);
    else if (promptOf(source).trim() === "") blockers.push(NOTHING_TO_MAKE);
    if (!hasKey) blockers.push(NO_KEY_LINE);
    return { warnings, blockers };
  },
  sendLabel: () => "Generate",
  send,
  fromRecipe: (recipe) => ({ ...recipe.params }),
};

registerMedium(imageMedium);
