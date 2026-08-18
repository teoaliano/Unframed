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

The Model row on all three output nodes becomes a button showing the current
slug. Clicking it opens a centered dialog holding a search field and a table
of three columns:

| Model | Provider | Released |
| --- | --- | --- |
| the model half of the slug | the provider's display name | the release date |

All three sort; newest first by default, which is the reason the date is there
at all. Search matches the whole slug (`openai/gpt-image-2`) and the display
name (`OpenAI: GPT Image 2`) — neither is shown intact now that the slug is
split, so search has to cover both. Clicking a model picks it and closes; the
value stored is always the full slug, not the displayed half.

Rows are single-line. An earlier version put the display name on a second line
under the slug, which made every row double height for information the Provider
column now carries in a scannable, sortable form.

`Released` comes from OpenRouter's `created` (Unix seconds), present on every
model in all three catalogues — 43/43, 23/23, 413/413 when measured on
2026-08-18. The server passes it through as a number so the table sorts on the
value rather than on a formatted string.

`Provider` is derived, and the derivation is the one non-obvious bit left. The
slug prefix is the provider's KEY; its pretty label comes from the display name,
which is `Provider: Model` — but only for some models. 23 of 245 text models
have no colon, so parsing per row rendered `~anthropic` directly below
`Anthropic`. Keying on the prefix (with any leading `~` stripped) and taking the
label from whichever sibling does have a colon resolves every provider in image
and video, and all but two in text, which fall back to the bare prefix. Both
derived fields are put on the row objects so Table's own comparators sort the
values it renders rather than the raw slug.

## Design

`client/src/nodes/output/ModelDialog.jsx` is the whole feature: Astryx
`Dialog` + `DialogHeader`, a `TextInput` for search, and a `Table` with
`useTableSortable`. `ModelPicker` in `controls.jsx` keeps its name, its props
`{ models, value, onChange, kind }` and its three call sites; only its body
changed from `Selector` to button-plus-dialog. The three node files are
untouched.

There is no separate pure module and no test file, because there is no logic
left that fails silently — a substring search and a numeric comparator are
both obvious from reading them. (An earlier draft had one; see "Decided
against".)

Three things are not obvious from the code and are commented where they live:

- **Escape is handled by the component, not by `Dialog`.** Astryx's own Escape
  path does not reach `onOpenChange` in this configuration — verified in the
  browser, where two model dialogs could be left open at once — so
  `ModelDialog` listens for the key itself, in the capture phase.
- **The scroll boundary sits on Table's own `.astryx-table-scroll-wrapper`**,
  which is the nearest scrolling ancestor and therefore what a sticky `th`
  sticks to; putting it one level higher left the header scrolling away with
  the rows. It has to exist somewhere, because the `Dialog`'s wrapper is
  `overflow: hidden` and a long catalogue would otherwise clip silently.
- **Table's `containerBleed` reads `--container-padding-*` from its ancestors**
  and applies negative margins to cancel them, which pushed the table 16px
  past the scroll box on every side and put half the header above the
  boundary. Zeroing those vars on the wrapper div is the fix.

Each output node mounts its own dialog conditionally — `{open && <ModelDialog
…/>}` — rather than sharing one instance in `App.jsx` the way `LibraryDialog`
does, because the picker belongs to the node whose model it sets and a shared
instance would mean plumbing "which node asked" through `App.jsx` for nothing.

**Nothing anchor-positioned goes inside the dialog** — search is a `TextInput`,
and `NativeSelect` (PR #28) is the fallback if a select is ever needed, never
an Astryx `Selector`. Otherwise the dialog reproduces the bug it exists to
dodge.

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
