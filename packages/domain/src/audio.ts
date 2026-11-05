import { UNUSED_ROLE, type Composition } from "./composition.ts";
import type { ModelParams } from "./modelParams.ts";

export type AudioValue = string | number | boolean;
export type AudioProps = Readonly<Record<string, AudioValue>>;

export const DEFAULT_AUDIO_MODEL = "eleven_v4";
export const DEFAULT_AUDIO_FORMAT = "mp3_44100_128";

export const AUDIO_FORMATS: ReadonlyArray<string> = [
  "mp3_44100_128",
  "mp3_44100_192",
  "mp3_44100_96",
  "mp3_44100_64",
  "mp3_22050_32",
  "wav_44100",
  "wav_48000",
  "wav_24000",
  "wav_16000",
];

export const VOICE_ID = "voice_id";
export const VOICE_NAME = "voice_name";

const NO_SPEED_MODELS: ReadonlyArray<string> = ["eleven_v4", "eleven_v4_turbo"];

export interface AudioModelTraits {
  readonly canUseStyle: boolean;
  readonly canUseSpeakerBoost: boolean;
  readonly languages: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly maxCharacters: number | null;
}

export interface AudioCatalogueEntry {
  readonly id: string;
  readonly params?: AudioModelTraits | null | Readonly<Record<string, unknown>> | undefined;
}

export interface RangeProp {
  readonly key: "stability" | "style" | "speed" | "similarity_boost";
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
}

export type AdvancedKey = "similarity_boost" | "use_speaker_boost" | "output_format" | "seed" | "language_code";

export interface AudioParams extends ModelParams {
  readonly model: string | undefined;
  readonly known: boolean;
  readonly delivery: ReadonlyArray<RangeProp>;
  readonly advanced: ReadonlyArray<AdvancedKey>;
  readonly languages: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly maxCharacters: number | null;
}

export const STABILITY: RangeProp = { key: "stability", label: "Stability", min: 0, max: 1, step: 0.05, default: 0.5 };
export const STYLE: RangeProp = { key: "style", label: "Style", min: 0, max: 1, step: 0.05, default: 0 };
export const SPEED: RangeProp = { key: "speed", label: "Speed", min: 0.7, max: 1.2, step: 0.05, default: 1 };
export const SIMILARITY: RangeProp = { key: "similarity_boost", label: "Similarity", min: 0, max: 1, step: 0.05, default: 0.75 };
export const SEED_MAX = 4294967295;

const ADVANCED_LABELS: Record<AdvancedKey, string> = {
  similarity_boost: "Similarity",
  use_speaker_boost: "Speaker boost",
  output_format: "Format",
  seed: "Seed",
  language_code: "Language",
};

export const advancedLabel = (key: AdvancedKey): string => ADVANCED_LABELS[key];

const traitsOf = (entry: AudioCatalogueEntry | undefined): AudioModelTraits | undefined => {
  const params = entry?.params;
  if (params === null || params === undefined || typeof params !== "object") return undefined;
  const value = params as Record<string, unknown>;
  const languages = Array.isArray(value.languages)
    ? value.languages.flatMap((language) => {
        const each = language as { id?: unknown; name?: unknown };
        return typeof each?.id === "string" ? [{ id: each.id, name: typeof each.name === "string" ? each.name : each.id }] : [];
      })
    : [];
  return {
    canUseStyle: value.canUseStyle === true,
    canUseSpeakerBoost: value.canUseSpeakerBoost === true,
    languages,
    maxCharacters: typeof value.maxCharacters === "number" && Number.isFinite(value.maxCharacters) ? value.maxCharacters : null,
  };
};

/** Whether a model takes Speed: every model id but the two v4 ones, an unknown row included. */
export const takesSpeed = (model: string | undefined): boolean => model === undefined || !NO_SPEED_MODELS.includes(model);

