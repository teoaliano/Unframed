# Video Input Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a video output node ask for the Seedance task type the user actually wants — references, first frame, or first and last frame — instead of always sending references.

**Architecture:** One bucketing function in `resolve.js` splits an output's wired sources into references, frames and excess according to the output's `data.inputMode`. The request builder and the input-node badges both read it, so they cannot disagree. Excess sources stay wired and are marked, not sent. A separate one-line fix stops unknown `@tokens` being deleted from prompts.

**Tech Stack:** React 18 + `@xyflow/react` v12, Astryx design system, plain Node for tests (no framework), Express server.

## Global Constraints

- Node 18+. No new dependencies — nothing here needs one.
- `npm test` is `node` running assert files; add cases to `client/src/graph/resolve.test.js`, no framework, no fixtures.
- Node components have no unit tests by design. Verify them in the running app (`npm run dev`) and say so.
- Changes land by PR, never a direct push to `main`.
- Nothing in this repo may reference the private `Unframed-app` repo.
- Colour is never the only channel for a status — see `StatusLine.jsx`'s own comment. Anything marked red also has a text form.
- Spec: `docs/superpowers/specs/2026-08-15-video-input-mode-design.md`.

---

### Task 1: Unknown `@tokens` survive literally

**Files:**
- Modify: `client/src/graph/resolve.js:21-27` (`substitute`), `client/src/graph/resolve.js:126-133` (`freeRunPrompts`)
- Modify: `CLAUDE.md:70`
- Test: `client/src/graph/resolve.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: no signature changes. `buildRequest` and `freeRunPrompts` keep their exact shapes.

- [ ] **Step 1: Write the failing test**

Append to `client/src/graph/resolve.test.js`:

```js
// An @token matching no node id is left exactly as typed. Prompts legitimately
// contain @ ("@golden hour", a handle, an email), and deleting the word after it
// corrupted them silently. insert.js has always behaved this way; now both agree.
{
  const { nodes, edges } = graph(
    [{ id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'a @curly haired fox @p2' } }],
    [{ id: 'e1', source: 'p1', target: 'out' }],
  );
  const { prompt } = buildRequest(nodes, edges, 'out');
  assert.equal(prompt, 'a @curly haired fox @p2', 'unknown tokens are left as typed');
}

// A known id still resolves, and still resolves to empty when it has no text.
{
  const { nodes, edges } = graph(
    [
      { id: 'p2', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'red fox' } },
      { id: 'p1', type: 'prompt', position: { x: 0, y: 10 }, data: { text: 'draw @p2 now' } },
    ],
    [{ id: 'e1', source: 'p1', target: 'out' }],
  );
  const { prompt } = buildRequest(nodes, edges, 'out');
  assert.ok(prompt.includes('draw red fox now'), 'known tokens still resolve');
}
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node client/src/graph/resolve.test.js
```

Expected: `AssertionError … 'a  haired fox ' !== 'a @curly haired fox @p2'`.

- [ ] **Step 3: Change the fallback**

In `client/src/graph/resolve.js`, replace the body of `substitute`:

```js
function substitute(text, refs, stack) {
  return (text || '').replace(TOKEN_RE, (all, raw) => {
    const ref = raw.trim();
    if (refs.has(ref)) return resolveRef(ref, refs, stack);
    return all; // unknown ref -> left as typed, same as insert.js's rewriter
  });
}
```

- [ ] **Step 4: Stop Free mode leaning on the old fallback**

`freeRunPrompts` removed the list-supplying text node from the array so that a
sibling's `@t1` became *unknown* and resolved to empty. With unknown tokens now
preserved, removal would leave a literal `@t1` in every run. Keep the node and blank
its result instead — then `@t1` is a *known* id resolving to empty, which is what was
meant all along. Replace the `buildRequest` call in `freeRunPrompts`:

```js
export function freeRunPrompts(nodes, edges, outputId, textNodeId, blocks) {
  // The list node stays in the graph with an empty result rather than being removed:
  // @its-id must resolve to nothing, and an absent node would now leave the token
  // itself in the prompt. Known-and-empty is the intent; unknown was a side effect.
  const shared = buildRequest(
    nodes.map((n) => (n.id === textNodeId ? { ...n, data: { ...n.data, result: '' } } : n)),
    edges,
    outputId,
  ).prompt;
  return blocks.map((b) => [shared, b].filter(Boolean).join('\n\n'));
}
```

- [ ] **Step 5: Run the whole suite**

```bash
npm test
```

Expected: PASS, including the pre-existing `!p.includes('@t1')` assertion around
`resolve.test.js:298` — it must still hold, unchanged.

- [ ] **Step 6: Update the doc that owns this**

In `CLAUDE.md:70`, replace `unknown ids resolve to empty string` with:

```
unknown ids are left exactly as typed, matching `insert.js`'s rewriter, so a prompt saying "@golden hour" keeps its word
```

- [ ] **Step 7: Commit**

```bash
git add client/src/graph/resolve.js client/src/graph/resolve.test.js CLAUDE.md
git commit -m "Leave unknown @tokens in prompts instead of deleting them

@word that matches no node id had the word removed, so "@golden hour" became
" hour". Free mode was relying on that fallback to blank a reference to the
node it deliberately excludes; it now blanks the node's result instead, which
is what it meant."
```

---

### Task 2: Handles big enough to hit

**Files:**
- Modify: `client/src/styles.css:147-152`

**Interfaces:**
- Consumes: nothing. Produces: nothing. Pure CSS, no JS touches it.

- [ ] **Step 1: Grow the dot and add a hit box**

Replace the `.react-flow__handle` rule in `client/src/styles.css`:

```css
/* 12px dot with a transparent 24px target around it. WCAG 2.2 SC 2.5.8 (AA) asks
   for 24x24 CSS px; the visible dot stays small because a big one crowds the node
   edge, and the pseudo-element does the catching. */
.react-flow__handle {
  width: 12px;
  height: 12px;
  background: var(--color-accent);
  border: 2px solid var(--color-background-surface);
}
.react-flow__handle::before {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 50%;
}
```

- [ ] **Step 2: Verify in the app**

```bash
npm run dev
```

Click 6–10px away from a handle's centre and drag: a connection must start. Confirm
no handle's 24px box overlaps a node control, and that dragging the node body still
works (the box sits on the node's edge, half outside).

- [ ] **Step 3: Commit**

```bash
git add client/src/styles.css
git commit -m "Give handles a 24px hit box

9px dots needed precise aiming. The dot goes to 12px and a transparent
pseudo-element brings the target to the 24px WCAG 2.2 asks for."
```

---

### Task 3: `bucketSources`, and modes in `buildRequest`

**Files:**
- Modify: `client/src/graph/resolve.js:42-78`
- Test: `client/src/graph/resolve.test.js`

**Interfaces:**
- Consumes: `isOutput`, `isTextOutput` from Task 0 state (already exported).
- Produces:
  - `isVideoOutput(n) -> boolean`
  - `bucketSources(nodes, edges, outputId, opts?) -> { sources, references, frames, excess }`
    where `sources` is every wired node in Y order, `references` is media nodes,
    `frames` is `[{ node, frame_type }]` with `frame_type` one of `'first_frame' | 'last_frame'`,
    and `excess` is an array of node ids. `opts.framesUnsupported === true` forces reference mode.
  - `buildRequest(nodes, edges, outputId, opts?) -> { prompt, input_references, frame_images }`
    — `frame_images` is always present, `[]` in reference mode.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/graph/resolve.test.js` (and add `bucketSources` to the import
on line 3):

