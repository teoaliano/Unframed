// Assert-based self-check. Run with: node client/src/nodes/output/pricing.test.js
//
// Every SKU list below is copied verbatim from OpenRouter's
// /api/v1/images/models/<id>/endpoints, read 2026-08-22. They are the shapes this
// module exists to tell apart, so they are pinned rather than invented.
import assert from 'node:assert/strict';
import { estimateImageCost, formatEstimate } from './pricing.js';

// Totals are sums and products of decimal rates, so they carry binary-float dust
// (0.3 * 6 is 1.7999999999999998). The value is display-only and formatEstimate
// rounds it, so the assertions compare to a tenth of a cent rather than exactly.
const near = (actual, expected) =>
  assert.ok(
    actual != null && Math.abs(actual - expected) < 1e-4,
    `expected ~${expected}, got ${actual}`,
  );

// recraft/recraft-v4.1-pro-vector — one flat SKU, the case that started this.
const RECRAFT_PRO_VECTOR = [[{ billable: 'output_image', unit: 'image', cost_usd: 0.3 }]];

// openai/gpt-image-2 — priced per token, so there is no number to show.
const GPT_IMAGE_2 = [[
  { billable: 'input_image', unit: 'token', cost_usd: 8e-6 },
  { billable: 'input_text', unit: 'token', cost_usd: 5e-6 },
  { billable: 'output_image', unit: 'token', cost_usd: 3e-5 },
]];

// black-forest-labs/flux.2-pro — per megapixel, which the node cannot know in advance.
const FLUX_2_PRO = [[{ billable: 'output_image', unit: 'megapixel', cost_usd: 0.03 }]];

// x-ai/grok-imagine-image-2.0 — variants on quality AND resolution, no bare default,
// plus a per-reference charge.
const GROK = [[
  { billable: 'input_image', unit: 'image', cost_usd: 0.01 },
  { billable: 'output_image', unit: 'image', cost_usd: 0.04, variant: 'low_1k' },
  { billable: 'output_image', unit: 'image', cost_usd: 0.06, variant: 'low_2k' },
  { billable: 'output_image', unit: 'image', cost_usd: 0.06, variant: 'medium_1k' },
  { billable: 'output_image', unit: 'image', cost_usd: 0.08, variant: 'medium_2k' },
]];

// sourceful/riverflow-v2-pro — a bare SKU beside its variants, and a reference charge
// big enough ($0.20) that dropping it would misstate the total outright.
const RIVERFLOW_PRO = [[
  { billable: 'output_image', unit: 'image', cost_usd: 0.15 },
  { billable: 'output_image', unit: 'image', cost_usd: 0.15, variant: '2k' },
  { billable: 'output_image', unit: 'image', cost_usd: 0.33, variant: '4k' },
  { billable: 'input_font', unit: 'image', cost_usd: 0.03 },
  { billable: 'input_reference', unit: 'image', cost_usd: 0.2 },
]];

// A flat per-image price is exactly knowable, references or not.
{
  near(estimateImageCost(RECRAFT_PRO_VECTOR, { runs: 1, referenceCount: 1 }), 0.3);
  // Six runs of the model this whole change came from: the number worth seeing BEFORE
  // the click, not in the sidecars afterwards.
  near(estimateImageCost(RECRAFT_PRO_VECTOR, { runs: 6 }), 1.8);
}

// Token and megapixel pricing depend on the output, so there is nothing honest to show.
{
  assert.equal(estimateImageCost(GPT_IMAGE_2, { runs: 1 }), null);
  assert.equal(estimateImageCost(FLUX_2_PRO, { runs: 1 }), null);
}

// A variant is picked by matching every one of its underscore-separated parts against
// the controls actually set on the node.
{
  near(estimateImageCost(GROK, { quality: 'low', resolution: '1K', runs: 1 }), 0.04);
  near(estimateImageCost(GROK, { quality: 'medium', resolution: '2K', runs: 1 }), 0.08);
}

// Grok charges per reference on top, and two runs double the whole per-image figure.
{
  near(
    estimateImageCost(GROK, { quality: 'low', resolution: '1K', runs: 2, referenceCount: 3 }),
    (0.04 + 0.03) * 2,
  );
}

// No variant matches and no bare SKU to fall back on: silence, not the cheapest row.
{
  assert.equal(estimateImageCost(GROK, { quality: 'low', runs: 1 }), null);
  assert.equal(estimateImageCost(GROK, { runs: 1 }), null);
}

// Riverflow's bare SKU is what an unset control falls back to, and its per-reference
// charge is the dominant term once references are wired.
{
  near(estimateImageCost(RIVERFLOW_PRO, { runs: 1 }), 0.15);
  near(estimateImageCost(RIVERFLOW_PRO, { resolution: '4K', runs: 1 }), 0.33);
  near(estimateImageCost(RIVERFLOW_PRO, { runs: 1, referenceCount: 2 }), 0.15 + 0.4);
}

// Endpoints that disagree on price have no single answer; identical ones do. Gemini is
// listed twice in the catalogue at one price, so the duplicate must not suppress it.
{
  const same = [
    [{ billable: 'output_image', unit: 'image', cost_usd: 0.04 }],
    [{ billable: 'output_image', unit: 'image', cost_usd: 0.04 }],
  ];
  near(estimateImageCost(same, { runs: 1 }), 0.04);

  const differ = [
    [{ billable: 'output_image', unit: 'image', cost_usd: 0.04 }],
    [{ billable: 'output_image', unit: 'image', cost_usd: 0.09 }],
  ];
  assert.equal(estimateImageCost(differ, { runs: 1 }), null);
}

// Krea publishes no pricing at all, and a model the catalogue has not answered for yet
// must read the same way: nothing shown.
{
  assert.equal(estimateImageCost([[]], { runs: 1 }), null);
  assert.equal(estimateImageCost([], { runs: 1 }), null);
  assert.equal(estimateImageCost(null, { runs: 1 }), null);
  assert.equal(estimateImageCost(undefined, { runs: 1 }), null);
}

// Free mode has no run count until the list is split, so the caller asks for one image.
{
  near(estimateImageCost(RECRAFT_PRO_VECTOR, {}), 0.3);
  assert.equal(estimateImageCost(RECRAFT_PRO_VECTOR, { runs: 0 }), null);
}

// Cents matter at Recraft V4.1's price and pad at Pro Vector's.
{
  assert.equal(formatEstimate(0.035), '$0.035');
  assert.equal(formatEstimate(0.3), '$0.30');
  assert.equal(formatEstimate(1.8), '$1.80');
}

console.log('pricing.test.js ok');
