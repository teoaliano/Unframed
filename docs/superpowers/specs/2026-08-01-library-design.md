# Library, text output, and multi-run generation

Date: 2026-08-01
Status: approved design, not yet implemented

## Goal

Introduce a **Library** of ready-made presets that can be dropped onto the canvas,
and build the two engine capabilities its first preset needs:

1. A **text output node** — runs a prompt through a text model and keeps the result
   as reusable context.
2. **Multi-run generation** — one output node producing N images, where N is either
   typed by the user or decided by the flow.

The first preset is **Layerize**: given an input image, it plans the image's distinct
parts, then generates each part as its own image so parts can be reworked or recombined.

## Non-goals

- No typed edges or port system. The engine keeps its single rule (below).
- No user-authored library folder. Presets ship with the app.
- No versioned presets, no "update all instances", no origin tracking.
- No video generation yet. The `output` node is named and structured so video becomes a
  format selector inside it rather than a new node type.
- No transparent-PNG layer extraction. See "Layer output contract".

## The one invariant

**Only output nodes consume edges.** Wiring is always "sources → output". This holds
after the change: the text node *is* an output node, one that emits text instead of
an image. Prompt-to-prompt composition still happens through `@id` tokens, not edges.

## A. Node families

Two families. The visual difference is the invariant made visible.

| Family | Nodes | Type id | Label | Handles | Consumes edges |
| --- | --- | --- | --- | --- | --- |
| Input | Prompt | `prompt` | `PROMPT` | source only (right) | never |
| Input | Image | `image` | `IMAGE` | source only (right) | never |
| Output | Output | `output` | `OUTPUT` | target (left) + source (right) | yes |
| Output | Text | `text` | `TEXT` | target (left) + source (right) | yes |

Output nodes are chromed differently from inputs: accent-tinted header rule and the
kind label in accent, against the inputs' quiet grey. `NodeHeader` takes a new
`family` prop (`'input' | 'output'`) which adds `.xnode-head--output`.

The add-node menu splits into two labelled groups: **Inputs** (Prompt, Image) and
**Outputs** (Output, Text).

### Labels match type ids

Every label matches its type id, so nothing needs a translation table and no saved
`graph.json` is invalidated:

- The reference node is relabelled `REFERENCE` → **`IMAGE`**, matching its `image` id.
- The generator node keeps **`OUTPUT`** rather than becoming `IMAGE` — which would
  collide anyway. The generic name is correct because that node is planned to produce
  **image or video**, chosen by a format selector inside the node (see "Future: video").

One consequence: the reference node's header currently reads `REFERENCE` on the left and
`IMAGE 1` on the right, which would become `IMAGE … IMAGE 1`. The right-hand badge
therefore reduces to the ordinal alone — `IMAGE   1`, and `IMAGE   NOT CONNECTED` when
unwired. The `"image 1"` prompt syntax stays discoverable through the help tooltip, which
already explains it.

### Future: video

The `output` node gains a **Format** selector (`image` | `video`) which switches the
model list and the parameter controls, reusing the same node, the same edges, and the same
`buildRequest`. Out of scope here; the naming above is what keeps it from needing a rename
later.

## B. Text output node

### Server: `POST /api/text`

Request `{ prompt, input_references, model }`. Calls OpenRouter
`POST /api/v1/chat/completions` with a single user message whose content is an array:
one `{type:'text'}` part followed by one `{type:'image_url', image_url:{url}}` part per
reference. Passing the images is what makes Layerize possible — the planner has to see
the picture it is describing.

Responds `{ text, cost }`, where `cost` comes from `data.usage.cost` exactly as
`/api/generate` reads it, and `text` from `choices[0].message.content`.

Error branches mirror `/api/generate`: missing key → 400 with the key-dialog message,
unreachable host → 502, upstream error → surfaced verbatim, empty completion → 502
with "the model returned no text".

### Server: `GET /api/models?type=text`

Without the parameter, behaviour is unchanged (the image catalogue via
`?output_modalities=image`). With `type=text`, fetch the default endpoint and return
models whose `architecture.output_modalities` includes `text` **and** whose
`input_modalities` includes `image`.

Vision-only is deliberate: a text node in this app can always have references wired
in, and a text-only model would silently ignore them. ~181 of 336 models qualify, so
the list stays broad.

Default model: `OPENROUTER_TEXT_MODEL` env var, defaulting to
`google/gemini-3.5-flash-lite` (vision, cheap, reliable with format instructions).
Confirm the slug against the live list at implementation time; if it has gone,
`qwen/qwen3.7-flash` is the cheaper fallback.

