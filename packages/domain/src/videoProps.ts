/**
 * The video tray's props (spec 04): which props a video model declares and their options,
 * the input mode's healing rule, the defaults and the reset on a model change.
 */
import { exactSizeLabel, type ModelParams, type PropSpec } from "./modelParams.ts";

export type InputMode = "reference" | "first_frame" | "first_last";

/** A video catalogue entry, as `models.list` answers it for `video`. */
export interface VideoEntry {
  readonly id: string;
  readonly name?: string | undefined;
  /** `{ duration, resolution, aspect_ratio, size, frame_images, generate_audio, seed }`; absent in an outage's bare row. */
  readonly params?: Readonly<Record<string, unknown>> | null | undefined;
  readonly pricing?: Readonly<Record<string, unknown>> | null | undefined;
  readonly acceptsVideo?: boolean | null | undefined;
}

/** The video props with their values: a model's params, and whether the entry says anything at all. */
export interface VideoParams extends ModelParams {
  /** The entry has a `params` object. Without one (an outage) nothing about the model is known. */
  readonly known: boolean;
  /** The model's durations in declared order, as numbers. */
  readonly durations: ReadonlyArray<number>;
  /** The model declares exact sizes, so only `size` is sent. */
  readonly exactSizes: boolean;
  readonly audio: boolean;
}

export type VideoPropValue = string | number | boolean;

/** Every prop a video model drives. A model change clears these and nothing else. */
export const VIDEO_MODEL_DRIVEN_PROPS: ReadonlyArray<string> = ["size", "resolution", "aspect_ratio", "duration", "generate_audio", "quality", "inputMode"];

const INPUT_LABELS: Record<InputMode, string> = {
  reference: "References",
  first_frame: "First frame",
  first_last: "First and last frame",
};

const EXACT_SIZE = /^\d+x\d+$/;

const paramsOf = (entry: VideoEntry | undefined): Readonly<Record<string, unknown>> | undefined => {
  const params = entry?.params;
  return typeof params === "object" && params !== null && !Array.isArray(params) ? params : undefined;
};

const listOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((each) => typeof each === "string" || (typeof each === "number" && Number.isFinite(each))).map(String) : [];

/** The Input options a model declares: References always, then the frame modes its `frame_images` allows. */
export const inputModes = (entry: VideoEntry | undefined): Array<{ value: InputMode; label: string }> => {
  const frames = listOf(paramsOf(entry)?.frame_images);
  const modes: InputMode[] = ["reference"];
  if (frames.includes("first_frame")) modes.push("first_frame");
  if (frames.includes("first_frame") && frames.includes("last_frame")) modes.push("first_last");
  return modes.map((value) => ({ value, label: INPUT_LABELS[value] }));
};

/**
 * Clears a stored input mode only when the catalogue has loaded, the entry has a `params`
 * object, and the mode is not among its options. An entry without params is the engine's
 * bare row during an outage: "unknown" never clears anything.
 */
export const clearsInputMode = (input: { readonly loaded: boolean; readonly entry: VideoEntry | undefined; readonly mode: unknown }): boolean =>
  input.loaded &&
  input.mode !== undefined &&
  paramsOf(input.entry) !== undefined &&
  !inputModes(input.entry).some((option) => option.value === input.mode);

/**
 * The props a video model declares, in tray order: Input, Seconds, then either the exact
 * Size or the tier Size and Ratio, then Audio. `stored` is the tray's current values: a
 * stored input mode keeps Input listed, with the mode as an extra option if undeclared.
 */