```js
// ---- input modes ----

// Builds a video output plus a prompt and N images, top to bottom.
function videoGraph(inputMode, imageCount, extra = []) {
  const nodes = [
    { id: 'v1', type: 'videoOutput', position: { x: 400, y: 0 }, data: { inputMode } },
    { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'walk forward' } },
    ...Array.from({ length: imageCount }, (_, i) => ({
      id: `i${i + 1}`,
      type: 'image',
      position: { x: 0, y: 10 * (i + 1) },
      data: { dataUrl: `data:,${i + 1}` },
    })),
    ...extra,
  ];
  const edges = nodes
    .filter((n) => n.id !== 'v1')
    .map((n, i) => ({ id: `e${i}`, source: n.id, target: 'v1' }));
  return { nodes, edges };
}

// Reference mode is exactly today's behaviour: every image rides in input_references.
{
  const { nodes, edges } = videoGraph('reference', 3);
  const { input_references, frame_images } = buildRequest(nodes, edges, 'v1');
  assert.deepEqual(input_references.map((r) => r.image_url.url), ['data:,1', 'data:,2', 'data:,3']);
  assert.deepEqual(frame_images, []);
  assert.deepEqual(bucketSources(nodes, edges, 'v1').excess, []);
}

// An absent inputMode means reference mode, so graphs saved before this shipped
// behave identically.
{
  const { nodes, edges } = videoGraph(undefined, 2);
  const { input_references, frame_images } = buildRequest(nodes, edges, 'v1');
  assert.equal(input_references.length, 2);
  assert.deepEqual(frame_images, []);
}

// first_frame: the topmost image is the frame, the rest are excess, and nothing
// rides in input_references -- the provider drops references when frames are sent.
{
  const { nodes, edges } = videoGraph('first_frame', 3);
  const { input_references, frame_images } = buildRequest(nodes, edges, 'v1');
  assert.deepEqual(input_references, []);
  assert.deepEqual(frame_images, [
    { type: 'image_url', image_url: { url: 'data:,1' }, frame_type: 'first_frame' },
  ]);
  assert.deepEqual(bucketSources(nodes, edges, 'v1').excess, ['i2', 'i3']);
}

// first_last: the top two images become first and last, in Y order.
{
  const { nodes, edges } = videoGraph('first_last', 3);
  const { frame_images } = buildRequest(nodes, edges, 'v1');
  assert.deepEqual(frame_images.map((f) => [f.frame_type, f.image_url.url]), [
    ['first_frame', 'data:,1'],
    ['last_frame', 'data:,2'],
  ]);
  assert.deepEqual(bucketSources(nodes, edges, 'v1').excess, ['i3']);
}

// A wired video is excess in a frame mode: frames are images only.
{
  const clip = { id: 'vid', type: 'video', position: { x: 0, y: 5 }, data: { dataUrl: 'data:,clip' } };
  const { nodes, edges } = videoGraph('first_frame', 1, [clip]);
  const { frame_images, input_references } = buildRequest(nodes, edges, 'v1');
  assert.deepEqual(input_references, []);
  assert.equal(frame_images.length, 1);
  assert.deepEqual(bucketSources(nodes, edges, 'v1').excess, ['vid']);
}

// The model has no frame support: the mode collapses to references rather than
// sending a frame the model never declared.
{
  const { nodes, edges } = videoGraph('first_frame', 2);
  const { input_references, frame_images } = buildRequest(nodes, edges, 'v1', { framesUnsupported: true });
  assert.equal(input_references.length, 2);
  assert.deepEqual(frame_images, []);
}

// Modes are a video-output concern; an image output ignores the field entirely.
{
  const { nodes, edges } = graph(
    [{ id: 'i1', type: 'image', position: { x: 0, y: 10 }, data: { dataUrl: 'data:,a' } }],
    [{ id: 'e1', source: 'i1', target: 'out' }],
  );
  nodes[0].data.inputMode = 'first_frame'; // `out` is an imageOutput
  const { input_references, frame_images } = buildRequest(nodes, edges, 'out');
  assert.equal(input_references.length, 1);
  assert.deepEqual(frame_images, []);
}
```

- [ ] **Step 2: Run to confirm they fail**

```bash
node client/src/graph/resolve.test.js
```

Expected: `SyntaxError`/`TypeError` — `bucketSources` is not exported yet.

- [ ] **Step 3: Add the predicate and the bucketer**

In `client/src/graph/resolve.js`, after `isTextOutput` (line 19):

```js
// Its own predicate for the same reason isTextOutput has one: only a video output
// carries an input mode, and asking the wrong node type for one silently changes
// what gets sent.
export const isVideoOutput = (n) => n?.type === 'videoOutput';

// Seedance takes exactly one task type per request -- references OR frames, never
// both (docs/superpowers/specs/2026-08-15-video-input-mode-design.md). The mode
// names map to the frame slots the request will carry.
const MODE_FRAMES = {
  first_frame: ['first_frame'],
  first_last: ['first_frame', 'last_frame'],
};
```

Then add `bucketSources` as a module-level export, directly above `buildRequest`
(it is not nested inside it — `buildRequest` becomes one of its two callers):

```js
// Every source wired into one output, split by the role its mode gives them.
// The single home for that split: buildRequest sends from it and the input node
// badges read it, so what a node claims and what is sent cannot drift.
// `opts.framesUnsupported` is the node saying "this model declares no frames",
// which collapses any frame mode back to references.
export function bucketSources(nodes, edges, outputId, opts = {}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const output = byId.get(outputId);
  const sources = edges
    .filter((e) => e.target === outputId)
    .map((e) => byId.get(e.source))
    .filter(Boolean)
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0));

  const media = sources.filter(
    (n) => (n.type === 'image' || n.type === 'video') && n.data?.dataUrl,
  );
  const mode =
    isVideoOutput(output) && !opts.framesUnsupported ? output?.data?.inputMode : undefined;
  const wanted = MODE_FRAMES[mode];
  if (!wanted) return { sources, references: media, frames: [], excess: [] };

  // Frames are images only, top to bottom -- the same Y ordering that decides
  // prompt order and "image 1".
  const images = media.filter((n) => n.type === 'image');
  const frames = wanted
    .map((frame_type, i) => (images[i] ? { node: images[i], frame_type } : null))
    .filter(Boolean);
  const used = new Set(frames.map((f) => f.node.id));
  return {
    sources,
    references: [],
    frames,
    excess: media.filter((n) => !used.has(n.id)).map((n) => n.id),
  };
}
```

- [ ] **Step 4: Rewrite `buildRequest` on top of it**

