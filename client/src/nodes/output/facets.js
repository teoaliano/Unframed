// Which filter pills the model dialog offers, derived from the catalogue it is
// shown — pure so it runs under bare node (facets.test.js). It cannot import
// core.js: that file imports React.
//
// The dead-pill rule: a value carried by EVERY model in the catalogue, or by
// none, filters nothing and is dropped. This is what keeps aspect_ratio and
// input_references (43 of 43 image models) from becoming pills, and it means a
// future OpenRouter param cannot quietly become one either — the table below
// only *nominates* a param; the data decides whether it appears.

// Both catalogue shapes reduce to "the values this model declares": images give
// a typed map ({type:'enum',values}), video gives plain arrays. Same reduction
// as useModelParams' enumOf in core.js, which this module cannot import.
const enumValues = (p) => {
  if (Array.isArray(p)) return p.map(String);
  return p?.type === 'enum' && Array.isArray(p.values) ? p.values.map(String) : [];
};

// Resolutions in size order, not lexicographic ("1080p" sorting before "480p").
// Unknown values go after these, alphabetically.
const RES_ORDER = ['480p', '512', '720p', '1080p', '1K', '2K', '4K'];
const resRank = (v) => {
  const i = RES_ORDER.indexOf(v);
  return i === -1 ? RES_ORDER.length : i;
};

// The eligibility table: which params may become facets, and their wording.
// `values(m)` returns the facet values a model carries — [] means "not this one".
// Data decides presence and counts; this table decides pill text and order.
// No per-facet heading: the pills are rendered as one flat wrapping row, and
// 1K/2K/4K/Transparent/Seed each read for themselves.
const FACET_DEFS = {
  image: [
    { key: 'resolution', values: (m) => enumValues(m.params?.resolution) },
    { key: 'background',
      values: (m) => (enumValues(m.params?.background).includes('transparent') ? ['transparent'] : []),
      valueLabel: { transparent: 'Transparent' } },
    { key: 'quality',
      values: (m) => (enumValues(m.params?.quality).length ? ['quality'] : []),
      valueLabel: { quality: 'Quality' } },
    { key: 'seed',
      values: (m) => (m.params?.seed ? ['seed'] : []),
      valueLabel: { seed: 'Seed' } },
  ],
  video: [
    { key: 'resolution', values: (m) => enumValues(m.params?.resolution) },
    { key: 'audio',
      values: (m) => (m.params?.generate_audio ? ['audio'] : []),
      valueLabel: { audio: 'Audio' } },
    { key: 'seed',
      values: (m) => (m.params?.seed ? ['seed'] : []),
      valueLabel: { seed: 'Seed' } },
    { key: 'sizes',
      values: (m) => (enumValues(m.params?.size).length ? ['sizes'] : []),
      valueLabel: { sizes: 'Exact sizes' } },
    // === true on purpose: acceptsVideo is null when the modality lookup failed,
    // and unknown must never filter as "does not accept" (docs/models.md).
    { key: 'videoIn',
      values: (m) => (m.acceptsVideo === true ? ['videoIn'] : []),
      valueLabel: { videoIn: 'Video input' } },
  ],
  text: [], // no params in the catalogue; search and price are all there is
};

export function buildFacets(models, kind) {
  const facets = [];
  for (const def of FACET_DEFS[kind] || []) {
    const counts = new Map();
    for (const m of models) {
      for (const v of def.values(m)) counts.set(v, (counts.get(v) || 0) + 1);
    }
    const values = [...counts]
      .filter(([, n]) => n > 0 && n < models.length) // the dead-pill rule
      .map(([value, count]) => ({ value, label: def.valueLabel?.[value] ?? value, count }));
    if (def.key === 'resolution') {
      values.sort((a, b) => resRank(a.value) - resRank(b.value) || a.value.localeCompare(b.value));
    }
    if (values.length) facets.push({ key: def.key, values });
  }
  return facets;
}

