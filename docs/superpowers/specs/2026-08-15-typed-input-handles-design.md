# Typed input handles, and frames for video

*2026-08-15*

## Why

A user of a fork wired an image into a video output on `bytedance/seedance-2.0` and got:

```
OpenRouter (400): InputVideoSensitiveContentDetected.PrivacyInformation
The request failed because the input video 'content[1]' may contain real person.
```

The same picture had worked for them on another platform. It is not our bug and not
OpenRouter's — it is ByteDance's ModelArk moderation, forwarded verbatim by
`server/index.js:630`. `content[1]` is ModelArk's own request shape: `content[0]` is the
prompt, `content[1]` the first attached media.

The reason it fires here and not elsewhere is the *slot* the image goes into. OpenRouter's
video API has two, and we only ever use one:

| | `frame_images` | `input_references` |
| --- | --- | --- |
| meaning | this image **is** that frame | guidance: character, set, style |
| media | images only | images, video, audio |
| how many | 2 — `first_frame`, `last_frame` | 2.5: 30 img + 10 vid + 10 audio; 2.0: 9 + 3 + 3 |
| addressing | explicit `frame_type` | array index (`@Image1`…) |
| moderation | permissive | strict real-person classifier |

Sourcing: the two-slot split, precedence, and `supported_frame_images` being exactly
`["first_frame","last_frame"]` on all five seedance models come from OpenRouter's docs and
its live `/api/v1/videos/models` catalogue. The per-model reference counts and the
`@ImageN` convention come from ByteDance-side docs and provider guides, not from
OpenRouter — treat them as indicative, not contractual.

`resolve.js` puts every wired image into `input_references`, so every generation takes the
reference-to-video path — the identity-transfer one, with the classifier in front of it.
Platforms exposing an "image to video" endpoint are using the first-frame path instead.

There is no way to choose in Unframed today. This spec adds one.

A second, unrelated defect surfaced while investigating and rides along in the same PR
because it touches the same file.

## Decisions

### 1. Unknown `@tokens` survive as literal text

`resolve.js:25` deletes any `@word` that is not a node id. Verified:

```
"a woman with @curly hair"  ->  "a woman with  hair"
```

`insert.js:27` — the other `TOKEN_RE` in the repo — already leaves unknown tokens alone,
and `resolve.test.js:328` pins that. The codebase disagrees with itself; this makes
resolution match insertion.

**One thing depends on the deletion.** `freeRunPrompts` builds each run's shared context by
calling `buildRequest` with the list-supplying text node *filtered out of the node array*,
which turns a sibling's `@t1` into an unknown id, which is what stops the whole list
leaking back into every run.

Fix: don't filter the node out — keep it with an empty result. `@t1` is then a *known* id
resolving to empty, Free mode stops leaning on a fallback it never meant to use, and
`resolve.test.js:298` (`!p.includes('@t1')`) passes unchanged.

*Rejected:* leaving the deletion in place and special-casing Seedance's `@ImageN`. Two
token dialects in one field is worse than one rule.

### 2. Roles are declared by the wire, not by a dropdown

An output node grows named target handles. An image wired into `first` is a first frame; an
image wired into the bare handle is a reference. The role is visible on the canvas as
cable position, and a frame image is *provably* absent from `input_references` because you
can see where it goes.

*Rejected:* two `Selector`s on the video node ("first frame: image 3"). It needs a stable
key for the choice, it renumbers the reference badges invisibly when a pinned image leaves
the list, and it puts the same information in two places — the dropdown and the wire.

The mechanism generalises: a negative-prompt handle, an audio handle, a mask handle are
each one entry in a list. Only frames are built now.

### 3. Geometry, from the target-size rule

Handles are 9×9px today (`styles.css:147`) and need precise aiming. WCAG 2.2 SC 2.5.8
(Level AA) asks for 24×24 CSS px, with a spacing exception: a smaller target passes if a
24px circle centred on it does not overlap a neighbour's.

- dot: **12px** (visual)
- hit box: **24px**, transparent, via `::before` inset −6px
- centres: **32px** apart, so hit boxes clear each other by 8px

This applies to every handle in the app, not just the new ones.

### 4. Labels appear at zoom ≥ 0.8, and on hover always

Threshold derived, not guessed: an 11px label at 0.8 renders at ~8.8px, about the floor of
comfortable reading. Verified in the browser at zoom 0.806 with a DOM mock — legible.

- only the *named* handles carry labels; the bare references handle has none
- hover and keyboard focus show the label at any zoom

**Labels sit outside the card, left of the dot**, at 12px / weight 500. All three
placements were mocked in the running app:

| Placement | Result |
| --- | --- |
| **outside the card, left of the dot** | chosen — edges do cross the text, accepted as the lesser cost |
| inside the card's existing padding | "first" lands on top of the Model selector |
| 40px gutter, card 300 → 340 | clean, but every video node pays 40px of width for chrome |

The card stays 300px and matches the other two outputs. The edge/label overlap is real but
minor: edges are thin dashed lines, and the label is only up while you are zoomed in on the
node anyway.

At 12px the legibility floor (~9px rendered) actually lands at zoom 0.75, so 0.8 has a
little headroom — worth remembering if labels turn out to appear later than wanted.

Subscribe to the boolean, not the zoom: `useStore((s) => s.transform[2] >= 0.8)` re-renders
a node only when it flips, not on every wheel tick.

