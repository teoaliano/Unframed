// node client/src/nodes/output/facets.test.js  (also runs as part of `npm test`)
import assert from 'node:assert/strict';
import { buildFacets, applyFacets, priceLabel, priceRate } from './facets.js';

// Miniature catalogues in the exact shapes /api/models returns.
// Image: params is a typed map ({type:'enum',values}); video: plain arrays.
const IMAGE = [
  { id: 'a/one', name: 'A: One', params: {
    resolution: { type: 'enum', values: ['1K', '2K'] },
    aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] }, // on every model → must be dropped
    background: { type: 'enum', values: ['auto', 'opaque', 'transparent'] },
    seed: { type: 'boolean' },
  } },
  { id: 'b/two', name: 'B: Two', params: {
    resolution: { type: 'enum', values: ['1K'] },
    aspect_ratio: { type: 'enum', values: ['1:1'] },
    quality: { type: 'enum', values: ['low', 'high'] },
  } },
  { id: 'c/three', name: 'C: Three', params: {
    aspect_ratio: { type: 'enum', values: ['1:1'] },
  } },
];

const VIDEO = [
  { id: 'v/ref', name: 'V: Ref', acceptsVideo: true, params: {
    resolution: ['720p', '1080p'], duration: [4, 8, 12], size: ['1280x720'],
    generate_audio: true, seed: true,
  }, pricing: { duration_seconds_720p: '0.0988', duration_seconds_1080p: '0.1694' } },
  { id: 'w/short', name: 'W: Short', acceptsVideo: false, params: {
    resolution: ['720p'], duration: [4, 8], generate_audio: false, seed: false,
  }, pricing: { duration_seconds: '0.05' } },
];

// --- buildFacets: the dead-pill rule ---
const imgFacets = buildFacets(IMAGE, 'image');
// aspect_ratio must never become a pill — it is on 43 of 43 real models. This
// guards the eligibility table against someone adding it later; the rule itself
// is exercised by the all1K case below.
assert.ok(!imgFacets.some((f) => f.key === 'aspect_ratio'));
// resolution splits the list: 1K on 2 models, 2K on 1.
const res = imgFacets.find((f) => f.key === 'resolution');
assert.deepEqual(
  res.values.map((v) => [v.value, v.count]),
  [['1K', 2], ['2K', 1]],
);
// Flag facets: transparent on 1 model, quality on 1, seed on 1 — all survive.
assert.ok(imgFacets.some((f) => f.key === 'background'));
assert.ok(imgFacets.some((f) => f.key === 'quality'));
assert.ok(imgFacets.some((f) => f.key === 'seed'));
// A value on EVERY model is dropped even when its siblings survive:
const all1K = [
  { id: 'x/x', params: { resolution: { type: 'enum', values: ['1K', '4K'] } } },
  { id: 'y/y', params: { resolution: { type: 'enum', values: ['1K'] } } },
];
const only4K = buildFacets(all1K, 'image').find((f) => f.key === 'resolution');
assert.deepEqual(only4K.values.map((v) => v.value), ['4K']);
// Text has no params: no facets, ever.
assert.deepEqual(buildFacets([{ id: 't/t', name: 'T' }], 'text'), []);
// One-model catalogue (the offline fallback): everything matches "all" → no pills.
assert.deepEqual(buildFacets([IMAGE[0]], 'image'), []);
// /api/models' manufactured fallback entry ({id, name}, no params/pricing) — no crash, no pills.
assert.deepEqual(buildFacets([{ id: 'f/f', name: 'f/f' }], 'image'), []);

// Video: ordered resolutions, and the derived flags.
const vidFacets = buildFacets(VIDEO, 'video');
const vres = vidFacets.find((f) => f.key === 'resolution');
assert.deepEqual(vres.values.map((v) => v.value), ['1080p']); // 720p is on 2 of 2 → dropped
for (const key of ['audio', 'seed', 'sizes', 'videoIn']) {
  assert.ok(vidFacets.some((f) => f.key === key), `missing video facet ${key}`);
}

// --- applyFacets: union within a facet, intersection across facets ---
// 1K OR 2K → both declaring models.
assert.deepEqual(
  applyFacets(IMAGE, 'image', '', { resolution: ['1K', '2K'] }).map((m) => m.id),
  ['a/one', 'b/two'],
);
// (1K OR 2K) AND seed → only a/one.
assert.deepEqual(
  applyFacets(IMAGE, 'image', '', { resolution: ['1K', '2K'], seed: ['seed'] }).map((m) => m.id),
  ['a/one'],
);
// Search matches slug and display name, case-insensitive.
assert.deepEqual(applyFacets(IMAGE, 'image', 'b/tw', {}).map((m) => m.id), ['b/two']);
assert.deepEqual(applyFacets(IMAGE, 'image', 'three', {}).map((m) => m.id), ['c/three']);
// Empty selections are no-ops.
assert.equal(applyFacets(IMAGE, 'image', '', { resolution: [] }).length, 3);
// Video flags filter: acceptsVideo === true only (null/unknown must not match).
assert.deepEqual(
  applyFacets(VIDEO, 'video', '', { videoIn: ['videoIn'] }).map((m) => m.id),
  ['v/ref'],
);

