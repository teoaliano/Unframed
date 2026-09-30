/** The video tray's estimate and status lines (spec 04). */
import type { VideoEntry } from "./videoProps.ts";
import type { VideoCounts } from "./videoRequest.ts";

const numberOf = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Dollars per second of output from a model's `pricing_skus`: the tier's
 * `cents_per_second_output_<tier>` when a tier is set and has one, else
 * `cents_per_second_output`, else `duration_seconds` read as dollars per second.
 */
export const videoPricePerSecond = (pricing: Readonly<Record<string, unknown>> | null | undefined, resolution: string | undefined): number | null => {
  if (!pricing) return null;
  const tiered = resolution === undefined ? undefined : numberOf(pricing[`cents_per_second_output_${resolution.toLowerCase()}`]);
  const cents = tiered ?? numberOf(pricing.cents_per_second_output);
  if (cents !== undefined) return cents / 100;
  return numberOf(pricing.duration_seconds) ?? null;
};

/** The price of one clip: per-second price times the effective duration, or `null` when either is missing. */
export const estimateVideo = (input: {
  readonly pricing: Readonly<Record<string, unknown>> | null | undefined;
  readonly resolution: string | undefined;
  readonly duration: number | undefined;
}): number | null => {
  const perSecond = videoPricePerSecond(input.pricing, input.resolution);
  if (perSecond === null || input.duration === undefined || !Number.isFinite(input.duration)) return null;
  return perSecond * input.duration;
};

/** `est. ~$1.21`: always two decimals for video. */
export const formatVideoEstimate = (value: number): string => `est. ~$${value.toFixed(2)}`;

/** The share consent: on unless explicitly off. */
export const shareConsent = (value: unknown): boolean => value !== false;

export type VideoStatusLine =
  | { readonly kind: "warning"; readonly text: string }
  /** The share block: the checkbox and its "What sharing does" note. */
  | { readonly kind: "share"; readonly on: boolean }
  | { readonly kind: "error"; readonly text: string };

export const EDITING_WARNING =
  'Describe the result you want, not a change to make. An instruction like "edit this video to..." switches the model into editing mode, which OpenRouter cannot currently express and which fails with a duration error.';

export const UNUSED_WARNING = "One or more selected inputs will not be sent";

/**
 * The tray's status lines, in order: the phrasing warning for a clip sent as a reference,
 * the unused warning (no count on purpose: the badges say which), the share block for a
 * local clip that is sent, the warning for a model known not to take video, the last start
 * error. `acceptsVideo: null` is unknown and never warns.
 */
export const videoStatusLines = (input: {
  readonly counts: VideoCounts;
  readonly entry: VideoEntry | undefined;
  readonly shareLocalVideos: unknown;
  readonly error?: string | undefined;
}): VideoStatusLine[] => {
  const { counts } = input;
  const lines: VideoStatusLine[] = [];
  if (counts.referencedVideos > 0) lines.push({ kind: "warning", text: EDITING_WARNING });
  if (counts.unused > 0) lines.push({ kind: "warning", text: UNUSED_WARNING });
  if (counts.localVideos > 0) lines.push({ kind: "share", on: shareConsent(input.shareLocalVideos) });
  if (counts.referencedVideos > 0 && counts.localVideos === 0 && input.entry?.acceptsVideo === false) {
    const subject = counts.referencedVideos === 1 ? "A video is selected" : `${counts.referencedVideos} videos are selected`;
    lines.push({ kind: "warning", text: `${subject}, but this model is not known to accept video input. It will be sent and probably ignored.` });
  }
  if (input.error !== undefined) lines.push({ kind: "error", text: input.error });
  return lines;
};
