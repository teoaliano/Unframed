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

// Price only where the list response carries it for free: video (per second,
// possibly split by resolution) and text (per token, shown per million).
// Image returns null by decision, not omission — its pricing lives one
// request-per-model deeper (see the spec's "Decided against").
export function priceLabel(model, kind) {
  if (kind === 'video') {
    const nums = Object.values(model.pricing || {}).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (!nums.length) return null;
    const lo = fmt(Math.min(...nums));
    const hi = fmt(Math.max(...nums));
    return lo === hi ? `$${lo}/s` : `$${lo}–${hi}/s`;
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