// --- priceLabel ---
assert.equal(priceLabel(VIDEO[0], 'video'), '$0.10–0.17/s');
assert.equal(priceLabel(VIDEO[1], 'video'), '$0.05/s');
assert.equal(priceLabel({ id: 'n', pricing: null }, 'video'), null);
assert.equal(
  priceLabel({ id: 't', pricing: { prompt: '0.0000003', completion: '0.0000025' } }, 'text'),
  '$0.30 / $2.50 per M',
);
assert.equal(priceLabel({ id: 't', pricing: { prompt: '0', completion: '0' } }, 'text'), 'free');
assert.equal(priceLabel({ id: 't' }, 'text'), null);
assert.equal(priceLabel(IMAGE[0], 'image'), null); // image never shows price
// OpenRouter's "-1" sentinel ("variable, decided by the routed model") must read
// as no price, not as a huge negative number (openrouter/auto, openrouter/auto-beta).
assert.equal(
  priceLabel({ id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } }, 'text'),
  null,
);
// Fixed 2 decimals, no cleverness: a rate too small to show at that precision
// prints as $0.00 rather than growing extra digits for it.
assert.equal(
  priceLabel({ id: 't', pricing: { prompt: '0.000000001', completion: '0.0000025' } }, 'text'),
  '$0.00 / $2.50 per M',
);

// --- priceLabel/priceRate: video unit detection by key name (defect 1) ---
// Real key shapes from .superpowers/sdd/2026-08-18-model-dialog/pricing-units.md —
// the unit lives in the key name, not in the value's position or magnitude.

// Regression guard: the models that were already right must stay byte-identical.
assert.equal(
  priceLabel({ id: 'happyhorse', pricing: { duration_seconds_720p: '0.0988', duration_seconds_1080p: '0.1694' } }, 'video'),
  '$0.10–0.17/s',
);

// Cents-per-second must divide by 100, not print the raw cents value as dollars
// (flux-3-video used to render "$17.00/s" for a true $0.17/s).
assert.equal(
  priceLabel({ id: 'flux-3-video', pricing: { cents_per_second_output: '17' } }, 'video'),
  '$0.17/s',
);
assert.equal(priceRate({ id: 'flux-3-video', pricing: { cents_per_second_output: '17' } }, 'video'), 0.17);

// Prefixed cents-per-second-output keys (grok-imagine-video's shape).
assert.equal(
  priceLabel(
    { id: 'grok', pricing: { cents_per_video_output_second_480p: '5', cents_per_video_output_second_720p: '7' } },
    'video',
  ),
  '$0.05–0.07/s',
);
assert.equal(
  priceRate(
    { id: 'grok', pricing: { cents_per_video_output_second_480p: '5', cents_per_video_output_second_720p: '7' } },
    'video',
  ),
  0.05,
);

// Dollars-per-TOKEN must render per million, not fold into a per-second range
// (seedance-2.0, the default video model, used to render "$0.00/s").
assert.equal(
  priceLabel({ id: 'seedance-2.0', pricing: { video_tokens: '0.000007' } }, 'video'),
  '$7.00 per M',
);
// priceRate must match the DISPLAYED unit (per M here), not the raw per-token
// catalogue number — the raw number (~1e-6) would sort every token-priced model
// below every per-second model regardless of the figure actually shown.
assert.equal(priceRate({ id: 'seedance-2.0', pricing: { video_tokens: '0.000007' } }, 'video'), 7);

// A per-reference-image fee must not widen the per-second range it sits beside.
assert.equal(
  priceLabel({ id: 'hailuo-3', pricing: { duration_seconds: '0.13', reference_images: '0.04' } }, 'video'),
  '$0.13/s',
);

// A per-generation minimum is not a per-second rate and must be ignored outright,
// not treated as 56 cents/s.
assert.equal(
  priceLabel({ id: 'aleph-2', pricing: { cents_per_second_output: '28', minimum_cents_per_generation: '56' } }, 'video'),
  '$0.28/s',
);

// Text priceRate is also the per-M figure on screen, not the raw per-token rate —
// same reason as the video token family, even though every text model shares one
// unit so the relative order does not actually change.
assert.equal(
  priceRate({ id: 't', pricing: { prompt: '0.0000003', completion: '0.0000025' } }, 'text'),
  0.3,
);

// The invariant that stops priceLabel and priceRate from drifting apart again:
// one is null exactly when the other is, for every kind and every fixture above.
const RATE_CASES = [
  [VIDEO[0], 'video'],
  [VIDEO[1], 'video'],
  [{ id: 'n', pricing: null }, 'video'],
  [{ id: 't', pricing: { prompt: '0.0000003', completion: '0.0000025' } }, 'text'],
  [{ id: 't', pricing: { prompt: '0', completion: '0' } }, 'text'],
  [{ id: 't' }, 'text'],
  [IMAGE[0], 'image'],
  [{ id: 'happyhorse', pricing: { duration_seconds_720p: '0.0988', duration_seconds_1080p: '0.1694' } }, 'video'],
  [{ id: 'flux-3-video', pricing: { cents_per_second_output: '17' } }, 'video'],
  [{ id: 'seedance-2.0', pricing: { video_tokens: '0.000007' } }, 'video'],
  [{ id: 'hailuo-3', pricing: { duration_seconds: '0.13', reference_images: '0.04' } }, 'video'],
  [{ id: 'aleph-2', pricing: { cents_per_second_output: '28', minimum_cents_per_generation: '56' } }, 'video'],
  [{ id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } }, 'text'],
];
for (const [model, kind] of RATE_CASES) {
  const label = priceLabel(model, kind);
  const rate = priceRate(model, kind);
  assert.equal(
    rate === null,
    label === null,
    `priceRate/priceLabel disagree on null for ${model.id} (${kind}): label=${label}, rate=${rate}`,
  );
}

console.log('facets.test.js ok');