### 5. Fallbacks and arity

- **Model without frame support:** the frame handles stay **mounted**, dimmed and
  `isConnectable={false}`. Edges already on them fall back to being references. They are
  not unmounted, because React Flow cannot draw an edge to a handle that does not exist —
  hiding them would break the edge instead of demoting it.
- **Second image into an occupied frame handle:** replaces the first. `onConnect`
  (`App.jsx:531`) drops any existing edge with the same `target` + `targetHandle` before
  `addEdge`.
- **Wrong source type:** `isValidConnection` refuses anything but an `image` node on a
  frame handle. Refused at the wire, not silently ignored downstream.

## Design

### Handles

`videoOutput` gets three target handles:

| id | label | accepts |
| --- | --- | --- |
| *(default, `null`)* | — | anything, as today |
| `first_frame` | first | one `image` node |
| `last_frame` | last | one `image` node |

Handle ids are the API's own `frame_type` values, so the mapping is an identity —
`frame_type: edge.targetHandle` — with no lookup table to drift. The visible label stays
short ("first"), since it hangs outside the card where every character costs.

Stacked below the header, 32px apart, in that order. Anchoring to the top rather than
centring means a later audio handle appends at the bottom and nothing above it moves.

`imageOutput` and `textOutput` are untouched: one bare handle, `targetHandle` null.

### `resolve.js`

`buildRequest(nodes, edges, outputId, opts)` gains one option and one return field:

```js
// opts.framesAsReferences: true when the chosen model declares no frame support,
// so frame-handle edges collapse back into input_references in Y order.
{ prompt, input_references, frame_images }
```

Sources are bucketed by `e.targetHandle`: `null` → references (unchanged), `first`/`last` →
`frame_images` as `{ type: 'image_url', image_url: { url }, frame_type: 'first_frame' }`.

`resolve.js` stays model-agnostic — it never learns which model is selected. The video node
knows the catalogue entry and passes the flag.

`imageRefNumbers` counts the references bucket only, so an image moved to a frame handle
loses its number and the rest close the gap. The renumbering is visible: you moved the
cable.

### Client → server

`VideoOutputNode` sends `frame_images` when `entry.params.frame_images` is non-null;
otherwise it calls `buildRequest` with `framesAsReferences: true` and sends nothing extra.
`params.frame_images` is **already** plumbed through `server/index.js:307` — no server work
for the capability, only for the payload.

`POST /api/video` forwards `frame_images` alongside `input_references`, counts it in the
`video job →` log line, and records it in the sidecar's `references` field.

Both arrays accept `data:` base64 URLs (confirmed in OpenRouter's own skill doc), so our
image nodes need no hosting.

## Open risk

OpenRouter documents: *"If both fields are provided, `frame_images` takes precedence and
the request is treated as image-to-video."* Their skill doc: *"If both arrays are present,
`frame_images` wins."* Neither says whether `input_references` is forwarded-but-lower-priority
or dropped.

This matters, because "one frame plus several references" is the normal case for this
feature. If references are dropped, pinning a frame silently discards them.

**Probe during implementation**, before the UI is finished: one job on
`bytedance/seedance-2.0-mini` at 480p/4s with a frame image *and* a reference image that is
known to trip the real-person classifier. A 400 proves the reference reached ModelArk; a
rendered clip proves it did not. Costs ~$0.30 if it succeeds, nothing if it 400s. Needs the
user's explicit go-ahead to spend it.

If references turn out to be dropped: the video node warns when both are wired, and the
feature becomes "frames *or* references", not both.

## Out of scope

- **Audio references** (10 clips on 2.5). A new `audio` input node — node file, add-menu
  entry, `NEW_NODE` data, size cap, badge counter, `audio_url` in `resolve.js`. Separate PR.
- **Negative prompts.** The mechanism will support a named handle for it; no image model in
  our catalogue declares the parameter, so there is nothing to wire it to yet.
- **`@ImageN` addressing.** Seedance's documented convention; our prompts say "image 1" as
  plain text and the model copes. Adopting it is a separate decision, and decision 1 above
  is its prerequisite.
- **Portrait-tier / consent-gated real-person routes.** Not exposed through OpenRouter.

## Verification

Pure logic → `resolve.test.js`:

- an unknown `@token` survives literally; a known one still resolves
- `freeRunPrompts` still strips `@t1` with the text node stubbed rather than filtered
- frame-handle edges land in `frame_images` with the right `frame_type`, and are absent
  from `input_references`
- `framesAsReferences: true` puts them back in the references array in Y order
- `imageRefNumbers` skips images on frame handles

Node components have no tests by design. Verified in the browser and reported:

- handle hit area (a click 10px off the dot still starts a connection)
- labels appear crossing zoom 0.8, and on hover below it
- switching to a model without frame support dims the handles and keeps the edge
- a second image into `first` replaces the first
- a prompt node cannot connect to `first`

## Documentation to update

| File | What |
| --- | --- |
| `CLAUDE.md:70` | "unknown ids resolve to empty string" → survive literally; note the two `TOKEN_RE`s now agree |
| `CLAUDE.md` node types | handles carry roles; only `videoOutput` has named ones |
| `docs/video-and-sharing.md` | frames vs references, the moderation difference, the two-slot table |
| `CHANGELOG.md` | both changes are user-visible |
| `status.md` | close the todo if one exists; record audio/negative-prompt as deliberately deferred |
