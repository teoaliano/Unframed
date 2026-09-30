const PREFERENCE_KEY = /^[a-z][A-Za-z0-9.:_-]{0,120}$/;

/** The largest a preference value may serialise to: 4 MB. */
export const PREFERENCE_VALUE_LIMIT = 4 * 1_048_576;

/** Why a preference cannot be saved, or `undefined` when it can. `null` (a delete) is always fine. */
export const preferenceProblem = (key: string, value: unknown): string | undefined => {
  if (!PREFERENCE_KEY.test(key)) return "That is not a preference name.";
  if (value === null || value === undefined) return undefined;
  const serialised = JSON.stringify(value) ?? "";
  if (new TextEncoder().encode(serialised).length > PREFERENCE_VALUE_LIMIT) return "That preference is too large to save.";
  return undefined;
};
