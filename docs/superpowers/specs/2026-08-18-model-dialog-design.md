# The model picker becomes a dialog

Status: built 2026-08-18. Companion to the native-selects change (PR #28),
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
  seed, exact sizes, accepts-video-in on video; none on text, which has no
  params to filter. Duration is not a pill: it splits the catalogue (1–30s),
  but any threshold to bucket it by is a judgment call with no clear answer,
  and it wasn't worth inventing one — cut during plan review 2026-08-18.
- **A table** — Model / Capabilities / Price — with sortable Model and Price
  columns and a sticky header. Price where the data is free: per second or per
  million tokens for video depending on the model, per million for text. The
  image column is omitted entirely, since no image model carries pricing.
- The slug in each row is a button; clicking it selects the model and closes
  the dialog. Rows themselves are not click targets, following
  `LibraryDialog`'s rule that the action is a button, not the row. The current
  model is marked. 10 rows per page, sorted and filtered across the whole set
  before paging.

## The data, which decides most of this

The three catalogues are unequal, and the dialog shows each honestly rather
than pretending they match:

| kind  | models | params (→ tags, pills)   | price                        |
| ----- | ------ | ------------------------ | ---------------------------- |
| image | 43     | yes                      | not in the list response     |
| video | 23     | yes, plus `acceptsVideo` | in hand, but in three different units — see below |
| text  | 245    | none                     | per token, in hand but today discarded |

**Video pricing is not one unit, and assuming it was put wrong prices on
screen.** This spec originally said "per second", generalised from a single
sampled model. Measured across all 23 on 2026-08-18: 9 use
`duration_seconds*` (dollars per second), 5 use `video_tokens*` (dollars per
TOKEN), 2 use `cents_per_second*` (CENTS per second), and 7 mix prefixes,
several carrying non-rate charges (`reference_images`,
`minimum_cents_per_generation`, `cents_per_image_input`) alongside the rate.
Treating every value as dollars-per-second displayed `$0.00/s` for
`bytedance/seedance-2.0` — the default video model, whose per-token rate
rounds to zero — and `$17.00/s` for `black-forest-labs/flux-3-video`, whose
cents figure is really `$0.17/s`. `priceLabel` therefore decides the unit from
the KEY NAME and ignores non-rate keys; `priceRate` returns the same figure the
row displays, so sorting can never disagree with the visible column. The unit
tests carried the same wrong assumption as the code and passed throughout —
only the live catalogue exposed it, which is why node components are verified
in the running app.

Measured against the live catalogues on 2026-08-18: on image, `aspect_ratio`
and `input_references` are declared by 43 of 43 models — a pill for either
would select everything. The values that split the list: resolution 1K 18 /
2K 15 / 4K 9, seed 12, transparent 6, quality 7 (of 43); on video, resolution
720p 20 / 1080p 13 / 480p 7 / 4K 3, audio 16, seed 14, sizes 19, duration
1–30s (of 23).

## Design

### Facets are derived from the catalogue, not hard-coded

`client/src/nodes/output/facets.js`, pure and tested under bare `node`:

- `buildFacets(models, kind)` → `[{ key, values: [{value, label, count}] }]`.
  Scans the catalogue it is given, counts each candidate value, and **drops any
  facet whose values match all models or none** — the dead-pill rule. So
  `aspect_ratio` disappears on its own, and a new OpenRouter param cannot
  quietly become a pill that filters nothing.
- `applyFacets(models, kind, query, selected)` → filtered models. Selections
  intersect across facets and union within one (4K **or** 2K, **and** seed).
  Search matches slug and name, case-insensitive.
- A small eligibility table names which params may become facets and what
  their pills say — because fully derived would surface `input_references` as
  a pill labelled "input_references". Data decides presence and values; the
  table decides wording and order.

It also holds `priceLabel`/`priceRate`, since the unit rules are the part of
this feature that was wrong in the first draft and is invisible when wrong.

The test pins what fails silently: a facet present on every model is dropped,
a facet that splits the list survives with correct counts, the intersect/union
semantics, one case per pricing unit family (including that a
`minimum_cents_per_generation` or `reference_images` charge never widens a
rate range), and that `priceRate` is `null` exactly when `priceLabel` is —
the invariant that keeps sort and display from drifting apart again.

### The dialog is thin markup over it

`client/src/nodes/output/ModelDialog.jsx`: Astryx `Dialog` + `DialogHeader`,
search `TextInput`, `ToggleButton` pills, and an Astryx `Table` sorted by
`useTableSortable`, `Pagination` at 10 per page — the `LibraryDialog`
vocabulary, with `Table` rather than `List`/`Item` because the rows are
uniform columns and price wants its own right-aligned one. Tags come from
`capabilityTags` in `core.js`, reused unchanged.

Two things the `Table` needs that its defaults do not give. The sticky header
is `position: sticky` on the `th` cells, not on `thead`, and the scroll
boundary lives on Table's own `.astryx-table-scroll-wrapper` — that wrapper is
the nearest scrolling ancestor, so a header pinned one level higher rides away
with the rows. And the boundary has to exist somewhere: the `Dialog`'s own
wrapper is `overflow: hidden`, so without it a long catalogue clips silently
instead of scrolling.

**Escape is handled by this component, not by `Dialog`.** Astryx's own Escape
path does not reach `onOpenChange` in this configuration — verified in the
browser, where two model dialogs could be left open at once — so `ModelDialog`
listens for the key itself.

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
`pricing: m.pricing || null` through. **This is not asserted by `host.test.js`**
— the route fetches OpenRouter live at request time, so covering it would mean
stubbing the upstream response, disproportionate for a pure pass-through; the
failure mode is a visibly missing price, which the browser pass below checks
instead. Image pricing is *not* added (below). Video already works.

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

`facets.test.js` under `npm test` for everything pure. The text-pricing line
in `/api/models` is **not** covered by `host.test.js` — that route calls
OpenRouter live, so asserting the field would mean stubbing upstream, which a
pure pass-through doesn't earn. The dialog itself is a node component — no
tests by design, verified in the browser: open each of the three kinds,
filter, search, pick, confirm the node's model changed and the dialog closed,
and confirm the pills match the counts above, plus a missing price would be
visible there (a blank cell) if the pass-through ever broke.
