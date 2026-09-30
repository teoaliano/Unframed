/** The most outputs one run makes. Every limit message quotes it from here. */
export const RUNS_CAP = 10;

/** The Runs prop: a fixed count from 1 to `RUNS_CAP`, or Free, which takes the count from a list. */
export type RunsValue = number | "free";

/** What the Runs field keeps while it has focus: digits only, at most two. */
export const runsDraft = (typed: string): string => typed.replace(/\D/g, "").slice(0, 2);

/**
 * The count a typed value means, never a refusal: text keeps its first two digits, a
 * number is rounded, anything that is not a number becomes 1, and the result is clamped
 * to 1 to `RUNS_CAP`.
 */
export const clampRuns = (typed: string | number): number => {
  const value = typeof typed === "number" ? Math.round(typed) : Number.parseInt(runsDraft(typed), 10);
  if (!Number.isFinite(value)) return 1;
  return Math.min(RUNS_CAP, Math.max(1, value));
};

/** A stored or tray value as the Runs prop: `free`, or a clamped count; 1 when there is none. */
export const readRunsValue = (value: unknown): RunsValue => {
  if (value === "free") return "free";
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) return clampRuns(value);
  return 1;
};