```js
// Build the generation request for a given output node id.
// Returns { prompt, input_references, frame_images }. frame_images is empty unless
// the output is a video node asking for a frame mode.
export function buildRequest(nodes, edges, outputId, opts = {}) {
  const refs = new Map(
    nodes.filter((n) => n.type === 'prompt' || isTextOutput(n)).map((n) => [n.id, n]),
  );
  const { sources, references, frames } = bucketSources(nodes, edges, outputId, opts);

  const input_references = references.map((n) =>
    n.type === 'video'
      ? { type: 'video_url', video_url: { url: n.data.dataUrl } }
      : { type: 'image_url', image_url: { url: n.data.dataUrl } },
  );
  const frame_images = frames.map(({ node, frame_type }) => ({
    type: 'image_url',
    image_url: { url: node.data.dataUrl },
    frame_type,
  }));

  const promptParts = [];
  for (const node of sources) {
    if (node.type !== 'prompt' && !isTextOutput(node)) continue;
    const text = resolveRef(node.id, refs, []).trim();
    if (text) promptParts.push(text);
  }

  return { prompt: promptParts.join('\n\n'), input_references, frame_images };
}
```

- [ ] **Step 5: Run the suite**

```bash
npm test
```

Expected: PASS, including every pre-existing `buildRequest` assertion — reference
mode must be byte-identical to before.

- [ ] **Step 6: Commit**

```bash
git add client/src/graph/resolve.js client/src/graph/resolve.test.js
git commit -m "Split an output's sources by its input mode

Seedance takes one task type per request, so a video node asking for a first
frame must send frame_images and no references at all. bucketSources is the one
place that decides which wired node plays which role."
```

---

### Task 4: Badges say what each consumer will do with the image

**Files:**
- Modify: `client/src/graph/resolve.js` (replace `imageRefNumbers` with `sourceRoles`)
- Modify: `client/src/nodes/ImageNode.jsx:16,35`, `client/src/nodes/VideoNode.jsx:11,26`
- Test: `client/src/graph/resolve.test.js` (port the existing `imageRefNumbers` cases)

**Interfaces:**
- Consumes: `bucketSources` from Task 3.
- Produces: `sourceRoles(nodes, edges, nodeId) -> string[]` — one entry per consuming
  output, in node order, deduplicated, each `'1' | '2' | … | 'first' | 'last' | '—'`.
  `imageRefNumbers` is **deleted**; nothing else calls it.

- [ ] **Step 1: Write the failing tests**

Replace the `---- imageRefNumbers ----` block in `client/src/graph/resolve.test.js`
with the same cases expressed as roles, and add the frame cases:

```js
// ---- sourceRoles ----

// An image wired only into a text node is rank 1 there.
{
  const { nodes, edges } = graph(
    [
      { id: 't1', type: 'textOutput', position: { x: 400, y: 0 }, data: { result: '' } },
      { id: 'i1', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: 'data:,a' } },
    ],
    [{ id: 'e1', source: 'i1', target: 't1' }],
  );
  assert.deepEqual(sourceRoles(nodes, edges, 'i1'), ['1']);
}

// An unwired image, and an image with no picture, have no roles.
{
  const { nodes, edges } = graph(
    [
      { id: 'i1', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: 'data:,a' } },
      { id: 'i2', type: 'image', position: { x: 0, y: 10 }, data: {} },
    ],
    [{ id: 'e1', source: 'i2', target: 'out' }],
  );
  assert.deepEqual(sourceRoles(nodes, edges, 'i1'), []);
  assert.deepEqual(sourceRoles(nodes, edges, 'i2'), []);
}

// Roles are per consumer: used by one output, ignored by a video node in frame
// mode, reads "2 / —".
{
  const nodes = [
    { id: 'out', type: 'imageOutput', position: { x: 400, y: 0 }, data: {} },
    { id: 'v1', type: 'videoOutput', position: { x: 400, y: 200 }, data: { inputMode: 'first_frame' } },
    { id: 'a', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: 'data:,a' } },
    { id: 'b', type: 'image', position: { x: 0, y: 100 }, data: { dataUrl: 'data:,b' } },
  ];
  const edges = [
    { id: 'e1', source: 'a', target: 'out' },
    { id: 'e2', source: 'b', target: 'out' },
    { id: 'e3', source: 'a', target: 'v1' },
    { id: 'e4', source: 'b', target: 'v1' },
  ];
  assert.deepEqual(sourceRoles(nodes, edges, 'a'), ['1', 'first']);
  assert.deepEqual(sourceRoles(nodes, edges, 'b'), ['2', '—']);
}

// first_last names both slots.
{
  const { nodes, edges } = videoGraph('first_last', 2);
  assert.deepEqual(sourceRoles(nodes, edges, 'i1'), ['first']);
  assert.deepEqual(sourceRoles(nodes, edges, 'i2'), ['last']);
}
```

Update the import on line 3: drop `imageRefNumbers`, add `sourceRoles`. These cases
reuse the `videoGraph` helper added in Task 3, so they must sit below it in the file —
it is a plain function declaration, but keeping the reading order honest matters more
than hoisting does.

- [ ] **Step 2: Run to confirm they fail**

```bash
node client/src/graph/resolve.test.js
```

Expected: `sourceRoles is not a function`.

- [ ] **Step 3: Replace `imageRefNumbers` with `sourceRoles`**

Delete `imageRefNumbers` entirely and put this in its place:

```js
// What each consuming output will do with this image or video, one entry per
// consumer, deduplicated. A number is its position in that output's references
// ("image 2"); `first`/`last` is a frame slot; `—` means the output's mode has no
// room for it and it will not be sent. Per consumer because an image can be image 2
// to one node and the first frame of another. Kept beside bucketSources so the
// badge and the request cannot disagree. `nodes`/`edges` are the live arrays.
export function sourceRoles(nodes, edges, nodeId) {
  const self = nodes.find((n) => n.id === nodeId);
  if (!self || (self.type !== 'image' && self.type !== 'video') || !self.data?.dataUrl) return [];

  const roles = [];
  for (const consumer of nodes.filter(isOutput)) {
    const { references, frames, excess } = bucketSources(nodes, edges, consumer.id);
    const frame = frames.find((f) => f.node.id === nodeId);
    if (frame) {
      roles.push(frame.frame_type === 'first_frame' ? 'first' : 'last');
      continue;
    }
    if (excess.includes(nodeId)) {
      roles.push('—');
      continue;
    }
    // Numbering is per kind: "image 1" and "video 1" coexist on one consumer.
    const sameKind = references.filter((n) => n.type === self.type);
    const idx = sameKind.findIndex((n) => n.id === nodeId);
    if (idx !== -1) roles.push(String(idx + 1));
  }
  return [...new Set(roles)];
}
```

- [ ] **Step 4: Point the two input nodes at it**

`client/src/nodes/ImageNode.jsx` — line 9 import and line 16:

```js
import { sourceRoles } from '../graph/resolve.js';
```

```js
  // What each consuming node will do with this image, recomputed as connections,
  // positions and input modes change. "2 / —" = image 2 to one output, unused by
  // another. Empty = not wired anywhere.
  const roles = sourceRoles(useNodes(), useEdges(), id);
```

and line 35:

```js
  const status = roles.length ? roles.join(' / ') : data.dataUrl ? 'not connected' : undefined;
```

`client/src/nodes/VideoNode.jsx` — the same, dropping the `'video'` argument since
`sourceRoles` reads the kind off the node:

