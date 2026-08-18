# The model picker becomes a dialog

Status: designed, not built. Companion to the native-selects change (PR #28),
which fixed the parameter menus the cheap way; this is the deliberate feature
half. Brainstormed 2026-08-18.

## The problem

Every output node picks its model through an Astryx `Selector`: a 200px popup
holding 43 image models, 23 video models, or 245 text models. Two problems,
one shared cause and one of scale:

- Astryx popups are positioned purely by CSS anchor positioning, and where the
  anchor fails to resolve they render at the viewport corner instead of on the
  node — reproducible in the packaged Electron app and in Safari, not fixable
  from this repo, not fixed by the 0.4.3 upgrade. PR #28 moved the parameter
  menus to native `<select>`s; the model picker was deliberately left out
  because its list deserves better than an OS menu.
- Even correctly positioned, 200px is no place to choose between 245 models.
  The capability tags (4K/2K/seed/audio/duration) are cramped onto each row,
  there is no filtering, and nothing shows price.

A `Dialog` is viewport-centered, so it is immune to the anchor bug by
construction — and it has room for search, filter pills, readable tags and a
price column.

## What changes for the user

The Model row on all three output nodes becomes a button showing the current
slug. Clicking it opens a centered dialog:

- **Search** matching both the slug (`openai/gpt-image-2`) and the display
  name (`OpenAI: GPT Image 2`).
- **Filter pills** for capabilities that actually split the catalogue —
  resolution tiers, seed, transparent, quality on image; resolution, audio,
  seed, exact sizes, accepts-video-in, duration on video; none on text, which
  has no params to filter.
- **Rows** with the slug, the capability tags as chips, and — where the data
  is free — price: per-second for video, per-token for text. Image shows no
  price (see "Decided against" below).
- Clicking a row selects the model and closes the dialog. The current model's
  row is marked. 10 rows per page with pagination, like the Library.

## The data, which decides most of this

The three catalogues are unequal, and the dialog shows each honestly rather
than pretending they match:

| kind  | models | params (→ tags, pills)   | price                        |
| ----- | ------ | ------------------------ | ---------------------------- |
| image | 43     | yes                      | not in the list response     |
| video | 23     | yes, plus `acceptsVideo` | per second, in hand          |
| text  | 245    | none                     | per token, in hand but today discarded |

Measured against the live catalogues on 2026-08-18: on image, `aspect_ratio`
and `input_references` are declared by 43 of 43 models — a pill for either
would select everything. The values that split the list: resolution 1K 18 /
2K 15 / 4K 9, seed 12, transparent 6, quality 7 (of 43); on video, resolution
720p 20 / 1080p 13 / 480p 7 / 4K 3, audio 16, seed 14, sizes 19, duration
1–30s (of 23).

## Design

### Facets are derived from the catalogue, not hard-coded

`client/src/nodes/output/facets.js`, pure and tested under bare `node`:

- `buildFacets(models, kind)` → `[{ key, label, values: [{value, label, count}] }]`.
  Scans the catalogue it is given, counts each candidate value, and **drops any
  facet whose values match all models or none** — the dead-pill rule. So
  `aspect_ratio` disappears on its own, and a new OpenRouter param cannot
  quietly become a pill that filters nothing.
- `applyFacets(models, query, selected)` → filtered models. Selections
  intersect across facets and union within one (4K **or** 2K, **and** seed).
  Search matches slug and name, case-insensitive.
- A small eligibility table names which params may become facets and what
  their pills say — because fully derived would surface `input_references` as
  a pill labelled "input_references". Data decides presence and values; the
  table decides wording and order.

The test pins what fails silently: a facet present on every model is dropped,
a facet that splits the list survives with correct counts, and the
intersect/union semantics.

### The dialog is thin markup over it

`client/src/nodes/output/ModelDialog.jsx`: Astryx `Dialog` + `DialogHeader`,
search `TextInput`, pills, `List`/`Item` rows with `Chip` tags, `Pagination`
at 10 per page — the `LibraryDialog` vocabulary. Tags come from
`capabilityTags` in `core.js`, reused unchanged.

**Nothing anchor-positioned goes inside the dialog** — pills, search box,
pagination, and `NativeSelect` (PR #28) if a select is ever needed, never an
Astryx `Selector`. Otherwise the modal reproduces the bug it exists to dodge.

Unlike `LibraryDialog` (one instance in `App.jsx`), each output node mounts
its own dialog conditionally — `{open && <ModelDialog …/>}` — because the
picker belongs to the node whose model it sets, and a shared instance would
mean plumbing "which node asked" through `App.jsx` for nothing. Unmounted is
free.

`ModelPicker` in `controls.jsx` keeps its name and call sites; only its body
changes from `Selector` to button-plus-dialog.

### One server line

`/api/models`' `wantText` branch maps `{}` where the upstream response already
carries `pricing` — the per-token rates are being discarded. It starts passing
`pricing: m.pricing ?? null` through. `host.test.js` asserts the field
survives the route. Image pricing is *not* added (below). Video already works.

## Decided against

- **Image pricing.** It exists upstream but only at
  `/api/v1/images/models/{id}/endpoints` — one extra round-trip per model, 43
  per catalogue load, for a per-token quote that does not translate to "cost
  per image" without token counts, and which varies per provider endpoint
  besides. The rule settled in brainstorming: show price where it is free
  (video, text), skip it where it is not. `CostFoot` and the sidecar remain
  where real spend is reported.
- **A `frame_images` pill.** 21 of 23 video models declare it — technically a
  discriminator, practically dead space. The eligibility table just leaves it
  out.
- **Favourites, recents, a sort control.** Search plus pills over a
  slug-sorted list covers 43/23/245 models. Sort is also the one control that
  would tempt a nested `Selector` — the Library's own sort is exactly that.
- **Serving only image/video and leaving text on the old Selector.** Text is
  the worst list (245 rows) and would leave two pickers in the app; it takes
  the same dialog, degraded honestly to search + price over a roomy list.

## Testing

`facets.test.js` under `npm test` for everything pure; `host.test.js` gains
the text-pricing assertion. The dialog itself is a node component — no tests
by design, verified in the browser: open each of the three kinds, filter,
search, pick, confirm the node's model changed and the dialog closed, and
confirm the pills match the counts above.
