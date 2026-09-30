/**
 * What the project mapper and the preset converter share (spec 11): the old app's default
 * sizes, where a text output's instructions and answer go, and the approximate recipe an
 * imported result carries.
 */
import type { Box } from "../grouping.ts";
import type { LegacyResultRecipe, LegacyShape } from "./canvas.ts";
import { finite, type LegacyNode } from "./graph.ts";
import type { LegacyMedium } from "./report.ts";

/** The old app's sizes for a node with no `width` or `height`. */
export const DEFAULT_SIZE = {
  prompt: { w: 240, h: 160 },
  group: { w: 420, h: 280 },
  page: { w: 480, h: 320 },
  motion: { w: 480, h: 300 },
  output: { w: 320, h: 200 },
} as const;

/** An image's or video's width without one, and a result's. */
export const MEDIA_WIDTH = 240;
export const VIDEO_ASPECT = 16 / 9;
const SIDE_MARGIN = 28;
const TOP_MARGIN = 56;
const MEMBER_GAP = 28;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** A shape while it is being placed. */
export type Shape = Mutable<LegacyShape>;

export const nonEmpty = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

export const positiveAspect = (value: unknown): number | undefined => {
  const aspect = finite(value);
  return aspect !== undefined && aspect > 0 ? aspect : undefined;
};

/** A text output's instructions, when they hold more than whitespace. */
export const instructionsOf = (output: LegacyNode): string | undefined =>
  typeof output.data.text === "string" && output.data.text.trim() !== "" ? output.data.text : undefined;

/** A text output's answer, when it has one. */
export const answerOf = (output: LegacyNode): string | undefined => nonEmpty(output.data.result);

/** A rough box for a prompt's text, for placement only: the web measures the real one. */
export const legacyTextBox = (value: string, width?: number): { w: number; h: number } => {
  const lines = value.split("\n");
  const w = width ?? Math.min(320, Math.max(40, Math.max(...lines.map((line) => line.length)) * 7 + 8));
  const rows = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * 7) / w)), 0);
  return { w, h: Math.max(28, rows * 20) };
};

/** Where a new member of a group goes: below its lowest member with a gap of 28, or inside the label margin of an empty group. */
export const belowLowest = (members: ReadonlyArray<Box>): { x: number; y: number } => {
  const lowest = members.reduce<Box | undefined>((low, box) => (low === undefined || box.y + box.h > low.y + low.h ? box : low), undefined);
  return lowest ? { x: lowest.x, y: lowest.y + lowest.h + MEMBER_GAP } : { x: SIDE_MARGIN, y: TOP_MARGIN };
};

/** A group's size once it holds `member`, whose position is relative to it. */
export const grownToHold = (group: { readonly w: number; readonly h: number }, member: Box): { w: number; h: number } => ({
  w: Math.max(group.w, member.x + member.w + SIDE_MARGIN),
  h: Math.max(group.h, member.y + member.h + SIDE_MARGIN),
});

/** Spec 03's approximate recipe: what the old app recorded, and the prompt it sent when a sidecar says. */
export const resultRecipe = (
  medium: LegacyMedium,
  model: string,
  params: LegacyResultRecipe["params"],
  sources: ReadonlyArray<string>,
  sentPrompt: string | undefined,
): LegacyResultRecipe => ({
  medium,
  model,
  params,
  selectionPrompt: "",
  instruction: "",
  references: [],
  sources,
  approximate: true,
  ...(sentPrompt === undefined ? {} : { sentPrompt }),
});

/** A text output's answer as a text result: a fixed-width prompt with result meta, the output's id as its `@id`. */
export const answerShape = (output: LegacyNode, answer: string, result: LegacyShape["result"] & object): Shape => ({
  key: `answer:${output.id}`,
  kind: "prompt",
  ref: output.id,
  x: 0,
  y: 0,
  w: MEDIA_WIDTH,
  h: legacyTextBox(answer, MEDIA_WIDTH).h,
  text: answer,
  sized: true,
  result,
});

/** A text output's instructions as a hugging prompt with a minted `@id`. */
export const instructionsShape = (output: LegacyNode, instructions: string, ref: string): Shape => ({
  key: `instructions:${output.id}`,
  kind: "prompt",
  ref,
  x: 0,
  y: 0,
  ...legacyTextBox(instructions),
  text: instructions,
  sized: false,
});