```js
import { sourceRoles } from '../graph/resolve.js';
```

```js
  const roles = sourceRoles(useNodes(), useEdges(), id);
```

Then replace `nums` with `roles` wherever it is used in that file.

- [ ] **Step 5: Run the suite, then the app**

```bash
npm test && npm run dev
```

In the browser: wire two images into an image output, confirm the badges read `1`
and `2`. Add a video output, wire both images in, leave it on References — badges
read `1 / 1` and `2 / 2`.

- [ ] **Step 6: Commit**

```bash
git add client/src/graph/resolve.js client/src/graph/resolve.test.js client/src/nodes/ImageNode.jsx client/src/nodes/VideoNode.jsx
git commit -m "Badges name the role each consumer gives an image

imageRefNumbers only knew how to count, so an image serving as a first frame had
nothing to show. sourceRoles replaces it and reads the same bucketing the request
is built from."
```

---

### Task 5: The Input selector

**Files:**
- Modify: `client/src/nodes/VideoOutputNode.jsx:36-56` (derivation), `:176-202` (controls), `:219-266` (warnings)

**Interfaces:**
- Consumes: `entry.params.frame_images` (already served by `server/index.js:307`).
- Produces: `data.inputMode` on video output nodes — `'reference' | 'first_frame' | 'first_last'`,
  absent meaning `'reference'`.

**Model coverage.** The menu is built from `supported_frame_images` alone, so every
model on the video catalogue gets the same treatment without model-specific code.
Surveyed 2026-08-15 across all 23:

| Declares | Count | Menu |
| --- | --- | --- |
| `first_frame` + `last_frame` | 14 — every seedance, `google/veo-3.1{,-fast,-lite}`, `kwaivgi/kling-*`, `alibaba/wan-2.7`, `black-forest-labs/flux-3-video`, `minimax/hailuo-3` | three options |
| `first_frame` only | 7 — `alibaba/happyhorse-1.{0,1}`, `alibaba/wan-2.6`, `minimax/hailuo-2.3`, `runway/gen-4.5`, `x-ai/grok-imagine-video{,-1.5}` | two options |
| neither | 2 — `openai/sora-2-pro`, `runway/aleph-2` | no selector |

Nothing in the catalogue describes reference support — the union of its fields is
durations, resolutions, ratios, sizes, frame images, audio, seed, pricing and
passthrough params. Frames are declared fact; references remain an assumption, which
is why `acceptsVideo` is derived from a separate endpoint (`server/index.js:211`).

A model declaring `last_frame` *without* `first_frame` would get References only.
None exists today, and inventing a "Last frame" option for a hypothetical model is
not worth the branch.

- [ ] **Step 1: Derive the available modes**

In `client/src/nodes/VideoOutputNode.jsx`, after the `params` destructure (line 41):

```js
  // Seedance exposes four task types and OpenRouter surfaces the frame ones through
  // supported_frame_images. Offer only what this model declares -- the same rule as
  // every other control here -- and never a selector with one option.
  const frameTypes = entry?.params?.frame_images || null;
  const inputModes = [
    { value: 'reference', label: 'References' },
    ...(frameTypes?.includes('first_frame') ? [{ value: 'first_frame', label: 'First frame' }] : []),
    ...(frameTypes?.includes('first_frame') && frameTypes?.includes('last_frame')
      ? [{ value: 'first_last', label: 'First and last frame' }]
      : []),
  ];
  const inputMode = inputModes.some((o) => o.value === data.inputMode)
    ? data.inputMode
    : 'reference';
  // A graph saved in a frame mode, reopened on a model without frames. The request
  // falls back rather than sending a param the model never declared.
  const modeUnsupported = Boolean(data.inputMode) && data.inputMode !== inputMode;
```

- [ ] **Step 2: Render it beside Seconds**

Replace the `{(durations || canAudio) && (` block's opening so the selector shares
that row, inserting before the `durations` selector:

```jsx
            {inputModes.length > 1 && (
              <Selector
                label="Input"
                size="sm"
                options={inputModes}
                value={inputMode}
                onChange={(v) => updateNodeData(id, { inputMode: v })}
              />
            )}
```

and change the row's guard to `{(inputModes.length > 1 || durations || canAudio) && (`.

- [ ] **Step 3: Warn where the mode cannot be honoured**

Add beside the existing warnings (after the `wiredVideoIntoVideo` block):

```jsx
        {modeUnsupported && (
          <StatusLine type="warning">
            This graph asks for a frame image, which {model} does not accept. The wired
            images are being sent as references instead.
          </StatusLine>
        )}
```

- [ ] **Step 4: Pass the fallback through to the request**

In `onGenerate`, replace the `buildRequest` call:

```js
      const { prompt, input_references, frame_images } = buildRequest(getNodes(), getEdges(), id, {
        framesUnsupported: modeUnsupported,
      });
```

- [ ] **Step 5: Verify in the app**

```bash
npm run dev
```

Three cases, one per row of the coverage table:

- `bytedance/seedance-2.0` — the selector offers all three options.
- `x-ai/grok-imagine-video` — two options, no "First and last frame".
- `openai/sora-2-pro` — no selector at all.

Then set First frame on seedance, switch the model to `openai/sora-2-pro`, and confirm
the fallback warning appears rather than a stale mode being sent.

- [ ] **Step 6: Commit**

```bash
git add client/src/nodes/VideoOutputNode.jsx
git commit -m "Choose the video input mode on the node

References, first frame, or first and last -- gated by what the model declares in
supported_frame_images, and absent when it declares none."
```

---

### Task 6: Send `frame_images`

**Files:**
- Modify: `client/src/nodes/VideoOutputNode.jsx` (`onGenerate` payload)
- Modify: `server/index.js:522-531` (destructure), `:596` (payload), `:243-251` (`countRefs`), `:602-605` (log)

**Interfaces:**
- Consumes: `frame_images` from `buildRequest` (Task 3).
- Produces: `POST /api/video` accepts `frame_images: [{ type, image_url: { url }, frame_type }]`
  and forwards it verbatim. Sidecar `references` gains `frames: <count>`.

- [ ] **Step 1: Send it from the node**

In `onGenerate`'s `generateVideo` call, after `input_references`:

```js
          // Only ever one of the two: the provider treats a request with frames as
          // image-to-video and discards references entirely.
          ...(frame_images.length ? { frame_images } : {}),
```

- [ ] **Step 2: Accept and forward it**

In `server/index.js`, add `frame_images = []` to the `req.body` destructure, and
beside the `input_references` line in the payload block:

```js
  if (frame_images.length) payload.frame_images = frame_images;
```

- [ ] **Step 3: Count it in the log and the sidecar**

Extend `countRefs` (line ~245) to take the frames array:

```js
// What actually went out, by kind, so "was the image sent as a frame?" is answerable
// after the fact from our side.
function countRefs(list, frames = []) {
  const refs = Array.isArray(list) ? list : [];
  return {
    images: refs.filter((r) => r?.image_url?.url).length,
    videos: refs.filter((r) => r?.video_url?.url).length,
    frames: (Array.isArray(frames) ? frames : []).length,
  };
}
```

and the call site plus log line:

