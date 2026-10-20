/**
 * What an agent's `generate` sends: the composer's own
 * selection-to-request rule, run over the shapes the agent named. Pure: the engine reads the
 * canvas and prices the run.
 */
import type { CanvasShape } from "../canvasShapes.ts";
import { composeSelection, type Composition, type Medium } from "../composition.ts";

/** The composer's sentence for a selection with nothing to make. */
export const NOTHING_TO_MAKE = "Nothing says what to make. Select a prompt, or type an instruction.";

/** The sentence an agent gets for a selection that needs a sketch or a composite. */
export const SKETCH_REFUSAL = "This needs a sketch or a marked picture, and an agent cannot draw those. Generate it in Unframed instead, from the selection in the app.";

export const unknownSource = (id: string): string => `There is no shape "${id}" on this canvas. Call canvas_read for the ids.`;

/** A video run makes one clip: the agent is told to leave `runs` out. */
export const VIDEO_RUNS_REFUSAL = "A video run makes one clip. Leave runs out, or set it to 1.";

/** A reference video on this computer needs a temporary public link, which an agent cannot consent to. */
export const LOCAL_CLIP_REFUSAL = "A reference video on this computer needs a temporary public link, and an agent cannot give that consent. Generate it in Unframed instead, from the selection in the app.";

/** A text run has no parameters, so an agent that sends some is told to leave them out. */
export const TEXT_PARAMS_REFUSAL = "A text run takes no params. Leave params out.";

/** A parameter the model does not take: the agent is told to leave it out for the default. */
export const paramRefusal = (model: string, key: string, value: unknown): string =>
  `Model "${model}" does not take ${key} "${String(value)}". Leave it out for the model's default.`;

/** The first parameter `supported` does not take, as its refusal; `undefined` when every one is taken. */
export const unsupportedParam = (
  model: string,
  params: Readonly<Record<string, string | number | boolean>>,
  supported: (key: string, value: unknown) => boolean,
): string | undefined => {
  for (const [key, value] of Object.entries(params)) if (!supported(key, value)) return paramRefusal(model, key, value);
  return undefined;
};

/** A reference as a recipe holds it: a project file, or a clip link. */
export type PlannedRef = { readonly kind: "image" | "video"; readonly file: string } | { readonly kind: "video"; readonly url: string };

export type AgentRunPlan =
  | {
      readonly ok: true;
      /** What is sent: the parts and the instruction, joined. */
      readonly prompt: string;
      /** The parts, joined: for the recipe. */
      readonly selectionPrompt: string;
      readonly instruction: string;
      readonly references: ReadonlyArray<PlannedRef>;
      /** Every shape that contributed, in order: for the recipe and the tether. */
      readonly sources: ReadonlyArray<string>;
      /** The composition the request is built from: a video's references and frames come from it. */
      readonly composition: Composition;
    }
  | { readonly ok: false; readonly message: string };

export interface AgentRunInput {
  readonly shapes: ReadonlyArray<CanvasShape>;
  /** Room shape ids, the ones the canvas holds. */
  readonly sources: ReadonlyArray<string>;
  readonly instruction: string;
  readonly medium: Medium;
  readonly referenceCap?: number | undefined;
}

export const planAgentRun = (input: AgentRunInput): AgentRunPlan => {
  const known = new Set(input.shapes.map((shape) => shape.id));
  const missing = input.sources.find((id) => !known.has(id));
  if (missing !== undefined) return { ok: false, message: unknownSource(missing.replace(/^shape:/, "")) };
  const composition = composeSelection({
    shapes: input.shapes,
    selected: input.sources,
    instruction: input.instruction,
    medium: input.medium,
    ...(input.referenceCap === undefined ? {} : { referenceCap: input.referenceCap }),
  });
  if (composition.error !== undefined) return { ok: false, message: composition.error };
  if (!composition.usable) return { ok: false, message: NOTHING_TO_MAKE };
  if (composition.references.some((slot) => slot.source.type === "composite" || slot.source.type === "sketch")) {
    return { ok: false, message: SKETCH_REFUSAL };
  }
  const references: PlannedRef[] = [];
  for (const slot of composition.references) {
    if (slot.source.type === "file") references.push({ kind: slot.kind, file: slot.source.file });
    else if (slot.source.type === "link") references.push({ kind: "video", url: slot.source.url });
  }
  return {
    ok: true,
    prompt: composition.prompt,
    selectionPrompt: composition.promptParts.join("\n\n"),
    instruction: composition.instruction,
    references,
    sources: [...composition.sources],
    composition,
  };
};