export const videoParams = (entry: VideoEntry | undefined, stored: Readonly<Record<string, unknown>> = {}): VideoParams => {
  const declared = paramsOf(entry) ?? {};
  const props: PropSpec[] = [];

  const modes = inputModes(entry);
  const storedMode = typeof stored.inputMode === "string" && stored.inputMode !== "" ? stored.inputMode : undefined;
  const inputValues: string[] = modes.map((option) => option.value);
  const inputLabels: Record<string, string> = Object.fromEntries(modes.map((option) => [option.value, option.label]));
  if (storedMode !== undefined && !inputValues.includes(storedMode)) {
    inputValues.push(storedMode);
    inputLabels[storedMode] = storedMode;
  }
  if (modes.length >= 2 || storedMode !== undefined) {
    props.push({ key: "inputMode", label: "Input", values: inputValues, optionLabels: inputLabels, chipLabels: inputLabels, required: true });
  }

  const durations = listOf(declared.duration);
  if (durations.length > 0) {
    props.push({ key: "duration", label: "Seconds", values: durations, required: true });
  }

  const sizes = listOf(declared.size).filter((value) => EXACT_SIZE.test(value));
  const exactSizes = sizes.length > 0;
  if (exactSizes) {
    props.push({ key: "size", label: "Size", values: sizes, optionLabels: Object.fromEntries(sizes.map((value) => [value, exactSizeLabel(value)])) });
  } else {
    const tiers = listOf(declared.resolution);
    const ratios = listOf(declared.aspect_ratio);
    if (tiers.length > 0) props.push({ key: "resolution", label: "Size", values: tiers });
    if (ratios.length > 0) props.push({ key: "aspect_ratio", label: "Ratio", values: ratios });
  }

  const audio = declared.generate_audio === true;
  if (audio) {
    props.push({ key: "generate_audio", label: "Audio", values: [], optionLabels: { true: "on", false: "off" }, chipLabels: { true: "audio", false: "no audio" }, checkbox: true });
  }

  const declaredValues = new Map<string, ReadonlyArray<string>>(props.filter((prop) => !prop.checkbox).map((prop) => [prop.key, prop.values]));
  declaredValues.set("inputMode", modes.map((option) => option.value));
  return {
    props,
    referenceCap: undefined,
    known: paramsOf(entry) !== undefined,
    durations: durations.map(Number),
    exactSizes,
    audio,
    supported: (key, value) => {
      if (key === "generate_audio") return audio && typeof value === "boolean";
      if (typeof value !== "string" && typeof value !== "number") return false;
      return declaredValues.get(key)?.includes(String(value)) === true;
    },
  };
};

/** The tray's defaults: Seconds at the first declared duration, Input at References when Input exists. */
export const videoDefaults = (params: VideoParams): Record<string, VideoPropValue> => {
  const values: Record<string, VideoPropValue> = {};
  const input = params.props.find((prop) => prop.key === "inputMode");
  if (input?.values.includes("reference")) values.inputMode = "reference";
  const first = params.durations[0];
  if (first !== undefined) values.duration = String(first);
  return values;
};

/**
 * Stored or recorded values kept through the model: a model-driven prop survives only with
 * a supported value, except a stored input mode while the model is unknown.
 */
export const keepVideoProps = (values: Readonly<Record<string, VideoPropValue>>, params: VideoParams): Record<string, VideoPropValue> =>
  Object.fromEntries(
    Object.entries(values).filter(([key, value]) => {
      if (!VIDEO_MODEL_DRIVEN_PROPS.includes(key)) return true;
      if (key === "inputMode" && !params.known) return true;
      return params.supported(key, value);
    }),
  );

/** The tray after a model change: every model-driven value cleared, the new defaults applied, the rest (the share consent) kept. */
export const resetVideoProps = (current: Readonly<Record<string, VideoPropValue>>, next: VideoParams): Record<string, VideoPropValue> => {
  const kept = Object.fromEntries(Object.entries(current).filter(([key]) => !VIDEO_MODEL_DRIVEN_PROPS.includes(key)));
  return { ...videoDefaults(next), ...kept };
};

/** The value a prop is offered with in "+ add prop": its current value, else Audio off, else its first value. */
export const addableVideoValue = (params: VideoParams, key: string, current: Readonly<Record<string, unknown>>): VideoPropValue | undefined => {
  const prop = params.props.find((each) => each.key === key);
  if (!prop) return undefined;
  const now = current[key];
  if (now !== undefined && params.supported(key, now)) return now as VideoPropValue;
  if (prop.checkbox) return false;
  return prop.values[0];
};