```js
  const sentRefs = countRefs(input_references, frame_images);
  console.log(
    `  video job →  ${payload.model}  (sent ${sentRefs.images} image, ${sentRefs.videos} video refs, ${sentRefs.frames} frames)`,
  );
```

Check the other `countRefs` call in the `/api/text` route still passes — it takes one
argument and `frames` defaults to `[]`.

- [ ] **Step 4: Verify end to end in the app**

```bash
npm run dev
```

Wire a prompt and two images into a video node on `bytedance/seedance-2.0`, set Input
to *First and last frame*, click Generate. The server log must read
`(sent 0 image, 0 video refs, 2 frames)`. **This spends money** — use 480p and the
shortest duration. When it completes, open the `.json` sidecar next to the clip and
confirm `references.frames` is 2.

- [ ] **Step 5: Commit**

```bash
git add client/src/nodes/VideoOutputNode.jsx server/index.js
git commit -m "Forward frame_images to OpenRouter

The capability was already served to the client; this is the payload, the log
line and the sidecar field that record which slot each image went into."
```

---

### Task 7: Ignored inputs read as ignored

**Files:**
- Create: `client/src/nodes/IgnoredEdge.jsx`
- Modify: `client/src/App.jsx` (edge derivation, `edgeTypes`), `client/src/styles.css`
- Modify: `client/src/nodes/VideoOutputNode.jsx` (count line)

**Interfaces:**
- Consumes: `bucketSources` (Task 3).
- Produces: nothing other tasks depend on. `edgeTypes = { ignored: IgnoredEdge }`.

- [ ] **Step 1: The edge component**

Create `client/src/nodes/IgnoredEdge.jsx`:

```jsx
import { BaseEdge, getBezierPath } from '@xyflow/react';

// An edge whose source the target will not send. Red, still, and titled: colour is
// never the only channel here (see StatusLine), so the badge reads "—", the node
// carries a count, and this carries a sentence on hover. BaseEdge's default
// interactionWidth gives the invisible 20px band that makes hovering a 1.5px line
// possible at all.
export default function IgnoredEdge({
  sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd,
}) {
  const [path] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });
  return (
    <g className="xedge-ignored">
      <BaseEdge path={path} markerEnd={markerEnd} />
      <title>
        Not sent: this output&apos;s input mode has no slot for it. Switch the mode to
        References, or unwire it.
      </title>
    </g>
  );
}
```

- [ ] **Step 2: Derive which edges those are**

`client/src/App.jsx` imports neither `useMemo` nor anything from `resolve.js` today.
Add `useMemo` to the React import on line 1, then:

```js
import { bucketSources, isOutput } from './graph/resolve.js';
import IgnoredEdge from './nodes/IgnoredEdge.jsx';
```

Then above the `<ReactFlow>` element:

```js
  // Derived at render, never stored: which edges are ignored depends on the target's
  // mode AND the selected model, so writing it onto the edges would persist a fact
  // that goes stale the moment either changes -- into graph.json, where it would be
  // read back as truth.
  const displayEdges = useMemo(() => {
    const ignored = new Set();
    for (const node of nodes) {
      if (!isOutput(node)) continue;
      const { excess } = bucketSources(nodes, edges, node.id);
      if (!excess.length) continue;
      for (const e of edges) {
        if (e.target === node.id && excess.includes(e.source)) ignored.add(e.id);
      }
    }
    return ignored.size ? edges.map((e) => (ignored.has(e.id) ? { ...e, type: 'ignored' } : e)) : edges;
  }, [nodes, edges]);
```

Add the module-level map beside `nodeTypes`:

```js
const edgeTypes = { ignored: IgnoredEdge };
```

and on `<ReactFlow>`: `edges={displayEdges}` plus `edgeTypes={edgeTypes}`.

- [ ] **Step 3: Style it**

Append to `client/src/styles.css`:

```css
/* Ignored edges stop moving as well as turning red -- two channels, because red
   alone is the one signal colour-blind users do not get. */
.xedge-ignored .react-flow__edge-path {
  stroke: var(--color-error);
  stroke-dasharray: 2 4;
  animation: none;
}
```

- [ ] **Step 4: Say it in words on the node**

In `VideoOutputNode.jsx`, beside the other warnings:

```jsx
        {ignoredCount > 0 && (
          <StatusLine type="warning">
            {ignoredCount === 1 ? 'One input is' : `${ignoredCount} inputs are`} not used by
            this mode and will not be sent. Their connections are marked red.
          </StatusLine>
        )}
```

with, beside the other derivations:

```js
  const ignoredCount = bucketSources(liveNodes, liveEdges, id).excess.length;
```

- [ ] **Step 5: Verify in the app**

```bash
npm run dev
```

Wire five images into a video node, switch Input to *First frame*: four edges turn
red and stop animating, the node reads "4 inputs are not used…", hovering a red edge
shows the sentence, and the four badges read `—`. Switch back to References: every
edge returns to normal. Reload the page and confirm `graph.json` gained no new fields
(`git diff` on the project folder, or check the file's `edges` array).

- [ ] **Step 6: Commit**

```bash
git add client/src/nodes/IgnoredEdge.jsx client/src/App.jsx client/src/styles.css client/src/nodes/VideoOutputNode.jsx
git commit -m "Mark inputs the chosen mode will not send

Red, still, titled on hover, counted on the node and shown as — on the badge.
Derived at render so no model-dependent state reaches graph.json."
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/video-and-sharing.md`, `CHANGELOG.md`, `status.md`

**Interfaces:**
- Consumes: everything above. Produces: nothing.

- [ ] **Step 1: Document the modes where video is owned**

Add to `docs/video-and-sharing.md`:

```markdown
## Input modes

Seedance offers four task types and a request is exactly one of them: omni
reference-to-video, image-to-video from a first frame, image-to-video from first and
last frames, or text-to-video. There is no mode that takes frames *and* references —
send both and the references are discarded, which is ByteDance's design rather than
OpenRouter's. Verified against the live API; the evidence is in
`docs/superpowers/specs/2026-08-15-video-input-mode-design.md`.

The video output node's **Input** selector picks the type. Options appear only where
the model declares them in `supported_frame_images`, so a model without frame support
shows no selector at all. Absent on a saved graph means References, which is what
every graph did before the selector existed.

Which image is which comes from canvas position, top to bottom — the same rule that
orders prompts and numbers references. In first-frame mode the topmost wired image is
the frame; in first-and-last mode the top two are first and last.

Anything the mode has no room for keeps its connection and is marked instead of
dropped: the edge turns red and stops animating, its tooltip says why, the input
node's badge reads `—`, and the video node counts them. Nothing marked is sent.
```

- [ ] **Step 2: Changelog**

Add a dated entry under today's date:

```markdown
## 2026-08-15

### Added

- Video nodes choose how wired images are used: as references, as a first frame, or
  as first and last frames. Models that do not accept frames do not offer the choice.
- Inputs a mode has no room for keep their connection, marked red, and their badge
  reads `—`.

### Fixed

- An `@word` in a prompt that matches no node id is left as typed. It used to be
  deleted, so "@golden hour" became " hour".
```

- [ ] **Step 3: Close the loop in `status.md`**

Delete any todo this covers. Under "Decided not to build", record: enforcing the
per-model reference caps (OpenRouter's catalogue does not expose them, and hardcoding
ByteDance's numbers would rot silently), and the audio input node (deferred to its own
PR, not abandoned).

- [ ] **Step 4: Commit and open the PR**

```bash
git add docs/video-and-sharing.md CHANGELOG.md status.md
git commit -m "Document video input modes"
git push -u origin typed-input-handles
gh pr create --title "Video input modes, and literal unknown @tokens" --body "$(cat <<'EOF'
A video node now chooses what wired images are for: references, a first frame, or
first and last frames. Seedance takes exactly one task type per request — a request
carrying frames has its references discarded, which is the provider's design, not
OpenRouter's. Probed against the live API; evidence in the spec.

Inputs the chosen mode cannot use stay wired, their edge turns red and still, their
badge reads —, and the node counts them.

Also fixes an unrelated defect in the same file: an @word matching no node id was
deleted from the prompt, so "@golden hour" became " hour".

Spec: docs/superpowers/specs/2026-08-15-video-input-mode-design.md
Plan: docs/superpowers/plans/2026-08-15-video-input-mode.md
EOF
)"
```

---

## Notes for the implementer

- **`status.md` is gitignored.** `git add status.md` will refuse; edit it anyway, it
  just is not committed.
- **The branch is named `typed-input-handles`** after the design this replaced. Not
  worth renaming mid-flight; the PR title carries the real name.
- **Known gap, deliberate:** `sourceRoles` calls `bucketSources` without the
  `framesUnsupported` flag, because a badge has no idea which model is selected. On a
  graph saved in a frame mode and reopened on a model without frames, badges say
  `first` while the request falls back to references. The node's warning covers it;
  threading model state into every input node's badge would cost more than the case is
  worth.

---

### Task 9: Switching model resets that node to the model's defaults

**Why this exists:** added after the final review. The branch's marks (red edges, ignored
count, badges) are derived without model knowledge, while the request falls back via
`framesUnsupported` — so a graph saved in a frame mode and reopened on a model without
frames showed two contradictory warnings. Rather than teach the marks about models, make
the bad state unreachable: a model switch resets that node's model-dependent params to
what a fresh node with that model would have. The fallback then has nothing to fall back
from, and three pieces of code delete themselves.

