/**
 * The text medium (spec 05): the composed selection through a vision text model, every
 * image and video slot attached, the answer landing as a text result. No props, no Runs,
 * no estimate: the tray shows the model and nothing else.
 */
import { joinPromptParts, NO_KEY_MESSAGE, type ModelParams } from "@unframed/domain";
import type { TLShapeId } from "tldraw";
import type { Payload } from "../rpc/engine.ts";
import { pageBox, selectionBox } from "./facts.ts";
import { saveLastUsed } from "./lastUsed.ts";
import { registerMedium, type MediumDefinition, type RunSource, type SendInput } from "./mediumRegistry.ts";
import { referencesFor } from "./render.ts";

export const NOTHING_TO_RUN = "Nothing to run. Select a prompt, or type an instruction.";

const NO_PARAMS: ModelParams = { props: [], referenceCap: undefined, supported: () => false };

const planOf = (source: RunSource) => {
  if (source.kind === "selection") {
    const { composition } = source;
    return { prompt: composition.prompt, error: composition.error, selectionPrompt: composition.promptParts.join("\n\n"), instruction: composition.instruction };
  }
  const { recipe } = source.recipe;
  return { prompt: joinPromptParts(recipe.selectionPrompt, source.instruction), error: source.error, selectionPrompt: recipe.selectionPrompt, instruction: source.instruction };
};

/** The request of a text run, from the live selection or a result's recorded recipe. */
export const textRunRequest = async ({ editor, project, values, source }: Omit<SendInput, "engine">): Promise<Payload<"run.text">> => {
  const plan = planOf(source);
  const common = {
    project,
    ...(values.model === undefined ? {} : { model: values.model }),
    selectionPrompt: plan.selectionPrompt,
    instruction: plan.instruction,
    prompt: plan.prompt,
  };
  if (source.kind === "selection") {
    return {
      ...common,
      references: await referencesFor(editor, project, source.composition.references),
      sources: [...source.composition.sources],
      anchor: selectionBox(editor, source.selected as TLShapeId[]) ?? { x: 0, y: 0, w: 0, h: 0 },
    };
  }
  const { recipe, shapeId } = source.recipe;
  return {
    ...common,
    references: [...recipe.references],
    sources: [...recipe.sources],
    anchor: pageBox(editor, shapeId as TLShapeId) ?? { x: 0, y: 0, w: 0, h: 0 },
    of: { shapeId, action: "recipe" },
  };
};

export const textMedium: MediumDefinition = {
  medium: "text",
  label: "text",
  catalogue: "text",
  dialogTitle: "Text models",
  browseUrl: "https://openrouter.ai/models?output_modalities=text&input_modalities=image",
  params: () => NO_PARAMS,
  defaults: () => ({}),
  reset: () => ({}),
  keep: () => ({}),
  pricing: async () => undefined,
  estimate: () => undefined,
  status: ({ source, hasKey }) => {
    const plan = planOf(source);
    const blockers: string[] = [];
    if (plan.error !== undefined) blockers.push(plan.error);
    else if (plan.prompt.trim() === "") blockers.push(NOTHING_TO_RUN);
    if (!hasKey) blockers.push(NO_KEY_MESSAGE);
    return { warnings: [], blockers };
  },
  sendLabel: () => "Run",
  send: async (input) => {
    await input.engine.call("run.text", await textRunRequest(input));
    void saveLastUsed(input.engine, "text", { ...(input.values.picked && input.values.model !== undefined ? { model: input.values.model } : {}), props: {} });
  },
  fromRecipe: () => ({}),
};

registerMedium(textMedium);
