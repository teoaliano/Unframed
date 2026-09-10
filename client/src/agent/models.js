// Which model row a picker is showing, and the effort levels that row accepts.
//
// `value` of '' means "the provider's default", and the default is NOT a row of its own:
// server/providers.js drops the SDK's `default` entry, because it is an alias for one of
// the others. So '' has to resolve the way the list itself reads -- the first current
// (non-legacy) row -- and the trigger's label and the Reasoning picker MUST resolve it
// the same way. They did not: the panel looked up a row whose id was the literal string
// 'default', which no probe ever returns, so `efforts` came back empty and the Reasoning
// picker was hidden for every thread where a model had not been picked by hand -- which
// is every new thread. The trigger meanwhile showed the first row, so the panel named a
// model and denied it had effort levels at the same time (found 2026-09-10).
//
// One home for the rule, so a third caller cannot reintroduce the disagreement. Pure,
// pinned in models.test.js.

// -> the row `value` names, or the row '' resolves to, or null when the list is empty.
export function selectedModel(models, value) {
  if (!Array.isArray(models) || models.length === 0) return null;
  if (value) return models.find((m) => m.id === value) ?? null;
  return models.find((m) => !m.legacy) ?? models[0] ?? null;
}

// -> the effort levels that row accepts. [] means the picker does not apply to it (Haiku
// reports none), which is the ONLY reason the Reasoning picker should be absent.
export function effortsFor(models, value) {
  return selectedModel(models, value)?.efforts ?? [];
}