The rule is general — it applies to image outputs too, not just video.

**Files:**
- Modify: `client/src/nodes/output/core.js` (new exports)
- Modify: `client/src/App.jsx` (`NEW_NODE` reads the shared defaults)
- Modify: `client/src/nodes/ImageOutputNode.jsx`, `client/src/nodes/VideoOutputNode.jsx`, `client/src/nodes/TextOutputNode.jsx` (the `ModelPicker` `onChange`)
- Modify: `client/src/graph/resolve.js`, `client/src/graph/resolve.test.js` (retire `framesUnsupported`)
- Modify: `CHANGELOG.md`, `docs/superpowers/specs/2026-08-15-video-input-mode-design.md`

**Interfaces produced:**
- `OUTPUT_DEFAULTS` — `{ imageOutput, videoOutput, textOutput }`, the starting data per output type.
- `MODEL_PARAM_KEYS` — `{ imageOutput: [...], videoOutput: [...], textOutput: [] }`.
- `resetModelParams(type)` — every key in `MODEL_PARAM_KEYS[type]` set to `undefined`, then `OUTPUT_DEFAULTS[type]` spread over it. Merge it into the same `updateNodeData` call that writes the new model id.

- [ ] **Step 1: One home for the defaults and the key list**

In `client/src/nodes/output/core.js`:

```js
// The data a freshly added output node starts with. Lives here rather than in App.jsx
// because switching a node's model resets it to exactly this -- two homes for one list
// is how the reset silently stops covering a control somebody added later.
export const OUTPUT_DEFAULTS = {
  imageOutput: { resolution: '1K', quality: 'low', aspect_ratio: '1:1' },
  videoOutput: {},
  textOutput: { text: '', result: '' },
};

// Every data key a model's capabilities decide. Add to this when you add a control, or
// the old model's value survives the switch and gets filtered out at send time instead --
// which reads as "the app forgot my setting" rather than "that model cannot do this".
// NOT here on purpose: runs/freeRuns (a batch size, not a model trait), shareLocalVideos
// (consent about a wired clip), text/result/model itself.
export const MODEL_PARAM_KEYS = {
  imageOutput: ['quality', 'background', 'resolution', 'aspect_ratio', 'size'],
  videoOutput: ['size', 'resolution', 'aspect_ratio', 'duration', 'generateAudio', 'inputMode'],
  textOutput: [],
};

// What to merge alongside a new model id: clear every model-dependent key, then lay this
// type's fresh-node defaults back over the top, so switching lands exactly where adding a
// new node with that model would. An undefined value drops out of graph.json entirely.
export function resetModelParams(type) {
  const cleared = Object.fromEntries((MODEL_PARAM_KEYS[type] || []).map((k) => [k, undefined]));
  return { ...cleared, ...(OUTPUT_DEFAULTS[type] || {}) };
}
```

- [ ] **Step 2: `App.jsx` stops owning the seeds**

Import `OUTPUT_DEFAULTS` from `./nodes/output/core.js` and replace the three output rows of
`NEW_NODE` with references to it, leaving the `prompt`/`image`/`video` rows alone:

```js
  const NEW_NODE = {
    prompt: { text: '' },
    image: { fileName: '', dataUrl: '' },
    video: { fileName: '', dataUrl: '' },
    imageOutput: OUTPUT_DEFAULTS.imageOutput,
    videoOutput: OUTPUT_DEFAULTS.videoOutput,
    textOutput: OUTPUT_DEFAULTS.textOutput,
  };
```

- [ ] **Step 3: The three call sites**

`ImageOutputNode.jsx`: `onChange={(v) => updateNodeData(id, { model: v, ...resetModelParams('imageOutput') })}`
`VideoOutputNode.jsx`: `onChange={(v) => updateNodeData(id, { videoModel: v, ...resetModelParams('videoOutput') })}`
`TextOutputNode.jsx`: `onChange={(v) => updateNodeData(id, { model: v, ...resetModelParams('textOutput') })}`

Text outputs have no model-dependent params; the call is there so the next control added to
that node is covered by the same rule instead of being the exception nobody remembers.

- [ ] **Step 4: Self-heal a mode the effective model cannot honour**

A node with no stored model follows the global default, so changing that default in Settings
changes the node's model with no switch event. Heal it the way `migrateNodes` heals old
graphs — on open, letting the next autosave write the correction back. In `VideoOutputNode`:

```js
  // A node with no stored model follows the global default, so Settings can change its
  // model without a switch. Clearing an inputMode the model cannot honour keeps the badge,
  // the red edges and the request from ever disagreeing -- same self-healing shape as
  // migrateNodes. Guarded on the catalogue: while it loads, entry is undefined and every
  // mode would look unsupported, which would wipe a perfectly good setting.
  useEffect(() => {
    if (!models.length || !entry) return;
    if (data.inputMode && !inputModes.some((o) => o.value === data.inputMode)) {
      updateNodeData(id, { inputMode: undefined });
    }
  }, [models.length, entry, data.inputMode, inputModes, id, updateNodeData]);
```

