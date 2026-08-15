# Video input mode, and frames

*2026-08-15*

## Why

A user of a fork wired an image into a video output on `bytedance/seedance-2.0` and got:

```
OpenRouter (400): InputVideoSensitiveContentDetected.PrivacyInformation
The request failed because the input video 'content[1]' may contain real person.
```

The same picture had worked for them on another platform. It is not our bug and not
OpenRouter's — it is ByteDance's ModelArk moderation, forwarded verbatim. `content[1]` is
ModelArk's own request shape: `content[0]` is the prompt, `content[1]` the first attached
media.

The reason it fires here and not elsewhere is that we only ever send one *kind* of request.

## What Seedance actually offers

ByteDance's API reference enumerates four **mutually exclusive task types**. A request is
exactly one of them — the API even carries an `omni_reference_task_type` hint:

| Task type | Takes |
| --- | --- |
| omni reference-to-video | 2.5: 0–30 images, 0–10 videos, 0–10 audio. 2.0 series: 0–9 / 0–3 / 0–3 |
| image-to-video (first and last frames) | a first-frame image, a last-frame image |
| image-to-video (first frame) | a first-frame image |
| text-to-video | nothing but the prompt |

OpenRouter exposes these as two arrays — `input_references` and `frame_images` (entries
carrying `frame_type: first_frame | last_frame`) — and documents that `frame_images` wins
when both are sent. That is their adapter picking a task type on your behalf, correctly.

**Confirmed by probe, 2026-08-15, `bytedance/seedance-2.0` at 480p/4s, $0.3274 total:**

| Run | Sent | Result |
| --- | --- | --- |
| A | reference only, prompt not naming it | completed on `2.0-mini`, clip ignored the reference — inconclusive, the prompt gave it no job |
| A′ | reference only, prompt naming it | **failed** — output-side content rejection derived from the reference, so it *was* used |
| B | identical to A′, **plus** a `first_frame` | **completed** — clip contains only the frame image, no trace of the reference, no moderation complaint |

References are discarded when frames are present. Not deprioritised — the request became a
different task type. ("Forwarded but unused" is indistinguishable from "not forwarded" from
outside; the user-visible behaviour is the same.)

`resolve.js` puts every wired image into `input_references`, so Unframed can only ever ask
for omni reference-to-video — the identity-transfer path, and the one with the strict
real-person classifier in front of it. Platforms where the same picture "just worked" were
sending image-to-video.

**Moderation fires on two paths, at two times:**

| Check | When | How it arrives | Handled by |
| --- | --- | --- | --- |
| input (`InputImage/VideoSensitiveContentDetected`) | at create | HTTP 400, provider's own 400 quoted inside | `index.js:630` |
| output (`…may be related to copyright restrictions`) | minutes later | HTTP 200, `status: "failed"` + `error` | `index.js:682` |

Both are already handled. Neither needs new code, but anything explaining a moderation
failure has to cover both.

Sourcing: the two arrays, precedence, and `supported_frame_images` being exactly
`["first_frame","last_frame"]` on all five seedance models come from OpenRouter's docs and
its live `/api/v1/videos/models` catalogue. The task types and reference counts are
ByteDance's own. The `@ImageN` prompt convention is from provider guides — indicative only.

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

### 2. Input mode is a control on the node, not a shape in the graph

The video output node gets an **Input** selector — References / First frame / First and
last frame — sitting with Model, Size and Seconds. It selects the task type; everything
else follows from it.

*Rejected: named target handles* (`first_frame` / `last_frame` as separate connection
points, which this spec previously specified). It reads well on a canvas, but it encodes a
graph shape the provider does not have: three handles imply three simultaneous roles, and
Seedance accepts exactly one task type per request. A wiring UI that can express an
impossible request is a UI that has to explain itself afterwards. The mode selector cannot
express one.

The earlier objection to a dropdown — that it puts the choice in two places, the control
and the wire — dissolves once the mode is a property of the *request* rather than of each
image.

Options are gated by what the model declares in `params.frame_images`, the way every other
control here is gated. A model with no frame support shows no selector at all, rather than
a selector with one option.

**Amendment:** this design originally carried a `framesUnsupported` fallback in
`bucketSources`/`buildRequest`, for a graph saved in a frame mode and reopened on a model
without frame support — the request would collapse the mode back to references. That left
the canvas marks (red edges, the ignored count, the badges), which are derived without
model knowledge, disagreeing with what the request actually did: a graph could show two
contradictory warnings at once. The fallback is removed in favour of making the state
unreachable — switching a node's model now resets its model-dependent settings to that
model's defaults (`resetModelParams` in `client/src/nodes/output/defaults.js`), and a node whose
stored mode the *effective* model cannot honour self-heals it the same way `migrateNodes`
heals an old graph. Teaching three more places about models lost to removing the state they
would have had to reconcile.

### 3. Which image is which comes from canvas position

Top-to-bottom, as everything else in `resolve.js` already is. In first-frame mode the
topmost wired image is the frame; in first-and-last mode the top two are first and last.
Dragging a node above another swaps them, which is the same rule that already decides
prompt order and "image 1".

### 4. Excess inputs stay wired, and their edge turns red

Switching a node with five images to first-frame mode does not disconnect anything. The one
image that will be used keeps a normal edge; the other four get a **red edge**, with a
tooltip naming the reason.

