/**
 * The spend limit of an outside connection (spec 14, "Spend limit (outside connections)"). Pure:
 * the connection store keeps the amounts, and these rules say what they mean.
 */

export const SPEND_PERIODS = ["day", "week", "month", "lifetime"] as const;
export type SpendPeriod = (typeof SPEND_PERIODS)[number];

export interface SpendLimit {
  readonly usd: number;
  readonly period: SpendPeriod;
}

/** One paid run's spend on a connection: reserved at acceptance, settled to its cost on landing. */
export interface SpendEntry {
  readonly runId: string;
  readonly at: string;
  readonly usd: number;
  readonly state: "reserved" | "landed";
}

/** The sentence for a limit the person typed that cannot be kept, or `undefined` when it can. */
export const spendLimitProblem = (limit: { readonly usd: number | undefined; readonly period: SpendPeriod | undefined }): string | undefined => {
  if (limit.usd === undefined) return undefined;
  if (!Number.isFinite(limit.usd) || limit.usd <= 0 || Math.round(limit.usd * 100) !== limit.usd * 100) {
    return "Enter an amount above zero, or leave it empty for no limit.";
  }
  if (limit.period === undefined) return "Choose a period for the limit.";
  return undefined;
};

/** Where a period starts, in the engine's local time: a day, a week from Monday, a month, or the connection's life. */
export const periodStart = (period: SpendPeriod, now: Date, createdAt: Date): Date => {
  switch (period) {
    case "day":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "week": {
      const sinceMonday = (now.getDay() + 6) % 7;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday);
    }
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "lifetime":
      return createdAt;
  }
};

/** The spend in a period: every entry that falls in it, reserved or landed. */
export const spentSince = (entries: ReadonlyArray<SpendEntry>, start: Date): number =>
  entries.reduce((sum, entry) => (Date.parse(entry.at) >= start.getTime() ? sum + entry.usd : sum), 0);

const PERIOD_WORDS: Record<SpendPeriod, string> = { day: "per day", week: "per week", month: "per month", lifetime: "for its whole life" };

export const periodWords = (period: SpendPeriod): string => PERIOD_WORDS[period];

export const money = (usd: number): string => `$${usd.toFixed(2)}`;

export const NO_PRICE_REFUSAL =
  "This generation has no exact price, so this connection's spend limit cannot be checked. Remove the limit in Unframed's Settings, or make it in the app.";

/**
 * Whether a paid call may start. `undefined` when it may; otherwise the sentence the agent gets.
 * `estimate` is `null` when no exact price exists.
 */
export const spendRefusal = (input: {
  readonly limit: SpendLimit | null;
  readonly spent: number;
  readonly reserved: number;
  readonly estimate: number | null;
}): string | undefined => {
  if (input.limit === null) return undefined;
  if (input.estimate === null) return NO_PRICE_REFUSAL;
  if (input.spent + input.reserved + input.estimate <= input.limit.usd) return undefined;
  return `This connection has spent ${money(input.spent)} of its ${money(input.limit.usd)} limit ${periodWords(input.limit.period)}, and this run would pass it. Raise the limit in Unframed's Settings, or wait until the period starts again. A dry run still works.`;
};