// Selections union within a facet (1K OR 2K) and intersect across facets
// (…AND seed). `selected` is { facetKey: [value, …] }; empty arrays are no-ops.
export function applyFacets(models, kind, query, selected) {
  const defs = FACET_DEFS[kind] || [];
  const q = (query || '').trim().toLowerCase();
  return models.filter((m) => {
    if (q && !(m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q))) return false;
    for (const def of defs) {
      const want = selected?.[def.key];
      if (!want?.length) continue;
      const have = def.values(m);
      if (!want.some((v) => have.includes(v))) return false;
    }
    return true;
  });
}

// Fixed 2 decimals, no smart-precision branching: the real rates ($0.0988/s,
// $0.30 per M) all read fine at two places, and a rate too small to show at
// that precision just prints as $0.00 rather than growing extra digits for it.
const fmt = (x) => x.toFixed(2);

// The video catalogue's `pricing` is not one unit — it is whatever OpenRouter
// happens to bill that model in, keyed by a name that is the ONLY reliable
// signal of which unit a value is (measured shapes: pricing-units.md). Treating
// every numeric value as dollars-per-second, as this used to, made a
// dollars-per-TOKEN model ($0.000007) round to "$0.00/s" and a CENTS-per-second
// model ($17) read as "$17.00/s" instead of $0.17/s. So the key name decides the
// family, in this order, and everything else (reference_images,
// minimum_cents_per_generation, cents_per_image_input, …) is a real charge that
// is deliberately dropped rather than folded into a range it does not belong in.
function videoRateFamily(model) {
  const perSecond = [];
  const perToken = [];
  for (const [key, raw] of Object.entries(model.pricing || {})) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (key.includes('cents_per') && key.includes('second')) perSecond.push(n / 100);
    else if (key.includes('duration_seconds')) perSecond.push(n);
    else if (key.startsWith('video_tokens')) perToken.push(n);
  }
  // Per-second is the directly comparable, headline rate; a token family found
  // alongside it is ignored rather than mixed into the same range.
  if (perSecond.length) return { unit: 'second', values: perSecond };
  if (perToken.length) return { unit: 'token', values: perToken };
  return null;
}

// Price only where the list response carries it for free: video (per second
// or per token, see videoRateFamily) and text (per token, shown per million).
// Image returns null by decision, not omission — its pricing lives one
// request-per-model deeper (see the spec's "Decided against").
export function priceLabel(model, kind) {
  if (kind === 'video') {
    const family = videoRateFamily(model);
    if (!family) return null;
    if (family.unit === 'second') {
      const lo = fmt(Math.min(...family.values));
      const hi = fmt(Math.max(...family.values));
      return lo === hi ? `$${lo}/s` : `$${lo}–${hi}/s`;
    }
    const lo = fmt(Math.min(...family.values) * 1e6);
    const hi = fmt(Math.max(...family.values) * 1e6);
    return lo === hi ? `$${lo} per M` : `$${lo}–${hi} per M`;
  }
  if (kind === 'text') {
    const p = Number(model.pricing?.prompt);
    const c = Number(model.pricing?.completion);
    if (!Number.isFinite(p) || !Number.isFinite(c)) return null;
    if (p === 0 && c === 0) return 'free';
    return `$${fmt(p * 1e6)} / $${fmt(c * 1e6)} per M`;
  }
  return null;
}

// The numeric rate priceLabel is built from, for sorting — display and sort must
// never disagree about which family they read. Always the family's minimum (the
// cheapest figure shown), and always the RAW unscaled value even for the token
// family, whose label multiplies by 1e6 only for display: sort order is the same
// either way, and this is the number that would need to change if the label's
// scaling ever did.
export function priceRate(model, kind) {
  if (kind === 'video') {
    const family = videoRateFamily(model);
    return family ? Math.min(...family.values) : null;
  }
  if (kind === 'text') {
    const p = Number(model.pricing?.prompt);
    const c = Number(model.pricing?.completion);
    if (!Number.isFinite(p) || !Number.isFinite(c)) return null;
    return Math.min(p, c);
  }
  return null;
}