### Client

`TextNode` mirrors `OutputNode`'s structure:

- Header `TEXT`, output family, with the `@id` badge (click to copy) that prompt nodes have.
- Model selector, fed by `listModels('text')`. The models cache in `api.js` becomes
  keyed by type so the two catalogues don't overwrite each other.
- Optional local textarea, appended as the **last** prompt part after wired-in sources.
- **Run** button; `Running…` while in flight.
- Result rendered as selectable, scrollable text, editable in place, with cost beneath it.

The result lives in `node.data.result`, so it is saved in `graph.json`, survives
reload, and can be hand-edited before use. The node carries `nowheel` (its result box
scrolls).

### Change to `resolve.js`

`@id` currently resolves prompt nodes only. It will also resolve a text node's id to
`data.result`, **inserted literally with no further substitution**. Two reasons:

- Model output must not be re-scanned for `@` tokens (prompt injection, surprise recursion).
- Cycles become self-limiting: a text node referencing a prompt that references it back
  yields a stale string, never an infinite loop.

A text node wired directly into an output contributes `data.result` as an ordinary
prompt part, ordered by Y position like every other source. A text node with no result
yet contributes nothing.

## C. Multi-run generation

### The Runs control

On the `output` node: a number input (default `1`) plus a `Free` toggle. Enabling Free
disables and dims the number input.

Tooltip on Free: *"The number of runs comes from the flow — a connected Text node lists
what to generate, and each item becomes one image."*

**Cap: 10, one rule everywhere.** The number input clamps to 1–10 on blur (a typed `15`
becomes `10`, a typed `0` or empty becomes `1`); Free truncates at 10 and shows
`list had 14 items, running the first 10`.

The Generate button shows the count and estimated spend (`Generate 7 ×  ~$0.37`), using
the per-image price from the model list where available.

### Fixed N

The same resolved prompt, N times, requests concurrent. Each run writes its own file and
`.json` sidecar. Results land as image nodes cascading right of the output node using
the existing placement (40px right, 48px steps down). Reported cost is the sum.

### Free

Requires a text node among the output's sources. Without one, the node shows an inline
warning and Generate is disabled.

Splitting is `splitSections(text)` in `resolve.js`: split on lines that are exactly `---`
(after trimming), trim each block, drop empties.

**LLM repair on fallback.** If `splitSections` returns fewer than 2 blocks, the model
ignored the format. Before generating, one repair call goes to `POST /api/text` with the
raw text and *"Rewrite the following as sections separated by a line containing only ---,
one section per item, no preamble"*, using the text node's own selected model. Then split
again.

- Happy path costs nothing: the Layerize prompt asks for `---`, so a compliant model skips repair.
- The output node shows `re-split into 7 sections` when repair fired, so it is visible, not magic.
- If repair still yields one block, the node runs **once** and warns
  `no sections found — running as a single generation`. It does not refuse: a one-item list
  is legitimate, and the user has already reviewed the text. One unwanted image costs cents,
  whereas a hard block on a valid single item is a dead end.

Each run's prompt is **every other prompt part** (shared context, Y order) **plus that
block**. The planner instruction that produced the list is itself a prompt part on the
*text* node, not the image node, so it never leaks into the generations.

### Progress and partial failure

The node shows `Generating 3 / 7`, and each image appears as it lands rather than all at
the end. A failed run does not abort the batch: the node reports `5 of 7 succeeded` and
lists the errors, keeping the successes. A partial layer set is still useful.

## D. The Library

### Storage

Bundled with the app. `client/src/library/index.js` exports an array; each preset is one
file in that directory:

```js
{
  id: 'layerize',
  name: 'Layerize',
  category: 'flows',            // 'flows' | 'styles' | 'templates'
  summary: 'Split an image into its parts as separate generations',
  needs: 'One image node wired into both the text and output nodes',
  fragment: { nodes: [...], edges: [...] },
}
```

Fragment nodes use local placeholder ids and positions relative to `(0,0)`.

### Insertion

1. Map every fragment node id to a fresh id from the existing `nextId()` counter.
2. Rewrite edge `source`/`target` to the new ids.
3. Rewrite `@oldid` tokens inside prompt text to `@newid`.
4. Offset all positions so the fragment's bounding box centres on the current viewport
   (same `screenToFlowPosition` approach as toolbar adds).
5. `addNodes` + `addEdges`.

### Copy semantics: no link back

Inserted nodes are **plain copies**. Nothing records which preset they came from.
After insertion they are indistinguishable from hand-built nodes.

