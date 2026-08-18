# Model Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the output nodes' Astryx `Selector` model picker with a viewport-centered dialog offering search, data-derived filter pills, capability tags with room to breathe, and price where the data is free (video, text).

**Architecture:** A pure, bare-`node`-tested module (`facets.js`) derives filter pills from the live catalogue and applies them; a thin dialog component (`ModelDialog.jsx`) renders it with the `LibraryDialog` vocabulary; `ModelPicker` in `controls.jsx` keeps its exact props and call sites but its body becomes a button that mounts the dialog on demand. One server line stops discarding text pricing. Spec: `docs/superpowers/specs/2026-08-18-model-dialog-design.md`.

**Tech Stack:** React 19, Astryx 0.4.3 (`Dialog`, `ToggleButton`, `TextInput`, `List`/`Item`, `Pagination`), plain-`node` assert tests, Express 4 server. **No new dependencies.**

## Global Constraints

- Changes land by PR, never a direct push to `main` (CLAUDE.md rule 1). Branch: `model-dialog`, worktree `.claude/worktrees/model-dialog`.
- No `engine-*` tag, no GitHub Release.
- **Nothing anchor-positioned inside the dialog** — no Astryx `Selector`, `Menu`, or popup component. Pills are `ToggleButton`, search is `TextInput`, paging is `Pagination`; if a select is ever needed, it is `NativeSelect` from `controls.jsx`.
- `facets.js` must run under bare `node` — no imports at all (it cannot import `core.js`, which imports React).
- `ModelPicker`'s props `{ models, value, onChange, kind }` do not change; the three node files are not touched.
- Every server `await` that can reject sits inside a `try/catch` that returns a status (the `/api/models` route already has one; stay inside it).
- `npm test` green after every task.
- Comments follow the house rule: only where deleting them would let someone make a wrong change.

---

### Task 1: `facets.js` — derive, apply, price

**Files:**
- Create: `client/src/nodes/output/facets.js`
- Test: `client/src/nodes/output/facets.test.js`
- Modify: `package.json:13` (add the test to the `test` script)

**Interfaces:**
- Consumes: nothing (pure module, zero imports).
- Produces (Task 3 relies on these exact signatures):
  - `buildFacets(models, kind)` → `[{ key, values: [{ value, label, count }] }]`
  - `applyFacets(models, kind, query, selected)` → filtered `models` array, where `selected` is `{ [facetKey]: [value, …] }`
  - `priceLabel(model, kind)` → `string | null`

- [ ] **Step 1: Write the failing test**

Create `client/src/nodes/output/facets.test.js`:

```js
// node client/src/nodes/output/facets.test.js  (also runs as part of `npm test`)
import assert from 'node:assert/strict';
import { buildFacets, applyFacets, priceLabel } from './facets.js';

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
// Fixed 2 decimals, no cleverness: a rate too small to show at that precision
// prints as $0.00 rather than growing extra digits for it.
assert.equal(
  priceLabel({ id: 't', pricing: { prompt: '0.000000001', completion: '0.0000025' } }, 'text'),
  '$0.00 / $2.50 per M',
);

console.log('facets.test.js ok');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/matteoaliano/Unframed/.claude/worktrees/model-dialog && node client/src/nodes/output/facets.test.js`
Expected: FAIL — `Cannot find module './facets.js'`.

- [ ] **Step 3: Implement `facets.js`**

Create `client/src/nodes/output/facets.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node client/src/nodes/output/facets.test.js`
Expected: `facets.test.js ok`

- [ ] **Step 5: Add it to `npm test`**

In `package.json` line 13, insert `node client/src/nodes/output/facets.test.js && ` after `node client/src/graph/bulkWire.test.js && `:

```json
"test": "node client/src/graph/resolve.test.js && node client/src/graph/bulkWire.test.js && node client/src/nodes/output/facets.test.js && node server/env.test.js && node server/share.test.js && node server/presets.test.js && node server/jobs.test.js && node server/host.test.js"
```

Run: `npm test` — all suites green, `facets.test.js ok` among them.

- [ ] **Step 6: Commit**

```bash
git add client/src/nodes/output/facets.js client/src/nodes/output/facets.test.js package.json
git commit -m "Derive the model dialog's filter facets from the catalogue"
```

---

### Task 2: Server passes text pricing through

**Files:**
- Modify: `server/index.js` (the `/api/models` route, line ~410)

**Interfaces:**
- Consumes: nothing new.
- Produces: `/api/models?type=text` rows gain `pricing: { prompt, completion, … } | null`. `priceLabel(model, 'text')` from Task 1 reads exactly this field.