- [ ] **Step 5: Retire the fallback**

With Steps 3 and 4 in place, `data.inputMode` can no longer disagree with the model, so
delete: `modeUnsupported` and its `StatusLine` from `VideoOutputNode`, the
`{ framesUnsupported: modeUnsupported }` argument, and `opts.framesUnsupported` from
`bucketSources` in `resolve.js` (the `opts` parameter goes with it if nothing else uses it).
Delete the now-unreachable `resolve.test.js` block whose comment begins "The model has no
frame support".

- [ ] **Step 6: `npm test`, then CHANGELOG and spec**

CHANGELOG, under today's `### Changed`: switching a model now resets that node's
model-specific settings to that model's defaults, so a setting the new model cannot honour
is never silently carried over.

In the spec, amend decision 2 to record that the `framesUnsupported` fallback was removed
in favour of the reset, and why: making the state unreachable beat teaching three more
places about models.

- [ ] **Step 7: Commit**

```bash
git add client/src/nodes/output/core.js client/src/App.jsx client/src/nodes/ImageOutputNode.jsx client/src/nodes/VideoOutputNode.jsx client/src/nodes/TextOutputNode.jsx client/src/graph/resolve.js client/src/graph/resolve.test.js CHANGELOG.md docs/superpowers/specs/2026-08-15-video-input-mode-design.md
git commit -m "Reset a node's model settings when its model changes"
```

---

### Task 10: A video job survives the browser

**Why this exists:** found in testing. `generateVideo` keeps the job id in a local
variable and polls for 15 minutes; on timeout it throws "It may still finish on
OpenRouter". The id is in no file, so nothing can ever collect that job — a reload, a
crash, a close, or a slow provider queue all lose a paid render permanently. A real run
sat queued for 40+ minutes, and its id was only recoverable from the browser's network
log. OpenRouter does not document how long a finished video stays fetchable, so the
window to collect is unknown and possibly short.

**Files:** `client/src/api.js`, `client/src/nodes/VideoOutputNode.jsx`, `CHANGELOG.md`

**Interfaces produced:**
- `startVideo(body) -> { id }` — POSTs `/api/video`, returns the job id, polls nothing.
- `pollVideo(id, params, onStatus, { until }) -> result | { pending: true }` — polls
  `/api/video/:id`; resolves with the completed result, or `{ pending: true }` when it
  stops early. Throws only on a real failure. `params` is what the server needs to name
  the file: `{ project, prompt, model, duration, resolution, size }`.
- `data.job = { id, startedAt, params }` on the video output node — cleared on completion
  or failure, and on nothing else.

- [ ] **Step 1: Split start from poll in `client/src/api.js`**

`generateVideo` currently does both and owns the timeout. Replace it with the two
functions above, keeping the existing query-string construction (it moves into
`pollVideo`, whose `params` argument is that same object). `pollVideo` polls every 4s as
today; `until` is a wall-clock budget after which it returns `{ pending: true }` rather
than throwing. Delete the "Gave up waiting" error entirely — nothing may throw away an id.

- [ ] **Step 2: Persist the job before polling**

In `onGenerate`: call `startVideo`, then `updateNodeData(id, { job: { id: resp.id, startedAt: Date.now(), params } })`
BEFORE the first poll, so the id reaches `graph.json` even if the tab dies mid-render.
Then `pollVideo`. On a completed result: set the result and clear the job in one update.
On a thrown failure: clear the job and show the error.

- [ ] **Step 3: Resume on mount**

An effect that runs once per mount: if `data.job?.id` and there is no result, resume
`pollVideo` with the stored `params`. This is the whole point of the task — reopening the
project must pick the job back up with no user action.

- [ ] **Step 4: A pending job is visible and escapable**

While `data.job` exists: the Generate button reads `Rendering… (N min)` from
`startedAt` and is disabled, so a second click cannot start a second paid render. Beside
it, two ghost actions: **Check now** (one immediate poll) and **Forget this job** (clears
`data.job` only — it does not cancel anything upstream, and the copy must say so, since a
node stuck on a job that will never finish is otherwise unusable).

- [ ] **Step 5: `npm test`, then CHANGELOG**

Under today's `### Fixed`: a video that takes longer than the app was willing to wait is
no longer lost — the node remembers its job and picks it up when you come back.

---

### Task 11: The server finishes jobs the browser is not watching

**Why this exists:** Task 10 recovers a job when you reopen the project. It cannot
collect one while the app is closed, and the collect window is undocumented. This makes
the server the owner: pending jobs are written to disk, swept on an interval, and
downloaded whether or not a browser is connected.

**Files:** `server/jobs.js` (new), `server/jobs.test.js` (new), `server/index.js`,
`CLAUDE.md`, `docs/video-and-sharing.md`

**Interfaces produced (mirroring `env.js`/`presets.js`: pure logic here, I/O thin):**
- `readJobs(dir) -> job[]` / `writeJobs(dir, jobs)` — `<OUTPUT_DIR>/jobs.json`.
- `upsertJob(jobs, job) -> job[]`, `pruneJobs(jobs, now) -> job[]` — pure, tested.
  A job is `{ id, project, params, startedAt, status, savedPath?, error?, refs? }`.
- `sweepJobs()` in `index.js` — every 30s, poll each `pending` job through the same code
  path `/api/video/:id` uses, write the file, record `savedPath`.

- [ ] **Step 1: The store, with tests first**

`jobs.js` holds the pure functions; `jobs.test.js` pins them in the house style (bare
assert blocks, no framework). Cases: an upsert replaces by id rather than appending a
duplicate; pruning drops completed jobs older than seven days and keeps pending ones
regardless of age; a corrupt or absent `jobs.json` reads as `[]` rather than throwing —
a broken file must not stop the server booting.

- [ ] **Step 2: Record the job at creation**

`POST /api/video` writes the job to the store as `pending` with everything the poll
handler needs, including the `refs` counts that `videoJobRefs` holds in memory today.
That map becomes a cache in front of the store, not the only copy — a restart currently
loses the sidecar's `references` field.

- [ ] **Step 3: Sweep**

On boot and every 30s: for each `pending` job, poll upstream; on `completed` download and
write exactly as the route does, then mark it `done` with `savedPath`; on `failed` mark it
`failed` with the message. Extract the download-and-write half of `/api/video/:id` into a
function both paths call, so there is one implementation of "a finished job becomes files
on disk".

- [ ] **Step 4: Make double collection impossible**

`GET /api/video/:id` consults the store first: a job already `done` returns its
`savedPath` immediately instead of downloading again. Without this, Task 10's resume and
this sweep both download the same clip and write two files with different timestamps.

- [ ] **Step 5: `npm test`, docs**

`CLAUDE.md`'s server bullet gains one line: pending video jobs are durable and swept, so a
render outlives the browser. `docs/video-and-sharing.md` gets the user-facing version.

---

### Task 12: A node's local state must not outlive the project it belongs to

