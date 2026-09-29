/**
 * What an old output's settings and an old sidecar become (spec 11): a group's standing
 * recipe from the output's data, and a result's approximate recipe from its sidecar.
 */
import type { GroupRecipe, RecipeValue } from "../recipeRules.ts";
import { finite, record, type LegacyNode } from "./graph.ts";
import type { LegacyMedium } from "./report.ts";

export interface LegacyDefaults {
  readonly image: string;
  readonly video: string;
  readonly text: string;
}

export const OUTPUT_MEDIUM: Readonly<Record<string, LegacyMedium>> = { imageOutput: "image", videoOutput: "video", textOutput: "text" };

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

type Params = Record<string, RecipeValue>;

const pick = (source: Readonly<Record<string, unknown>>, keys: ReadonlyArray<string>): Params => {
  const params: Params = {};
  for (const key of keys) {
    const value = source[key];
    if ((typeof value === "string" && value !== "") || typeof value === "boolean" || finite(value) !== undefined) params[key] = value as RecipeValue;
  }
  return params;
};

const IMAGE_KEYS = ["resolution", "quality", "aspect_ratio", "background", "output_format", "size"] as const;

/** An image output's params: the keys it sets, as the image tray names them. */
export const imageOutputParams = (data: Readonly<Record<string, unknown>>): Params => pick(data, IMAGE_KEYS);

/**
 * A video output's params, as the video tray names them: `generateAudio` is the tray's
 * `generate_audio`. `inputMode` defaults to reference and `shareLocalVideos` to on.
 */
export const videoOutputParams = (data: Readonly<Record<string, unknown>>): Params => ({
  ...pick(data, ["duration", "resolution", "aspect_ratio", "size"]),
  ...(typeof data.generateAudio === "boolean" ? { generate_audio: data.generateAudio } : {}),
  inputMode: text(data.inputMode) ?? "reference",
  shareLocalVideos: typeof data.shareLocalVideos === "boolean" ? data.shareLocalVideos : true,
});

/** The standing recipe an output's data makes. `previewPrompt` is dropped: a Free recipe always stops at the final prompt. */
export const outputRecipe = (output: LegacyNode, defaults: LegacyDefaults): GroupRecipe => {
  const { data } = output;
  switch (OUTPUT_MEDIUM[output.type]) {
    case "video":
      return { medium: "video", model: text(data.videoModel) ?? defaults.video, params: videoOutputParams(data), runs: 1 };
    case "text":
      return { medium: "text", model: text(data.model) ?? defaults.text, params: {}, runs: 1 };
    default: {
      const runs = finite(data.runs);
      return {
        medium: "image",
        model: text(data.model) ?? defaults.image,
        params: imageOutputParams(data),
        runs: data.freeRuns === true ? "free" : runs !== undefined && Number.isInteger(runs) && runs >= 1 && runs <= 10 ? runs : 1,
      };
    }
  }
};

/** What an old sidecar next to a file was written for. */
export type SidecarKind = "image" | "video" | "text" | "other";

/**
 * An image generation sidecar has `prompt` and `model` and neither `source` nor `kind`; a
 * video one has `kind: "video"`, a text run `kind: "text"`. Uploads, copies, extractions,
 * agent files, renders and agent turns are none of them.
 */
export const sidecarKind = (value: unknown): SidecarKind => {
  const sidecar = record(value);
  if (!sidecar) return "other";
  if (sidecar.kind === "video" || sidecar.kind === "text") return sidecar.kind;
  if (sidecar.kind === undefined && sidecar.source === undefined && typeof sidecar.prompt === "string" && typeof sidecar.model === "string") return "image";
  return "other";
};

/** The params a generation sidecar records: an image run's six, a video run's duration, resolution and size. */
export const sidecarParams = (value: unknown, medium: LegacyMedium): Params => {
  const sidecar = record(value) ?? {};
  if (medium === "image") return pick(sidecar, IMAGE_KEYS);
  if (medium === "video") return pick(sidecar, ["duration", "resolution", "size"]);
  return {};
};

export const sidecarText = (value: unknown, key: string): string | undefined => text(record(value)?.[key]);
export const sidecarNumber = (value: unknown, key: string): number | undefined => finite(record(value)?.[key]);
