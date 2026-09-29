/** The video medium (spec 04), registered into spec 03's Generate tray. */
import { projectFileMarker, resultMetaOf, type ModelEntry, type RecipeRef, type ResultRecipe } from "@unframed/contracts";
import {
  addableVideoValue,
  clearsInputMode,
  estimateVideo,
  formatVideoEstimate,
  keepVideoProps,
  NO_KEY_MESSAGE,
  placeResults,
  resetVideoProps,
  shareConsent,
  videoDefaults,
  videoParams,
  videoSettings,
  videoStatusLines,
  type Slot,
  type VideoParams,
  type VideoSettings,
} from "@unframed/domain";
import type { Editor, TLShapeId } from "tldraw";
import type { EngineConnection, Payload } from "../rpc/engine.ts";
import { knownCatalogue } from "./catalogue.ts";
import { VideoStatus } from "./composer/VideoStatus.tsx";
import { anchorOf, answeredShape, mediaSource, pageBox } from "./facts.ts";
import { NOTHING_TO_MAKE } from "./imageMedium.ts";
import { saveLastUsed } from "./lastUsed.ts";
import { registerMedium, type MediumDefinition, type PropValue, type RunSource, type SendInput, type TrayProps } from "./mediumRegistry.ts";
import { referencesFor } from "./render.ts";
import { recipeSlotIndex, videoPlan } from "./videoPlan.ts";

/** A render placeholder's width, as spec 03's placeholders. */
export const RENDER_WIDTH = 320;

const asVideo = (params: unknown) => params as VideoParams;

/** The circular reference that stops a run, from the selection or the recipe mode's instruction. */
const errorOf = (source: RunSource) => (source.kind === "selection" ? source.composition.error : source.error);

/** The placeholder's height at its width: from the chosen ratio or exact size, else 16:9. */
export const renderHeight = (settings: VideoSettings): number => {
  const ratio = settings.size !== undefined ? /^(\d+)x(\d+)$/.exec(settings.size) : settings.aspect_ratio !== undefined ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(settings.aspect_ratio) : null;
  const w = ratio ? Number(ratio[1]) : 16;
  const h = ratio ? Number(ratio[2]) : 9;
  return w > 0 && h > 0 ? (RENDER_WIDTH * h) / w : (RENDER_WIDTH * 9) / 16;
};

/** Where a render lands: spec 03's result placement from `anchor`, clear of every shape on the page. */
export const landingFor = (editor: Editor, anchor: { x: number; y: number; w: number; h: number }, settings: VideoSettings) => {
  const h = renderHeight(settings);
  const obstacles = editor.getCurrentPageShapes().flatMap((shape) => pageBox(editor, shape.id) ?? []);
  const [at] = placeResults(anchor, [{ w: RENDER_WIDTH, h }], obstacles);
  return { x: at!.x, y: at!.y, w: RENDER_WIDTH, h };
};

/** The recipe's params: the props that were sent, as the tray names them, plus the share consent. */
export const recipeParams = (mode: string, settings: VideoSettings, consent: boolean): Record<string, string | number | boolean> => ({
  inputMode: mode,
  ...settings,
  shareLocalVideos: consent,
});

const urlOfRef = (ref: RecipeRef) => ("url" in ref ? ref.url : projectFileMarker(ref.file));

/**
 * The `video.start` request for a run: the sent slots rendered and uploaded (composites and
 * the sketch only when they are sent), the request built from those files, the landing spot
 * and the recipe.
 */
export const videoStartRequest = async (input: {
  readonly editor: Editor;
  readonly project: string;
  readonly model: string | undefined;
  readonly props: TrayProps;
  readonly source: RunSource;
  readonly entry: ModelEntry | undefined;
  readonly anchor: { x: number; y: number; w: number; h: number };
  readonly of?: ResultRecipe["of"] | undefined;
  /** Sent as they are, in place of the tray's values checked against the model (Regenerate and Vary). */
  readonly settings?: VideoSettings | undefined;
}): Promise<Payload<"video.start">> => {
  const { editor, project, props, source, entry } = input;
  const arranged = videoPlan(source, props, entry);
  const sentRefs: RecipeRef[] =
    source.kind === "selection"
      ? await referencesFor(editor, project, arranged.sent)
      : arranged.sent.map((slot) => source.recipe.recipe.references[recipeSlotIndex(slot.shapeId)]!);
  const bySlot = new Map<Slot, RecipeRef>(arranged.sent.map((slot, index) => [slot, sentRefs[index]!]));
  const plan = videoPlan(source, props, entry, (slot) => urlOfRef(bySlot.get(slot)!));
  const { prompt, input_references, frame_images, ...checked } = plan.request;
  const settings = input.settings ?? checked;
  const consent = shareConsent(props.shareLocalVideos);
  const model = input.model ?? knownCatalogue("video")?.default ?? "";
  const text =
    source.kind === "selection"
      ? { selectionPrompt: source.composition.promptParts.join("\n\n"), instruction: source.composition.instruction, sources: source.composition.sources }
      : { selectionPrompt: source.recipe.recipe.selectionPrompt, instruction: source.instruction, sources: source.recipe.recipe.sources };
  const recipe: ResultRecipe = {
    medium: "video",
    model,
    params: recipeParams(plan.mode, settings, consent),
    selectionPrompt: text.selectionPrompt,
    instruction: text.instruction,
    references: sentRefs,
    sources: [...text.sources],
    ...(input.of === undefined ? {} : { of: input.of }),
  };
  return {
    project,
    prompt,
    input_references,
    frame_images,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...settings,
    shareLocalVideos: consent,
    landing: landingFor(editor, input.anchor, settings),
    recipe,
  };
};