A pure pass-through of a field OpenRouter already sends — no new logic, so no
new test infrastructure. `host.test.js` already forks the real server against a
temp dir for exactly the routes worth that cost (money-spending paths, sweep
timing); this is neither. A mistake here shows up immediately as a missing
price in the dialog, which Task 5's browser pass already checks per kind.

- [ ] **Step 1: Make the change**

In `server/index.js`, inside the `/api/models` route, the per-model mapping's
text branch currently discards pricing:

```js
          : wantText
            ? {}
            : { params: m.supported_parameters || null }),
```

becomes:

```js
          : wantText
            // Per-token rates, already in this response; the model dialog shows
            // them per million. Image pricing is NOT fetched — it costs one
            // request per model (see the 2026-08-18 model-dialog spec).
            ? { pricing: m.pricing || null }
            : { params: m.supported_parameters || null }),
```

- [ ] **Step 2: Run the suite**

Run: `npm test` — all green (nothing here is exercised by it; this just confirms the edit didn't break the route's existing shape).

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "Pass text models' per-token pricing through /api/models"
```

---

### Task 3: `ModelDialog.jsx`

**Files:**
- Create: `client/src/nodes/output/ModelDialog.jsx`
- Modify: `client/src/styles.css` (row styles; append near the existing `.model-tag` block, line ~755)

**Interfaces:**
- Consumes: `buildFacets` / `applyFacets` / `priceLabel` from Task 1 (exact signatures above); `capabilityTags(entry, kind)` from `./core.js`.
- Produces: `default export ModelDialog({ models, kind, value, onPick, onClose })` — Task 4 mounts it. `onPick(id)` is called with the chosen model id; the CALLER closes (`onPick` then `onClose` are both invoked by the row click handler below, so the caller only supplies state changes).

- [ ] **Step 1: Write the component**

Create `client/src/nodes/output/ModelDialog.jsx`:

```jsx
// The model picker's dialog. Viewport-centered, which is the point: Astryx's
// anchor-positioned popups can render at the viewport corner when the anchor
// fails to resolve (packaged app, Safari), and a centered Dialog is immune by
// construction. For the same reason NOTHING anchor-positioned goes inside it —
// pills are ToggleButtons, and any future select in here is NativeSelect.
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { Pagination } from '@astryxdesign/core/Pagination';
import { List } from '@astryxdesign/core/List';
import { Item } from '@astryxdesign/core/Item';
import { Text } from '@astryxdesign/core/Text';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { capabilityTags } from './core.js';
import { buildFacets, applyFacets, priceLabel } from './facets.js';

const PAGE_SIZE = 10;
const TITLES = { image: 'Image models', video: 'Video models', text: 'Text models' };