/** The props a model declares, in tray order, and what it takes. A `params: null` row is unknown. */
export const audioParams = (entry: AudioCatalogueEntry | undefined, model: string | undefined = entry?.id): AudioParams => {
  const traits = traitsOf(entry);
  const delivery: RangeProp[] = [STABILITY];
  if (traits?.canUseStyle) delivery.push(STYLE);
  if (takesSpeed(model)) delivery.push(SPEED);
  const advanced: AdvancedKey[] = ["similarity_boost"];
  if (traits?.canUseSpeakerBoost) advanced.push("use_speaker_boost");
  advanced.push("output_format", "seed");
  if ((traits?.languages.length ?? 0) > 0) advanced.push("language_code");
  return {
    props: [],
    referenceCap: undefined,
    supported: () => false,
    model,
    known: traits !== undefined,
    delivery,
    advanced,
    languages: traits?.languages ?? [],
    maxCharacters: traits?.maxCharacters ?? null,
  };
};

/** A fresh tray's props: every delivery prop the model takes at its default. */
export const audioDefaults = (params: AudioParams): Record<string, AudioValue> =>
  Object.fromEntries(params.delivery.map((prop) => [prop.key, prop.default]));

const RANGES: Record<string, RangeProp> = { stability: STABILITY, style: STYLE, speed: SPEED, similarity_boost: SIMILARITY };

