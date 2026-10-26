import * as Schema from "effect/Schema";

/** The limit on an outside connection's paid generations. */
export const SpendLimit = Schema.Struct({
  usd: Schema.Number,
  period: Schema.Literals(["day", "week", "month", "lifetime"]),
});
export type SpendLimit = typeof SpendLimit.Type;