- Editing an inserted prompt is just editing a prompt.
- A future preset update never rewrites an existing canvas.
- No sync logic, no staleness UI, no risk of clobbering user edits.

Accepted cost: no "update all instances", and no way to query a node's origin. Presets
are starting points meant to be tweaked, and a saved canvas should not mutate underneath
its owner. Revisit only if versioned presets are wanted later.

### UI

A **Library** FAB on the canvas, directly above the `+` button with an 8px gap; the tools
toolbar shifts up to keep its 16px gap from the new button.

It opens a dialog listing presets by category, each row showing name, summary, `needs`,
and an **Add** button. Adding inserts the fragment and closes the dialog. Categories
exist from day one, so a Higgsfield-style look is a one-file `styles` entry containing a
single prompt node — data, not code.

### Layerize preset

Three nodes and two edges, nothing bespoke:

1. **Prompt** (input) — *"Look at image 1. Identify every distinct visual part of it. For
   each part, output one section separated by a line containing only `---`. Each section
   describes that part alone, isolated on a plain neutral background, in the same aspect
   ratio as the source, matching its original style and colours. No preamble, no numbering."*
2. **Text** (output) — the prompt wired in. The user also wires their image node in,
   so the planner can see it.
3. **Output** — `Runs = Free`, with the text node wired in.

Shipped edges: prompt → text, text → output. The user adds two more by hand — their image
node into the text node (so the planner can see the picture) and into the output node (so
each layer matches the source's style). This is what `needs` tells them to do; the preset
cannot pre-wire a node the user has not created yet.

Flow: drop in an image → wire it into both output nodes → Run the text node → read and
optionally edit the plan → Generate. The review step is deliberate; layer plans are worth
reading before spending on them.

### Layer output contract

Each layer is **the isolated part on a plain neutral backdrop**, same aspect ratio as the
source — not a transparent PNG and not an in-place crop. Transparency is honoured by only
some models, and in-place crops drift badly. Reassembly means feeding layers back in as
references for a follow-up generation, or compositing outside the app. Generated layers
arrive as image nodes, so the loop closes without extra work.

## E. Data flow, errors, testing

### Flow

```
reference + prompt ─→ buildRequest ─→ POST /api/text ─→ result on text node
                                                            │
                                        @id or direct edge   ▼
                                              image output ─→ splitSections
                                                            │
                                          N × POST /api/generate
                                                            │
                                   N files + sidecars ─→ N image nodes
```

The loop closes: generated layers are inputs to the next generation.

### Errors

Each failure surfaces where it happened, with the action to take.

| Condition | Behaviour |
| --- | --- |
| No API key | Existing key dialog opens |
| Free with no text node wired | Inline warning, Generate disabled |
| Text node has no result yet | Inline warning, Generate disabled |
| Repair still yields 1 block | Runs once, warns `no sections found — running as a single generation` |
| Some runs fail | `5 of 7 succeeded` plus per-run errors, successes kept |
| Text model returns nothing | 502 surfaced on the text node |

No failure leaves a half-inserted fragment or a partially wired canvas.

### Testing

`resolve.js` stays pure, and gets one runnable assert-based self-check (no framework,
matching the repo):

- `splitSections`: separator handling, surrounding whitespace, empty blocks dropped,
  the single-block result that triggers repair, `---` inside a line of text not treated
  as a separator, and truncation at 10.
- `@id` resolving to a text node's result, literally, with no re-substitution.
- Per-run prompt assembly: shared context included, planner instruction excluded, block appended.
- Fragment insertion: id remapping, edges following, `@id` tokens rewritten inside prompt text.

Network paths are verified in the browser by stubbing `fetch`, as done for the generated-image
placement fix, so implementation costs no generation spend.

## Sequencing

Three sub-projects, each useful alone, built in order. Layerize is the integration test of
all three.

1. **Text output node** — families/chrome, the `REFERENCE` → `IMAGE` relabel, `TextNode`,
   `/api/text`, `?type=text`, `@id` resolution.
2. **Multi-run** — Runs control, `splitSections` + repair, concurrent runs, progress, partial failure.
3. **Library + Layerize** — registry, insertion, FAB and dialog, the Layerize fragment.

## Risks

- **Model compliance with `---`.** Mitigated by the repair call, and by the plan being
  editable before Generate.
- **Spend.** A Free run can cost 10 images. Mitigated by the cap, the count and estimate on
  the button, and the mandatory review step between planning and generating.
- **Default text model churn.** Slugs move; the default is env-overridable and the picker
  lists whatever is live.