const inRange = (prop: RangeProp, value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= prop.min && value <= prop.max;

const isSeed = (value: unknown): boolean => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= SEED_MAX;

const decimals = (value: number): string => String(value);

/** The refusal for the first param outside its range, or `undefined` when every one is in range. */
export const audioRangeRefusal = (params: Readonly<Record<string, unknown>>): string | undefined => {
  for (const [key, prop] of Object.entries(RANGES)) {
    if (params[key] !== undefined && !inRange(prop, params[key])) return `${prop.label} has to be between ${decimals(prop.min)} and ${decimals(prop.max)}.`;
  }
  if (params.seed !== undefined && !isSeed(params.seed)) return `Seed has to be between 0 and ${SEED_MAX}.`;
  return undefined;
};

/** Whether one stored value may stay with this model. */
const keeps = (key: string, value: AudioValue, params: AudioParams): boolean => {
  if (key === VOICE_ID || key === VOICE_NAME) return typeof value === "string" && value !== "";
  if (key === "stability" || key === "similarity_boost") return inRange(RANGES[key]!, value);
  if (key === "style") return (params.known ? params.delivery.includes(STYLE) : true) && inRange(STYLE, value);
  if (key === "speed") return takesSpeed(params.model) && inRange(SPEED, value);
  if (key === "use_speaker_boost") return (params.known ? params.advanced.includes("use_speaker_boost") : true) && typeof value === "boolean";
  if (key === "output_format") return typeof value === "string" && AUDIO_FORMATS.includes(value);
  if (key === "seed") return isSeed(value);
  if (key === "language_code") return typeof value === "string" && (params.known ? params.languages.some((language) => language.id === value) : true);
  return false;
};

/** Stored or recorded props, kept only where the model takes them. An unknown row never drops a stored Style or Speaker boost. */
export const audioKeep = (props: AudioProps, params: AudioParams): Record<string, AudioValue> =>
  Object.fromEntries(Object.entries(props).filter(([key, value]) => keeps(key, value, params)));

/** The tray after a model change: the delivery props back to their defaults, undeclared traits gone; voice, format and seed kept. */
export const audioReset = (props: AudioProps, params: AudioParams): Record<string, AudioValue> => {
  const next: Record<string, AudioValue> = {};
  for (const key of [VOICE_ID, VOICE_NAME, "output_format", "seed", "similarity_boost", "use_speaker_boost", "language_code"]) {
    const value = props[key];
    if (value !== undefined && keeps(key, value, params) && (key !== "use_speaker_boost" || params.advanced.includes("use_speaker_boost"))) next[key] = value;
  }
  return { ...next, ...audioDefaults(params) };
};

/** How many advanced props are set, for the `Advanced · 2` chip. */
export const advancedCount = (props: AudioProps): number =>
  (["similarity_boost", "use_speaker_boost", "output_format", "seed", "language_code"] as const).filter((key) => props[key] !== undefined).length;

export const voiceOf = (props: AudioProps): { readonly id: string; readonly name: string } | undefined => {
  const id = props[VOICE_ID];
  if (typeof id !== "string" || id === "") return undefined;
  const name = props[VOICE_NAME];
  return { id, name: typeof name === "string" && name !== "" ? name : id };
};

const DELIVERY_KEYS = ["stability", "similarity_boost", "style", "use_speaker_boost", "speed"] as const;

export interface SpeechCall {
  readonly query: { readonly output_format: string };
  readonly body: {
    readonly text: string;
    readonly model_id: string;
    readonly voice_settings?: Readonly<Record<string, number | boolean>>;
    readonly seed?: number;
    readonly language_code?: string;
  };
}

/** The speech call for a text and the params a run sets: `voice_settings` holds exactly the set delivery keys, and is absent with none. */
export const speechCall = (input: { readonly text: string; readonly model: string; readonly params: Readonly<Record<string, unknown>> }): SpeechCall => {
  const settings: Record<string, number | boolean> = {};
  for (const key of DELIVERY_KEYS) {
    const value = input.params[key];
    if (typeof value === "number" || typeof value === "boolean") settings[key] = value;
  }
  const { seed, language_code, output_format } = input.params;
  return {
    query: { output_format: typeof output_format === "string" && output_format !== "" ? output_format : DEFAULT_AUDIO_FORMAT },
    body: {
      text: input.text,
      model_id: input.model,
      ...(Object.keys(settings).length > 0 ? { voice_settings: settings } : {}),
      ...(typeof seed === "number" ? { seed } : {}),
      ...(typeof language_code === "string" && language_code !== "" ? { language_code } : {}),
    },
  };
};

/** The params a run sends: the tray's props without the voice. */
export const audioRunParams = (props: AudioProps): Record<string, number | boolean | string> =>
  Object.fromEntries(Object.entries(props).filter(([key]) => key !== VOICE_ID && key !== VOICE_NAME));

export interface AudioRequest extends SpeechCall {
  readonly text: string;
  readonly voiceId: string | undefined;
  readonly roles: Readonly<Record<string, string>>;
}

/** Every media slot of a composition, unused: an audio run sends text only. */
export const audioRoles = (composition: Pick<Composition, "roles" | "references">): Record<string, string> => {
  const roles: Record<string, string> = {};
  for (const key of Object.keys(composition.roles)) roles[key] = UNUSED_ROLE;
  for (const slot of composition.references) roles[slot.shapeId] = UNUSED_ROLE;
  return roles;
};

/** The spoken text, the speech call and the roles for the selection's media. */
export const audioRequest = (input: {
  readonly composition: Pick<Composition, "prompt" | "roles" | "references">;
  readonly props: AudioProps;
  readonly voice: { readonly id: string } | undefined;
  readonly model: string;
}): AudioRequest => {
  const text = input.composition.prompt;
  return {
    text,
    voiceId: input.voice?.id,
    roles: audioRoles(input.composition),
    ...speechCall({ text, model: input.model, params: audioRunParams(input.props) }),
  };
};

export const ELEVENLABS_NO_KEY = "No ElevenLabs key yet. Add one in Settings, under ElevenLabs.";
export const NOTHING_TO_SAY = "Nothing to say. Select a prompt, or type an instruction.";
export const PICK_A_VOICE = "Pick a voice for this line.";

export interface AudioStatusInput {
  /** The spoken text. */
  readonly text: string;
  /** A circular reference that stops the run. */
  readonly error?: string | undefined;
  /** The media slots the selection holds, none of which is sent. */
  readonly media: ReadonlyArray<{ readonly kind: "image" | "video" }>;
  readonly voice: { readonly id: string } | undefined;
  readonly model: string | undefined;
  readonly params: AudioParams;
  readonly hasKey: boolean;
}

export const audioMediaWarning = (media: ReadonlyArray<{ readonly kind: "image" | "video" }>): string | undefined => {
  const [only] = media;
  if (only === undefined) return undefined;
  if (media.length === 1) return `${only.kind === "image" ? "An image" : "A clip"} is selected, but audio models only read text. It will not be sent.`;
  return `${media.length} images and clips are selected, but audio models only read text. They will not be sent.`;
};

/** The audio medium's status band: blockers in the order they are looked for, then the media warning. */
export const audioStatus = (input: AudioStatusInput): { readonly warnings: string[]; readonly blockers: string[] } => {
  const blockers: string[] = [];
  if (!input.hasKey) blockers.push(ELEVENLABS_NO_KEY);
  if (input.error !== undefined) blockers.push(input.error);
  else if (input.text.trim() === "") blockers.push(NOTHING_TO_SAY);
  if (input.voice === undefined) blockers.push(PICK_A_VOICE);
  const max = input.params.maxCharacters;
  if (input.error === undefined && max !== null && input.text.length > max) {
    blockers.push(`This text is ${input.text.length} characters, but ${input.model ?? "this model"} takes at most ${max} in one request. Shorten it, or pick a model that takes more.`);
  }
  const warning = audioMediaWarning(input.media);
  return { warnings: warning === undefined ? [] : [warning], blockers };
};

/** The `character-cost` header as credits: a finite number at or above zero, else `null`. */
export const creditsFrom = (header: string | null | undefined): number | null => {
  const value = header?.trim();
  if (value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const parsed = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

/** ElevenLabs' own words: `detail.message`, else a string `detail`, else the first 300 characters of the body. */
export const elevenLabsMessage = (_status: number, body: string): string => {
  const detail = field(parsed(body), "detail");
  const message = field(detail, "message");
  if (typeof message === "string") return message;
  if (typeof detail === "string") return detail;
  return body.slice(0, 300);
};

const CREDIT_CODES = ["insufficient_credits", "quota_exceeded"];

/** The sentence a failed speech call reaches the person with. */
export const speechFailure = (status: number, body: string): string => {
  const upstream = elevenLabsMessage(status, body);
  const detail = field(parsed(body), "detail");
  if (status === 401) return `ElevenLabs refused the key: ${upstream}. Check the key in Settings.`;
  if (status === 402 || CREDIT_CODES.includes(String(field(detail, "code"))) || CREDIT_CODES.includes(String(field(detail, "status")))) {
    return `ElevenLabs has no credits left for this: either the account's quota for this period is used up, or this key has hit its own credit limit. Check your plan and the key's limit at elevenlabs.io. (${upstream})`;
  }
  return `ElevenLabs (${status}): ${upstream}`;
};

/** The file extension of an output format: `mp3` for `mp3_`, `wav` for `wav_`. */
export const audioExtension = (format: string | undefined): "mp3" | "wav" => (format?.startsWith("wav_") ? "wav" : "mp3");

/** `m:ss`. */
export const audioClock = (seconds: number): string => {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const creditNumber = (value: number): string => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);

/** The line under a selected audio result: `<model> · <m:ss> · <n> credits`, any unknown part left out. */
export const audioLine = (input: { readonly model: string; readonly durationMs?: number | null | undefined; readonly credits?: number | null | undefined }): string =>
  [
    input.model,
    ...(typeof input.durationMs === "number" && Number.isFinite(input.durationMs) ? [audioClock(input.durationMs / 1000)] : []),
    ...(typeof input.credits === "number" ? [`${creditNumber(input.credits)} ${input.credits === 1 ? "credit" : "credits"}`] : []),
  ].join(" · ");

/** A result's spoken text as the card's title: whitespace collapsed, the first 40 characters, ellipsised. */
export const audioTitle = (text: string): string => {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 40 ? `${collapsed.slice(0, 40)}…` : collapsed;
};