**Why this exists:** raised by Task 10's implementer and confirmed in review. `status`,
`error` and `result` are `useState` inside the output nodes — per component INSTANCE.
React Flow keys node components by node id (`jsx(NodeWrapper, {…}, nodeId)`), and node ids
come from one counter shared by every project (`App.jsx`'s `bumpCounter`), so two projects
each having a `videoOutput` with id `"103"` is the normal case rather than a coincidence.
`switchProject` only calls `setNodes` — nothing unmounts — so that component instance
survives the switch carrying the previous project's state.

Concrete: start a render in project A, switch to project B whose node happens to share the
id. B's node shows "Rendering…" for a job that is not its own, or a stale error, or a clip
preview from A. Nothing is lost — `data.job` is per project and correct, and Task 10's
identity guard stops an abandoned loop writing to the wrong node — but the node lies about
what it is doing.

**Files:** `client/src/App.jsx`, and whatever the verification turns up.

- [ ] **Step 1: Remount the canvas when the project changes**

The narrow fix (clearing state in an effect keyed on project) has to be repeated in every
node type that holds local state, and silently stops covering the next one somebody adds.
Remounting the canvas covers all of them at once and cannot rot:

```jsx
        <ReactFlow
          // Keyed by project so a switch remounts every node component. Node ids come
          // from one counter shared across projects, and React Flow keys node components
          // by id, so without this the SAME component instance is reused for a different
          // project's node — carrying status, error and the last clip with it.
          key={project}
```

Check what a remount costs before committing to it: viewport and selection reset, and
`fitView` runs again. Confirm that reads as correct on a switch rather than as a jolt — if
it does not, say so in your report rather than working around it silently.

- [ ] **Step 2: Confirm an abandoned poll cannot write to the new project's node**

A loop belonging to project A's job keeps running after the remount. It must not touch
project B's node of the same id. `runJob`'s `stillOurs()` compares `getNode(id)?.data?.job?.id`
against the id the loop started with, so B's node — different job id, or none — fails the
check. Read that path and confirm it in the report; do not assume it.

- [ ] **Step 3: Verify in the running app (controller does this)**

Switch between two projects that both have a video output node, one with a pending job,
and confirm each node shows its own state. The controller has a real pending job available
for this.

- [ ] **Step 4: `npm test`, then commit**

Not in scope, deliberately: persisting `result` into node data so a completed clip survives
a reload. That is a real gap (a finished node shows empty after F5, though the file is safely
on disk) but it is a different change with its own storage question, and folding it in here
would hide it.

---

### Task 13: A finished result must survive leaving the node

**Why this exists:** found by the user testing Task 12. They generated an image in a
project, switched away, came back — and the node looked untouched. The image was on disk
with its sidecar; the node simply had no memory of it. `ImageOutputNode` keeps `results`
in `useState`, and Task 12's `key={canvasGeneration}` now remounts every node on a genuine
project switch, so that state is discarded. Before Task 12 the instance survived and the
results appeared to persist — while actually being displayed on whatever project's node
reused the instance, which is the bug Task 12 fixed. The same applies to a reload, and to
`VideoOutputNode.result`.

Nothing is lost — the files and their sidecars are written server-side — but the app
forgets work the user paid for, which reads as losing it.

**The constraint that shapes the fix:** the result must NOT be persisted as base64. A
1.4MB png inlined into `graph.json` would be rewritten on every keystroke — the exact
reason the video node plays from disk (`CLAUDE.md`, "Add to canvas is the one place that
does inline it"). Persist a pointer, render from the file route.

**Files:** `server/index.js`, `client/src/nodes/ImageOutputNode.jsx`,
`client/src/nodes/VideoOutputNode.jsx`, `CHANGELOG.md`

- [ ] **Step 1: The server hands back a URL, not just a path**

`/api/generate` returns `{ image, savedPath, cost }`; the client has no project name to
build a file URL from. Add `url: fileUrl(project, imgPath)` to that response, the way the
video routes already do. `fileUrl` and `GET /api/file/:project/:name` both exist.

- [ ] **Step 2: Persist the pointer, not the picture**

On each completed run, write `{ url, savedPath, cost, runIndex }` into node data alongside
the existing local state — no `image` data URL. Render from `r.image ?? r.url`, so a
just-finished run keeps showing the bytes it already has and a reopened node falls back to
the file. Clearing results clears both.

- [ ] **Step 3: Add to canvas still works from a URL**

`addResultToCanvas` currently reads `r.image`. After a reload there is no data URL. Mirror
`VideoOutputNode.addVideoToCanvas`: fetch the file, base64 it, inline THAT into the new
image node — a reference has to travel to OpenRouter, which cannot reach this machine.

- [ ] **Step 4: Same treatment for the video node's `result`**

`{ url, cost, savedPath }` into node data, rendered from `url`. It already receives all
three from the poll response.

- [ ] **Step 5: `npm test`, CHANGELOG, and verify in the app (controller)**

Generate, switch projects, come back, confirm the result is still shown; reload and confirm
the same; then Add to canvas from a reopened node.

---

### Task 14: A terminal upstream status must end the job

**Why this exists:** found by the user. A render queued for over two hours came back from
OpenRouter as:

```
{"status":"expired","error":"Job exceeded maximum time to live"}   HTTP 200
```

`server/index.js` recognises exactly two outcomes — `completed` and `failed` — so `expired`
falls through every "still rendering" branch. The node spins forever with Generate
disabled, and `sweepJobs` leaves the record `pending` and re-polls it every 30s for the
life of the process. `pruneJobs` never drops a `pending` record by design, so it is also
permanent in `jobs.json`. The whole-branch review predicted this as a Minor with "no user-facing
symptom"; the symptom is a node that never stops loading.

**The rule:** only the server talks upstream, so the server normalises. Neither the client
nor the sweep should carry its own list of provider status strings.

**Files:** `server/index.js`, `server/host.test.js`, `CHANGELOG.md`

- [ ] **Step 1: Name the terminal states in one place**

Beside `fetchVideoStatus`, a single mapping from a provider status to what it means here:
`completed` succeeds; `failed`, `expired`, `cancelled` and `canceled` are terminal
failures; everything else is still in flight. One constant, one helper, used by BOTH
`sweepOne` and `GET /api/video/:id` — the two places that currently branch on the string
themselves.

Do NOT treat an unrecognised status as failure. An unknown string is far more likely to be
a provider adding a new in-flight state than a new terminal one, and abandoning a job that
is still rendering throws away money. Unknown stays in flight — but see step 3.

- [ ] **Step 2: A terminal failure ends it everywhere**

`expired` must take exactly the path `failed` takes today: revoke share tokens, persist
`{ status: 'failed', error, resolvedAt }` so the record stops being swept and eventually
prunes, and return the failed response to the browser. Carry the provider's own message
(`Job exceeded maximum time to live` is precisely what the user needs to read) rather than
a generic one.

- [ ] **Step 3: An unknown status must not be invisible**

Since unknown keeps waiting, it has to be legible: include the raw upstream status in the
pending response so the node can show "Rendering… (queued)" rather than an unexplained
spinner. A status nobody recognises should read as unusual, not as normal.

- [ ] **Step 4: Pin it**

`host.test.js` forks the real server with a fake key. Seed `jobs.json` with a `pending`
record, stub the upstream call, and assert an `expired` status ends the job as failed with
the provider's message — and that a `pending` one does not. Confirm each fails with the
fix reverted.

- [ ] **Step 5: `npm test`, CHANGELOG**
