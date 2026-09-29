/** An activity payload (or any part of one) as a record to read fields from; `{}` when it is not an object. */
export const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});
