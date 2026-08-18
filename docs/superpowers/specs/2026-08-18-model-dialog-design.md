# The model picker becomes a dialog

Status: built 2026-08-18. Companion to the native-selects change (PR #28),
which fixed the parameter menus the cheap way; this is the deliberate feature
half. Brainstormed and cut back to size on 2026-08-18.

## The problem

Every output node picked its model through an Astryx `Selector`: a 200px popup
holding 43 image models, 23 video models, or 245 text models. Two problems,
one shared cause and one of scale:

- Astryx popups are positioned purely by CSS anchor positioning, and where the
  anchor fails to resolve they render at the viewport corner instead of on the
  node — reproducible in the packaged Electron app and in Safari, not fixable
  from this repo, not fixed by the 0.4.3 upgrade. PR #28 moved the parameter
  menus to native `<select>`s; the model picker was left out because its list
  deserves better than an OS menu.
- Even correctly positioned, 200px is no place to choose between 245 models,
  and nothing told you which of them were new.

A `Dialog` is viewport-centered, so it is immune to the anchor bug by
construction — and it has room for a real table.

## What changes for the user

The Model row on all three output nodes becomes a button. Clicking it opens a
centered dialog: a search field, a link to OpenRouter's catalogue filtered to
this medium, and a sortable table of Model, Provider and Released. Clicking a
model picks it and closes.

`docs/models.md` owns how all of that works — the provider-label derivation,
where `Released` comes from, the scroll boundary and the Escape handling. This
file is only the reasoning, and what was rejected.

## Why a table of three columns and nothing else

The first build had filter pills over derived facets, capability tags per row,
and a price column. All of it worked; none of it survived contact with the
built thing. The pills wrapped onto two rows, the tags crowded every cell, and
together they made a two-column question — which model, how new — look like a
six-column one. Cut on review, and the dialog got legible.

Two rules came out of that worth keeping. **The picker does not restate what
the parameter controls already say**: capability data drives `useModelParams`,
which is where it belongs. And **the row's job is identification**, which is
why the display name became a Provider column rather than a second line: same
information, a third of the height, and sortable.

## Decided against

- **Filter pills, and capability tags on the rows.** Built, then cut on review
  of the working thing: the pills wrapped onto two rows, the tags crowded
  every cell, and together they made a two-column question look like a
  six-column one. The catalogue's own capability data stays available through
  `useModelParams`, which is what actually drives the parameter controls; the
  picker does not need to restate it.
- **A price column.** Also built, also cut with the tags. Worth recording *why
  it was expensive*, since the cost was not obvious: video pricing is not one
  unit. Measured across all 23 models, 9 use `duration_seconds*` (dollars per
  second), 5 use `video_tokens*` (dollars per **token**), 2 use
  `cents_per_second*` (**cents** per second), and 7 mix prefixes while
  carrying non-rate charges (`reference_images`,
  `minimum_cents_per_generation`, `cents_per_image_input`) alongside the rate.
  Reading them as one unit — which the first draft of this spec asserted, on
  the evidence of a single sampled model — displayed `$0.00/s` for
  `bytedance/seedance-2.0` (a per-token rate rounding to zero, so it read as
  *free*) and `$17.00/s` for `black-forest-labs/flux-3-video`, whose real rate
  is `$0.17/s`. OpenRouter's `-1` "variable pricing" sentinel then rendered as
  `$-1000000.00 per M`. **Every one of those passed `npm test`**, because the
  fixtures encoded the same assumption as the code; only the live catalogue
  exposed them. If price ever returns to this dialog, the units must be read
  from the key name and that is not a small job. Video cost estimates still
  live on the video output node, which reads `pricing` for its own footer.
- **`facets.js`.** A pure, tested module deriving the pills from the catalogue,
  including a rule that dropped any facet matching all models or none. Correct,
  and 182 lines plus 211 of tests for a feature that then got cut. Deleted with
  the pills.
- **Pagination.** The dialog scrolls instead. Paging *and* scrolling is two
  mechanisms for one list, and with 10 rows per page against a shorter box it
  also cut a row in half.
- **Image pricing generally.** It exists upstream but only at
  `/api/v1/images/models/{id}/endpoints` — one request per model, 43 per
  catalogue load, for a per-token quote that does not become "cost per image"
  without token counts.
- **Serving only image and video, leaving text on the old `Selector`.** Text is
  the worst list at 245 models and would have left two pickers in the app.

## Testing

`npm test` covers nothing here by design: what remains is a node component,
and this repo does not test those. Verified in the running app instead, per
kind — search by slug and by display name, both column sorts, picking a model
(dialog closes, trigger relabels, parameter controls rebuild for the new
model), Escape closing, and the sticky header holding while 245 rows scroll
beneath it.