export const entryFor = (model: string | undefined) => knownCatalogue("video")?.models.find((entry) => entry.id === model);

const send = async ({ editor, engine, project, values, source, remember }: SendInput) => {
  const anchor = anchorOf(editor, source);
  const answered = answeredShape(source);
  const recorded = answered === undefined ? undefined : editor.getShape(answered as TLShapeId);
  const sidecar = recorded ? resultMetaOf(recorded)?.sidecar : undefined;
  const request = await videoStartRequest({
    editor,
    project,
    model: values.model,
    props: values.props,
    source,
    entry: entryFor(values.model),
    anchor,
    ...(typeof sidecar === "string" ? { of: { sidecar, action: "recipe" as const } } : {}),
  });
  const started = await engine.call("video.start", request);
  const { shareLocalVideos, ...props } = values.props;
  if (remember !== false) {
    void saveLastUsed(engine, "video", {
      ...(values.picked && values.model !== undefined ? { model: values.model } : {}),
      props,
      ...(typeof shareLocalVideos === "boolean" ? { shareLocalVideos } : {}),
    });
  }
  return { shapeIds: [started.shapeId] };
};

/** The tray's props from a recipe: its recorded params, the duration as the tray names it. */
export const fromRecipe = (recipe: ResultRecipe): TrayProps => {
  const props: Record<string, PropValue> = { ...recipe.params };
  if (typeof props.duration === "number") props.duration = String(props.duration);
  return props;
};

/** A recipe's recorded params as a request sends them: exactly as recorded, whatever the catalogue says now. */
export const recordedSettings = (params: ResultRecipe["params"]): VideoSettings => ({
  ...(typeof params.duration === "number" ? { duration: params.duration } : {}),
  ...(typeof params.resolution === "string" ? { resolution: params.resolution } : {}),
  ...(typeof params.aspect_ratio === "string" ? { aspect_ratio: params.aspect_ratio } : {}),
  ...(typeof params.size === "string" ? { size: params.size } : {}),
  ...(typeof params.generate_audio === "boolean" ? { generate_audio: params.generate_audio } : {}),
});

/**
 * Regenerate and Vary on a video result: the recorded recipe exactly, through `video.start`,
 * beside the result. Vary adds the result's own clip as the last video reference; the one
 * video rule then decides whether it is sent, so in a frame mode it is not.
 */
export const repeatVideo = async (
  editor: Editor,
  engine: EngineConnection,
  project: string,
  shapeId: TLShapeId,
  action: "regenerate" | "vary",
  recorded: ResultRecipe,
): Promise<void> => {
  const shape = editor.getShape(shapeId);
  const clip = shape ? mediaSource(editor, shape).file : undefined;
  if (action === "vary" && clip === undefined) throw new Error("This result has no clip to vary.");
  const recipe: ResultRecipe = action === "vary" ? { ...recorded, references: [...recorded.references, { kind: "video", file: clip! }] } : recorded;
  const sidecar = shape ? resultMetaOf(shape)?.sidecar : undefined;
  const request = await videoStartRequest({
    editor,
    project,
    model: recorded.model,
    props: fromRecipe(recorded),
    source: { kind: "recipe", recipe: { shapeId, recipe, selection: [] }, instruction: recorded.instruction },
    entry: entryFor(recorded.model),
    anchor: pageBox(editor, shapeId) ?? { x: 0, y: 0, w: 0, h: 0 },
    settings: recordedSettings(recorded.params),
    ...(typeof sidecar === "string" ? { of: { sidecar, action } } : {}),
  });
  await engine.call("video.start", request);
};

export const videoMedium: MediumDefinition = {
  medium: "video",
  label: "video",
  catalogue: "video",
  dialogTitle: "Video models",
  browseUrl: "https://openrouter.ai/models?output_modalities=video",
  params: (entry, props) => videoParams(entry, props),
  defaults: (params) => videoDefaults(asVideo(params)),
  reset: (props, params) => resetVideoProps(props, asVideo(params)),
  keep: (props, params) => keepVideoProps(props, asVideo(params)),
  // The price comes with the catalogue entry, which the estimate reads.
  pricing: async () => null,
  estimate: ({ props, entry }) => {
    const settings = videoSettings(entry, props);
    const value = estimateVideo({ pricing: entry?.pricing, resolution: settings.resolution, duration: settings.duration });
    return value === null ? undefined : formatVideoEstimate(value);
  },
  status: ({ source, hasKey, props = {}, entry }) => {
    const plan = videoPlan(source, props, entry);
    const error = errorOf(source);
    const blockers: string[] = [];
    if (error !== undefined) blockers.push(error);
    else if (plan.request.prompt.trim() === "") blockers.push(NOTHING_TO_MAKE);
    if (!hasKey) blockers.push(NO_KEY_MESSAGE);
    const warnings = videoStatusLines({ counts: plan.counts, entry, shareLocalVideos: props.shareLocalVideos }).flatMap((line) => (line.kind === "warning" ? [line.text] : []));
    return { warnings, blockers };
  },
  sendLabel: () => "Generate",
  sendingLabel: "Starting…",
  addable: (params, key, props) => addableVideoValue(asVideo(params), key, props),
  Status: VideoStatus,
  roles: ({ composition, props, entry }) => videoPlan({ kind: "selection", composition, selected: [], shapes: [], instruction: "" }, props, entry).roles,
  heal: ({ props, entry, loaded }) => {
    if (!clearsInputMode({ loaded, entry, mode: props.inputMode })) return undefined;
    const { inputMode: _cleared, ...rest } = props;
    return { ...videoDefaults(videoParams(entry)), ...rest };
  },
  send,
  fromRecipe,
};

registerMedium(videoMedium);

