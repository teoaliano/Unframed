// What a click on an image output will cost, when that is knowable EXACTLY. Pure, and
// its own file because the judgement below is the whole point and wants tests: the
// video node's estimate is one multiplication, this one is a decision about whether an
// estimate may be shown at all.
//
// Image models price three ways (OpenRouter's per-model `endpoints` sub-resource,
// surveyed 2026-08-22): per output IMAGE (21 of 43 — Recraft, Seedream, Qwen, Grok,
// Riverflow), per TOKEN (16 — GPT Image, Gemini, MAI), per MEGAPIXEL (4 — Flux), and
// three models publish no pricing at all. Only the first is a number rather than a
// guess, which is why this returns null so readily: VideoOutputNode's estimate has
// said since it was written that "a guess dressed as a number would be worse than
// silence", and that rule is what decides every branch here.

// Per-image SKUs that are billed once per REFERENCE sent rather than once per image
// produced. Two names because two providers chose two names for the same thing —
// Grok bills `input_image` at $0.01, Riverflow bills `input_reference` at $0.20, and
// at Riverflow's price a four-reference run is $0.80 of estimate that would otherwise
// be missing.
const REFERENCE_BILLABLES = ['input_image', 'input_reference'];

// A variant tags an output SKU with the tier it applies to: `4k`, or `medium_2k` for a
// model whose price moves on quality AND resolution. Matched by parts rather than by a
// table of known variant strings, because the strings are the providers' to invent.
function variantMatches(variant, chosen) {
  const parts = String(variant).toLowerCase().split('_');
  return parts.every((p) => chosen.includes(p));
}

// The price of ONE generated image under the settings currently on the node, or null
// when that is not a single knowable number. `pricing` is one endpoint's SKU list.
function perImage(pricing, { quality, resolution, referenceCount }) {
  if (!Array.isArray(pricing) || !pricing.length) return null;
  // One non-image unit anywhere disqualifies the endpoint outright. A model that bills
  // output per image and input per token does not exist in the catalogue today, and if
  // one appears the honest answer is silence rather than a total missing a term.
  if (pricing.some((s) => s?.unit !== 'image')) return null;

  const outputs = pricing.filter((s) => s.billable === 'output_image');
  if (!outputs.length) return null;

  let output;
  if (outputs.length === 1) {
    output = outputs[0];
  } else {
    // Riverflow publishes a bare SKU alongside its `2k`/`4k` ones, so an unset control
    // still has an answer; Grok publishes only variants, so an unset control has none
    // and gets silence.
    const chosen = [quality, resolution].filter(Boolean).map((v) => String(v).toLowerCase());
    const matched = outputs.filter((s) => s.variant && variantMatches(s.variant, chosen));
    const bare = outputs.filter((s) => !s.variant);
    const pick = matched.length ? matched : bare;
    if (pick.length !== 1) return null;
    output = pick[0];
  }

  const refs = pricing
    .filter((s) => REFERENCE_BILLABLES.includes(s.billable))
    .reduce((sum, s) => sum + Number(s.cost_usd), 0);

  return Number(output.cost_usd) + refs * (referenceCount || 0);
}

// The whole batch. `endpoints` is the list of per-endpoint SKU arrays the server
// proxies through; a model routed across endpoints that disagree on price has no
// single answer, so it gets none.
export function estimateImageCost(endpoints, { quality, resolution, runs, referenceCount } = {}) {
  if (!Array.isArray(endpoints) || !endpoints.length) return null;
  const each = endpoints.map((p) => perImage(p, { quality, resolution, referenceCount }));
  if (each.some((v) => v == null)) return null;
  if (new Set(each).size !== 1) return null;
  const count = runs == null ? 1 : runs;
  if (!(count > 0)) return null;
  return each[0] * count;
}

// Estimates here span two orders of magnitude — $0.035 for Recraft V4.1, $1.80 for six
// runs of its Pro Vector — so a fixed precision either rounds the cheap models to
// "$0.04" or pads the expensive ones. Two decimals once the figure is worth reading in
// cents, three below that.
export function formatEstimate(value) {
  return `$${value.toFixed(value >= 0.1 ? 2 : 3)}`;
}