Red belongs on the edge, not the node: an image node can feed several outputs, and being
ignored by one of them says nothing about the others. The edge is exactly the relationship
that is broken.

The badge keeps its existing divergence display — an image used by an image output and
ignored by a video output in frame mode reads `2 / —`.

Wired *videos* are excess in both frame modes, for the same reason and with the same red
edge: frames are images only.

### 5. Handle geometry, kept from the previous design

Handles are 9×9px today (`styles.css:147`) and need precise aiming. WCAG 2.2 SC 2.5.8
(Level AA) asks for 24×24 CSS px, with a spacing exception for smaller targets that stay
24px apart, centre to centre.

- dot: **12px**
- hit box: **24px**, transparent, via `::before` inset −6px

Applies to every handle in the app. With one handle per node there is nothing to label, so
the labels, their hover behaviour and the zoom threshold that governed them are all
dropped — along with the `useStore` zoom subscription they needed.

## Design

### The control

`data.inputMode` on the video output node: `'reference'` (default) | `'first_frame'` |
`'first_last'`. Absent means `'reference'`, so every existing graph keeps its behaviour
without a migration.

Offered only where the model supports it: `first_frame` needs `params.frame_images` to
include `first_frame`, `first_last` needs both. If a saved graph names a mode the current
model does not support, the request falls back to references and the node says so — the
same shape as `supported(values, value)` in `output/core.js`, which already refuses to send
a param the model never declared.

### `resolve.js`

One bucketing function, used by both the request builder and the badge, so they cannot
disagree:

```js
// Sources for one output, split by the role the output's mode gives them.
// { prompt, references, frames: [{ node, frame_type }], excess: [nodeId] }
bucketSources(nodes, edges, outputId)
```

`buildRequest` returns `{ prompt, input_references, frame_images }` — `frame_images` only in
a frame mode, and `input_references` empty there, so the two arrays are never both
populated. Excess sources are **not sent**.

A new `sourceRoles(nodes, edges, nodeId)` returns one role per consuming output for the
badge: a number in reference mode, `first` / `last` in a frame mode, `—` when excess.
`imageRefNumbers` is gone; `sourceRoles` replaces it, reference mode included.

`resolve.js` stays model-agnostic. It reads `data.inputMode` off the output node — already
in `nodes` — and never learns which model is selected; the node passes a flag when the mode
is unsupported.

### Red edges

Derived at render, never stored: `App.jsx` memoises a set of ignored edge ids from
`bucketSources` and maps it onto the edges passed to `<ReactFlow>`. Writing the state onto
the edges themselves would persist a derived, model-dependent flag into `graph.json`, where
it would be wrong the moment the mode or the model changed.

The tooltip needs a custom edge type — React Flow has no native one. A `<title>` inside the
edge's SVG group is enough and costs about ten lines.

### Client → server

`VideoOutputNode` sends `frame_images` in a frame mode and `input_references` otherwise.
`params.frame_images` is **already** plumbed through `server/index.js:307` — no server work
for the capability, only for the payload.

`POST /api/video` forwards `frame_images`, counts it in the `video job →` log line, and
records it in the sidecar alongside `references`.

Both arrays accept `data:` base64 URLs (confirmed in OpenRouter's own skill doc), so image
nodes need no hosting.

## Out of scope

- **Audio references** (10 clips on 2.5, 3 on 2.0). A new `audio` input node — node file,
  add-menu entry, `NEW_NODE` data, size cap, badge counter, `audio_url` in `resolve.js`.
  Separate PR. It is a reference-mode input, so it inherits everything decided here.
- **Enforcing reference caps** (30/10/10, 9/3/3). OpenRouter's catalogue does not expose
  them, and hardcoding ByteDance's numbers would rot silently. Excess *inside* reference
  mode stays unmarked until the catalogue says otherwise.
- **Negative prompts.** No image model in our catalogue declares the parameter.
- **`@ImageN` addressing.** Our prompts say "image 1" as plain text and the model copes.
  Decision 1 is its prerequisite.
- **Portrait-tier / consent-gated real-person routes.** Not exposed through OpenRouter.

## Verification

Pure logic → `resolve.test.js`:

- an unknown `@token` survives literally; a known one still resolves
- `freeRunPrompts` still strips `@t1` with the text node stubbed rather than filtered
- `first_frame` mode: topmost image becomes `frame_images[0]` with `frame_type`, nothing in
  `input_references`, every other source in `excess`
- `first_last` mode: top two images become first and last, in Y order
- a wired video is excess in both frame modes
- reference mode is byte-identical to today's output
- `sourceRoles` and `buildRequest` agree about every source

In the running app, per the rule in `CLAUDE.md`:

- switching modes with five images wired turns four edges red, and the tooltip explains why
- the badge reads `2 / —` for an image used by one output and ignored by another
- a model without frame support hides the selector, and a graph saved in frame mode on that
  model falls back to references with a visible note
- an actual generation in first-frame mode, wired in the canvas, writes a sidecar naming
  `frame_images` — the one paid check, on the cheapest model at 480p/4s

## Documentation to update

| File | What |
| --- | --- |
| `CLAUDE.md:70` | "unknown ids resolve to empty string" → survive literally; the two `TOKEN_RE`s now agree |
| `docs/video-and-sharing.md` | the four task types, the mode selector, why frames and references cannot combine |
| `CHANGELOG.md` | both changes are user-visible |
| `status.md` | close any todo this covers; record audio and cap-enforcement as deliberately deferred |
