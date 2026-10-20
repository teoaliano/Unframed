/**
 * The paid generations of a turn: the activities a generation leaves
 * when it starts, lands or fails, and the recap line that says what they cost. Pure.
 */
import type { ChatActivity } from "./chatModel.ts";
import { money } from "../outside/spendRules.ts";

export const ACTIVITY_STARTED = "generation.started";
export const ACTIVITY_LANDED = "generation.landed";
export const ACTIVITY_FAILED = "generation.failed";

/** The sentence a landed output's activity says, with its cost when the upstream reported one. */
export const landedSummary = (medium: "image" | "video" | "text", cost: number | null): string => {
  const what = medium === "video" ? "a video" : medium === "text" ? "a text answer" : "an image";
  return cost === null ? `Generated ${what}` : `Generated ${what} ($${cost.toFixed(4)})`;
};

export interface GenerationSpend {
  /** Outputs the turn started. */
  readonly started: number;
  /** Outputs that landed. */
  readonly landed: number;
  /** Outputs that failed. */
  readonly failed: number;
  /** The landed outputs' costs, in USD. */
  readonly spent: number;
  /** Outputs still generating. */
  readonly running: number;
}

const countOf = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** The generation activities of one turn, counted. */
export const generationSpendOf = (activities: ReadonlyArray<ChatActivity>, turnId: string | null): GenerationSpend => {
  let started = 0;
  let landed = 0;
  let failed = 0;
  let spent = 0;
  for (const activity of activities) {
    if (activity.turnId !== turnId) continue;
    const payload = (activity.payload ?? {}) as { count?: unknown; cost?: unknown };
    if (activity.kind === ACTIVITY_STARTED) started += countOf(payload.count);
    else if (activity.kind === ACTIVITY_LANDED) {
      landed += 1;
      if (typeof payload.cost === "number") spent += payload.cost;
    } else if (activity.kind === ACTIVITY_FAILED) failed += countOf(payload.count);
  }
  return { started, landed, failed, spent, running: started - landed - failed };
};

/** The recap's line for a turn that started paid generations, or `undefined` when it started none. */
export const generationRecapLine = (spend: GenerationSpend): string | undefined => {
  if (spend.started === 0) return undefined;
  const line = `Spent ${money(spend.spent)} on ${spend.landed} ${spend.landed === 1 ? "generation" : "generations"}`;
  return spend.running > 0 ? `${line}, ${spend.running} still running.` : `${line}.`;
};