export default function ModelDialog({ models, kind, value, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState({});
  const [page, setPage] = useState(1);

  const facets = useMemo(() => buildFacets(models, kind), [models, kind]);
  const shown = useMemo(
    () => applyFacets(models, kind, query, selected),
    [models, kind, query, selected],
  );

  // A new search or filter is a new result set; page 3 of the old one means
  // nothing. Same rule as the Library.
  useEffect(() => setPage(1), [query, selected]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const paged = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const toggle = (key, v) =>
    setSelected((s) => {
      const cur = s[key] || [];
      return { ...s, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });

  return (
    // nodrag/nowheel: the dialog's DOM lives inside the node's subtree, so
    // without them a drag inside the dialog moves the node under it and a
    // scroll pans the canvas.
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} width={680} className="nodrag nowheel">
      <DialogHeader title={TITLES[kind] || 'Models'} />
      <VStack gap={3} padding={4}>
        <TextInput
          label="Search models"
          isLabelHidden
          size="sm"
          startIcon="search"
          placeholder="Search models…"
          value={query}
          onChange={setQuery}
        />

        {facets.length > 0 && (
          <HStack gap={1} align="center" wrap="wrap">
            {facets.flatMap((f) =>
              f.values.map((v) => (
                <ToggleButton
                  key={`${f.key}:${v.value}`}
                  label={`${v.label} (${v.count})`}
                  size="sm"
                  isPressed={Boolean(selected[f.key]?.includes(v.value))}
                  onPressedChange={() => toggle(f.key, v.value)}
                />
              )),
            )}
          </HStack>
        )}

        {shown.length === 0 ? (
          <Text type="supporting" color="secondary">
            No model matches. Clear the search or a filter.
          </Text>
        ) : (
          <div className="model-dialog-list">
            <List density="compact">
              {paged.map((m) => {
                const tags = capabilityTags(m, kind);
                const price = priceLabel(m, kind);
                return (
                  <Item
                    as="li"
                    key={m.id}
                    density="compact"
                    isSelected={m.id === value}
                    onClick={() => { onPick(m.id); onClose(); }}
                    label={
                      <HStack gap={1} align="center" wrap="wrap">
                        {/* Slug, not display name: the slug is what goes in
                            OPENROUTER_*_MODEL, same rule as the old picker. */}
                        <Text type="body" weight="medium">{m.id}</Text>
                        {tags.map((t) => (
                          <span className="model-tag" key={t}>{t}</span>
                        ))}
                      </HStack>
                    }
                    description={m.name !== m.id ? m.name : undefined}
                    endContent={
                      price && (
                        <Text type="supporting" color="secondary" hasTabularNumbers>
                          {price}
                        </Text>
                      )
                    }
                  />
                );
              })}
            </List>
          </div>
        )}

        {shown.length > PAGE_SIZE && (
          <HStack justify="end">
            <Pagination
              page={current}
              onChange={setPage}
              totalItems={shown.length}
              pageSize={PAGE_SIZE}
              variant="count"
              size="sm"
            />
          </HStack>
        )}
      </VStack>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add the row CSS**

In `client/src/styles.css`, directly after the `.model-tag` rule (~line 761), append:

```css
/* Model dialog rows: same divider treatment as the Library's list view
   (.lib-scroll), which these rows are a sibling of in spirit. */
.model-dialog-list .astryx-list > li + li {
  border-top: 1px solid var(--color-border);
}
```

- [ ] **Step 3: Check it compiles**

Run: `npm run client` (or the running dev server's HMR). Expected: no import errors in the Vite overlay/terminal. The component is not mounted anywhere yet — that is Task 4 — so this is only a build check. Then `npm test` (unaffected, but the gate is cheap).

- [ ] **Step 4: Commit**

```bash
git add client/src/nodes/output/ModelDialog.jsx client/src/styles.css
git commit -m "Add the model dialog component"
```

---

### Task 4: `ModelPicker` opens the dialog

**Files:**
- Modify: `client/src/nodes/output/controls.jsx` (the `ModelPicker` function, line ~62, and its imports)
- Modify: `client/src/styles.css` (remove the now-dead `.model-option*` rules, keep `.model-tag`)

**Interfaces:**
- Consumes: `ModelDialog` from Task 3.
- Produces: `ModelPicker({ models, value, onChange, kind })` — **unchanged props**, so `ImageOutputNode.jsx:361`, `TextOutputNode.jsx:123` and `VideoOutputNode.jsx:406` are not touched.

- [ ] **Step 1: Rewrite `ModelPicker`**

In `client/src/nodes/output/controls.jsx`:

1. Imports: add `useState` and `Button` and `ModelDialog`; drop `Selector` (after this change nothing in the file uses it):

```js
import { useState } from 'react';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Stack';
import { capabilityTags, ratioLabel } from './core.js';
import ModelDialog from './ModelDialog.jsx';
```

(`capabilityTags` stays imported only if still used in this file after the rewrite — it is not; `ModelDialog` imports it itself. Drop it here, keep `ratioLabel`, which `ParamControls` uses.)

2. Replace the whole `ModelPicker` function body (currently the `Selector` with `renderOption`, lines ~62–89) with:

```jsx
// Labelled by slug, not OpenRouter's display name: the slug is what you put in
// OPENROUTER_IMAGE_MODEL, and it keeps every row in one format. The picker is a
// button into a centered dialog rather than an anchored popup — the dialog is
// immune to the anchor-positioning failures that hit Astryx popups in the
// packaged app and Safari, and it has room for search, filters and price that
// 200px never had. Mounted only while open: each node owns its own picker, and
// an unmounted dialog costs nothing.
export function ModelPicker({ models, value, onChange, kind }) {
  const [open, setOpen] = useState(false);
  return (
    <label className="model-picker">
      <Text type="label" color="secondary">Model</Text>
      <Button
        label={value || 'Loading models…'}
        size="sm"
        variant="secondary"
        isFullWidth
        isDisabled={!models.length}
        onClick={() => setOpen(true)}
      />
      {open && (
        <ModelDialog
          models={models}
          kind={kind}
          value={value}
          onPick={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </label>
  );
}
```

Check `Button`'s full-width prop name before relying on `isFullWidth`: run `grep -nE "isFullWidth|fullWidth" client/node_modules/@astryxdesign/core/src/Button/Button.tsx`. If the prop differs, use the real one; if none exists, drop the prop and add `.model-picker .astryx-button { width: 100%; }` to the CSS in Step 2.

3. `.model-picker` CSS, appended next to the dialog rule from Task 3:

```css
/* The picker's label + button column: same label-to-control gap as Astryx's
   own Field, matching the native selects beside it. */
.model-picker {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}
```

- [ ] **Step 2: Delete the dead CSS**

In `client/src/styles.css`, the old `Selector` row markup is gone, so remove the `.model-option`, `.model-option-id` and `.model-option-tags` rules (lines ~737–754). **Keep `.model-tag`** — the dialog rows use it.

Confirm nothing else references them: `grep -rn "model-option" client/src/` → only styles.css hits before deleting, none after.

- [ ] **Step 3: Run the suite**

Run: `npm test` — green. (No component tests by design; browser verification is Task 5.)

- [ ] **Step 4: Commit**

```bash
git add client/src/nodes/output/controls.jsx client/src/styles.css
git commit -m "Open the model picker as a dialog"
```

---

### Task 5: Browser verification, then docs

**Files:**
- Modify: `CHANGELOG.md` (new dated entry)
- Modify: `docs/models.md` (the picker paragraph)
- Read: `status.md` (delete any todo this closes; nothing else)

- [ ] **Step 1: Verify in the running app** (CLAUDE.md "After a change" §2 — node components have no tests by design, so this IS the test)

Start `npm run dev` from the worktree. For each of the three output nodes:

1. The Model row is a button showing the current slug; click → a centered dialog opens (not at a corner; drag the node first and reopen — position must not depend on the node).
2. **image:** pills show Size (1K/2K/4K), Transparent, Quality, Seed with counts; no Ratio pill (the 43/43 rule). Toggling 4K narrows the list; 4K+Seed narrows it further; counts match `docs/models.md`'s expectations. No price on rows.
3. **video:** pills show Size tiers, Audio, Seed, Exact sizes, Video input; rows show per-second prices (`$0.10–0.17/s` shape). Filter Video input → only the video-to-video models remain.
4. **text:** no pills (no params exist), search over 245 rows, per-M prices on rows (`$0.30 / $2.50 per M` shape), `free` on free models. This is the one manual check standing in for the automated test Task 2 skipped — confirm at least one row actually shows a price, not just that the column exists (a `pricing: null` bug would render as an empty column, easy to miss). Pagination works; changing the search resets to page 1.
5. Picking a model closes the dialog, the button relabels, and the node's parameter controls rebuild for the new model (the `resetModelParams` path — pick a model with different params and watch Size/Quality change).
6. Reload: the choice persisted to `graph.json` (check `output/<project>/graph.json`).
7. Inside the open dialog: dragging on its body must not move the node; scrolling must not pan the canvas; Backspace in the search field must not delete the node.
8. Console: no errors.

Fix anything found; re-run `npm test`; amend or follow-up commit as appropriate.

- [ ] **Step 2: CHANGELOG entry**

Under `## 2026-08-18` (create the heading only if a later date now tops the file), in `### Changed`:

```markdown
- **Choosing a model opens a dialog instead of a dropdown.** Room to actually
  read the list: search over every model, filter pills for what a model can do
  (only where it tells them apart — a filter every model matches is not shown),
  the capability tags on each row, and price where OpenRouter includes it — per
  second for video, per million tokens for text. Like the other menus fixed on
  2026-08-18, the dialog also cannot open at the corner of the window.
```

- [ ] **Step 3: docs/models.md**

Its closing picker paragraph ("The picker tags each row with what actually differs…") stays true; extend it with the dialog's rules, which live here because this file owns model-driven controls:

```markdown
The picker itself is a dialog (`ModelDialog.jsx` over `facets.js`), not an
anchored popup. Its filter pills are DERIVED from the catalogue by
`buildFacets`: the eligibility table in `facets.js` nominates a param and its
wording, and the data decides whether it appears — a value carried by every
model in the catalogue, or by none, filters nothing and is dropped (the rule
that keeps `aspect_ratio`, on 43 of 43 image models, from becoming a pill).
Price appears only where the list response already carries it: per-second for
video, per-million-tokens for text. Image pricing lives one request per model
deeper and is deliberately not fetched — see the 2026-08-18 model-dialog spec.
```

- [ ] **Step 4: status.md check**

Read `status.md`; delete any todo the dialog closes. Do not add new todos.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md docs/models.md status.md
git commit -m "Document the model dialog"
```

---

### Task 6: PR

- [ ] **Step 1: Final gate**

```bash
npm test
git log --oneline main..HEAD
```

All green; history is the five commits above (plus the spec commit already on the branch).

- [ ] **Step 2: Push and open the PR**

`gh auth status` must show `teoaliano` active (CLAUDE.md); then:

```bash
git push -u origin model-dialog
gh pr create --base main --head model-dialog \
  --title "Choose models in a dialog with search, filters and price" \
  --body "…summary of the above: why (anchor bug + 200px over 245 models), what (facets.js + ModelDialog + one server line), verification notes per kind, and the spec link docs/superpowers/specs/2026-08-18-model-dialog-design.md. End with the Claude Code attribution line."
```

Do NOT merge; the user merges.
