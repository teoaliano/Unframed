# Output Node Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `output` node (image-or-video via a tab) and the `text` node with three sibling output types — `imageOutput`, `videoOutput`, `textOutput` — sitting on one extracted shared core.

**Architecture:** Extract what the output nodes share into `nodes/output/core.js` (hooks and pure helpers) and `nodes/output/controls.jsx` (shared markup) *before* splitting, so the split produces three thin components rather than three copies. The engine stops naming node types one by one and uses two predicates. Old graphs and presets are migrated by one pure function applied at graph load and at preset instantiation.

**Tech Stack:** React 18, React Flow (`@xyflow/react`), Astryx design system, plain `node` assert-based tests (no framework).

**Spec:** `docs/superpowers/specs/2026-08-13-output-node-split-design.md`

## Global Constraints

- Client only. No file under `server/` is modified. If a server change seems needed, stop — the change has outgrown the spec.
- `listModels('text')` and `?type=text` on `/api/models` are the **model catalogue**, not a node type. Do not rename them.
- Tests are plain `node` + `node:assert/strict`. No test framework, no fixtures. Run with `npm test`.
- Node titles on canvas are `image`, `video`, `text` — lowercase, matching today's style. Menu labels are `Image`, `Video`, `Text`.
- Type ids are exactly `imageOutput`, `videoOutput`, `textOutput`.
- `isOutput` must return true for all three output types; `isTextOutput` only for `textOutput`.
- Every commit leaves `npm test` green.
- Existing comment density and voice are the house style — comments explain *why*, not *what*. Match them.

---

### Task 0: Back up the saved graphs

**Files:**
- Create: `output/.graph-backup-2026-08-13/` (gitignored, `output/` is not tracked)

**Interfaces:**
- Consumes: nothing
- Produces: a restore point for the five real projects

The only irreversible failure in this whole change is a wrong `migrateNodes`
corrupting a real `graph.json` on autosave. Thirty seconds of insurance.

- [ ] **Step 1: Copy every project graph**

```bash
mkdir -p output/.graph-backup-2026-08-13
for f in output/*/graph.json; do cp "$f" "output/.graph-backup-2026-08-13/$(basename $(dirname $f)).json"; done
ls -la output/.graph-backup-2026-08-13/
```

Expected: five files — `forest-ds-highlights.json`, `inklings-character.json`,
`pushapp-characters.json`, `sandbox.json`, `test.json`.

- [ ] **Step 2: Record what should survive**

```bash
for f in output/*/graph.json; do node -e "
const d=require('./$f');
const o=d.nodes.filter(n=>n.type==='output'||n.type==='text');
console.log('$f', o.map(n=>n.type+':'+(n.data&&n.data.kind||'-')).join(' '));
"; done
```

Expected output, which Task 4's manual check must reproduce as the new types:

```
output/forest-ds-highlights/graph.json output:- output:-
output/inklings-character/graph.json output:- output:- output:- output:video
output/pushapp-characters/graph.json output:- output:-
output/sandbox/graph.json output:video text:- output:- output:image
output/test/graph.json output:video
```

No commit — `output/` is not tracked.

---

### Task 1: Migration function and engine predicates

**Files:**
- Create: `client/src/graph/migrate.js`
- Modify: `client/src/graph/resolve.js` (add exports only, no behaviour change yet)
- Test: `client/src/graph/resolve.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `migrateNodes(nodes: Node[]) => Node[]` from `graph/migrate.js`
  - `isOutput(node) => boolean`, `isTextOutput(node) => boolean` from `graph/resolve.js`

This task is purely additive — nothing calls the new code yet, so the app is
unchanged and the test suite is the whole verification.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/graph/resolve.test.js`, above the final `console.log`:

```js
// --- migration: old graphs and presets carry `output` + data.kind, and `text` ---
{
  const legacy = [
    { id: 'a', type: 'output', position: { x: 0, y: 0 }, data: {} },
    { id: 'b', type: 'output', position: { x: 0, y: 0 }, data: { kind: 'video', duration: 5 } },
    { id: 'c', type: 'output', position: { x: 0, y: 0 }, data: { kind: 'image', quality: 'low' } },
    { id: 'd', type: 'text', position: { x: 0, y: 0 }, data: { result: 'hi' } },
    { id: 'e', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'p' } },
    { id: 'f', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: 'x' } },
  ];
  const got = migrateNodes(legacy);

  assert.equal(got[0].type, 'imageOutput', 'an output node with no kind is an image output');
  assert.equal(got[1].type, 'videoOutput', 'kind video becomes a video output');
  assert.equal(got[2].type, 'imageOutput', 'kind image becomes an image output');
  assert.equal(got[3].type, 'textOutput', 'a text node becomes a text output');
  assert.equal(got[4].type, 'prompt', 'input nodes are untouched');
  assert.equal(got[5].type, 'image', 'an image INPUT node is not confused with an image output');

  assert.equal('kind' in got[1].data, false, 'kind is stripped once the type carries it');
  assert.equal(got[1].data.duration, 5, 'the rest of data survives');
  assert.equal(got[2].data.quality, 'low', 'the rest of data survives');
  assert.equal(got[3].data.result, 'hi', 'a text result survives');

  assert.deepEqual(migrateNodes(got), got,
    'migration is idempotent — a second pass over a migrated graph is a no-op');

  assert.equal(legacy[1].data.kind, 'video', 'the input array is not mutated');
}

// A node with no data at all must not throw — old fragments can omit it.
{
  const got = migrateNodes([{ id: 'a', type: 'output', position: { x: 0, y: 0 } }]);
  assert.equal(got[0].type, 'imageOutput');
  assert.deepEqual(got[0].data, {}, 'a missing data object becomes an empty one');
}

// --- the engine's one rule, as predicates rather than a list of strings ---
{
  assert.equal(isOutput({ type: 'imageOutput' }), true);
  assert.equal(isOutput({ type: 'videoOutput' }), true);
  assert.equal(isOutput({ type: 'textOutput' }), true);
  assert.equal(isOutput({ type: 'prompt' }), false);
  assert.equal(isOutput({ type: 'image' }), false);
  assert.equal(isOutput({ type: 'video' }), false);
  assert.equal(isOutput({}), false, 'a node with no type is not an output');

  assert.equal(isTextOutput({ type: 'textOutput' }), true);
  assert.equal(isTextOutput({ type: 'imageOutput' }), false);
  assert.equal(isTextOutput({ type: 'text' }), false, 'the pre-migration id is not a text output');
}
```

And extend the imports at the top of the file:

```js
import { buildRequest, imageRefNumbers, splitSections, findWiredTextNode, freeRunPrompts, isOutput, isTextOutput } from './resolve.js';
import { migrateNodes } from './migrate.js';
```

- [ ] **Step 2: Run to verify it fails**

Run: `node client/src/graph/resolve.test.js`
Expected: FAIL — `SyntaxError: The requested module './migrate.js' does not provide an export named 'migrateNodes'`, or ERR_MODULE_NOT_FOUND for `migrate.js`.

- [ ] **Step 3: Write `client/src/graph/migrate.js`**

```js
// Old graphs and old presets name one `output` node that chose its medium with a
// `data.kind` tab, plus a `text` node. Both became their own node types. This is
// applied on the way IN — when a project's graph.json loads, and when a preset
// fragment is instantiated — so nothing on disk has to be rewritten to keep working.
//
// Permanent, not transitional: it is six lines, and removing it later would
// silently break any graph or preset that had not been opened since.
export function migrateNodes(nodes) {
  return nodes.map((n) => {
    if (n.type === 'output') {
      // kind is consumed, not carried: after the split the type IS the medium, and
      // a leftover kind:'video' is exactly the stale field someone later mistakes
      // for load-bearing. Absent means image, which is what the node defaulted to.
      const { kind, ...data } = n.data ?? {};
      return { ...n, type: kind === 'video' ? 'videoOutput' : 'imageOutput', data };
    }
    if (n.type === 'text') return { ...n, type: 'textOutput', data: n.data ?? {} };
    return n;
  });
}
```

- [ ] **Step 4: Add the predicates to `client/src/graph/resolve.js`**

Insert after the `TOKEN_RE` definition near the top:

```js
// The engine's one rule — inputs only feed edges, outputs consume them — as a
// predicate rather than a list of type strings repeated down this file. A fourth
// output kind is then one type id, not a grep.
export const isOutput = (n) => Boolean(n?.type?.endsWith('Output'));
// A text output's stored ANSWER is what @id pulls in, never its instructions.
// Kept as its own predicate because getting this wrong is silent: see resolve.js's
// resolveRef, where falling through would substitute data.text instead of data.result.
export const isTextOutput = (n) => n?.type === 'textOutput';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — `resolve.js: all checks passed` plus the three server suites.

- [ ] **Step 6: Commit**

```bash
git add client/src/graph/migrate.js client/src/graph/resolve.js client/src/graph/resolve.test.js
git commit -m "Add the node-type migration and the output predicates

Additive: nothing calls either yet. Landing them first means the
migration is proven by tests before it is ever pointed at a real
graph.json, which autosave would otherwise rewrite in place."
```

---

### Task 2: Extract the shared core

**Files:**
- Create: `client/src/nodes/output/core.js`
- Create: `client/src/nodes/output/controls.jsx`
- Modify: `client/src/nodes/OutputNode.jsx`
- Modify: `client/src/nodes/TextNode.jsx`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces, from `nodes/output/core.js`:
  - `useModels(kind)` → `{ models, defaultModel, entry(model) }` where `kind` is `'image' | 'video' | 'text'`
  - `useModelParams(entry, kind)` → `{ exactSizes, resolutionTiers, ratios, qualities, backgrounds, durations, canAudio, supported(values, value) }`
  - `freeSpot(getNode, getNodes, id)` → `{ x, y }`
  - `capabilityTags(entry, kind)` → `string[]`
  - `ratioLabel(size)` → `string`
- Produces, from `nodes/output/controls.jsx`:
  - `<ModelPicker models value onChange kind />`
  - `<ParamControls params value onChange />` where `params` is the object from `useModelParams` and `value`/`onChange` read and write node data
  - `<CostFoot cost children />`

This task is a pure refactor: no user-visible change, no new node types. It is
the "dedup pass" todo from `status.md`, done as the foundation for Task 4 rather
than as its own errand. Reviewable and revertible on its own.

- [ ] **Step 1: Create `client/src/nodes/output/core.js`**

Move, unchanged in behaviour:
- `ratioLabel` and its `RATIOS` table from `OutputNode.jsx:28-43`
- `capabilityTags` from `OutputNode.jsx:50-70`
- the model-loading effect from `OutputNode.jsx:94-104` as `useModels(kind)`, keeping the `live` cancel guard
- the `enumOf` derivation from `OutputNode.jsx:121-141` as `useModelParams(entry, kind)`, keeping the comment explaining that an exact `size` REPLACES resolution + ratio rather than joining them
- `freeSpot` from `OutputNode.jsx:165-174`, parameterised on `getNode`/`getNodes`/`id`

Keep every existing comment with the code it explains. They are the reason those
rules are still known.

- [ ] **Step 2: Create `client/src/nodes/output/controls.jsx`**

Move, unchanged in behaviour:
- the Model `Selector` including its `renderOption` capability tags, from `OutputNode.jsx:449-477`, as `<ModelPicker>`
- the `HStack` of Size / Quality / Background / Ratio selectors from `OutputNode.jsx:478-534`, as `<ParamControls>`
- the `xnode-foot` band from `OutputNode.jsx:749-781` as `<CostFoot>`, with the estimate and Clear button passed in as children so they stay caller-specific

- [ ] **Step 3: Rewrite `OutputNode.jsx` and `TextNode.jsx` against the core**

`OutputNode.jsx` keeps its tab, both media paths and all behaviour — only the
extracted blocks are replaced by calls. `TextNode.jsx` swaps its own model-loading
effect for `useModels('text')` (gaining the cancel guard it lacks) and its inline
placement scan in `addResultAsPrompt` for `freeSpot`.

- [ ] **Step 4: Verify nothing changed**

Run: `npm test`
Expected: PASS. The suite does not cover components, so this only proves the
graph logic is untouched.

Run: `npm run dev`, then in the browser:
- add an output node, generate one image, add it to the canvas
- switch the node to Video, confirm the Size control changes shape
- add a text node, run it, Add as prompt node — confirm the new node does not land on top of another

Expected: identical to before this task.

- [ ] **Step 5: Commit**

```bash
git add client/src/nodes/
git commit -m "Extract the shared core behind the two output nodes

Model loading, the model-declared parameter derivation, canvas
placement and the cost footer had a copy in each file, and they had
already drifted: OutputNode guarded its model fetch against a late
reply, TextNode did not.

No behaviour change. This is the deferred dedup pass, done now
because splitting the node types on top of two copies would have
made three."
```

---

### Task 3: Teach the header and the icon table about titles

**Files:**
- Modify: `client/src/nodes/NodeHeader.jsx`
- Modify: `client/src/nodes/nodeIcons.jsx`

**Interfaces:**
- Consumes: nothing
- Produces: `<NodeHeader kind title family copyId right rightTone />` — `title` defaults to `kind`, so every existing call site keeps working untouched.

Additive and independently safe: after this task the app looks and behaves
exactly as before, but Task 4 has somewhere to put a title that differs from the
type id.

- [ ] **Step 1: Add the `title` prop**

In `NodeHeader.jsx`, take `title` alongside `kind` and render `{title ?? kind}`
in the `<Text>`. `kind` keeps its existing job of looking up `NODE_ICONS[kind]`.

Add a comment saying why the two are now separate: the output types are named
`imageOutput`/`videoOutput`/`textOutput` internally so they cannot collide with
the `image`/`video` INPUT nodes, but they are titled `image`/`video`/`text` on
the canvas, where the accent colour already marks the family.

- [ ] **Step 2: Add the three icon keys**

In `nodeIcons.jsx`, add `imageOutput`, `videoOutput` and `textOutput` keys to
`NODE_ICONS`. `imageOutput` and `videoOutput` reuse the existing image and video
icons; `textOutput` reuses the current `text` icon. Leave the old `output` and
`text` keys in place for now — Task 4 removes them, and keeping them here means
this task cannot break the running app.

- [ ] **Step 3: Verify**

Run: `npm test` → PASS.
Run: `npm run dev` → the canvas renders exactly as before; every node header
still shows its title and icon.

- [ ] **Step 4: Commit**

```bash
git add client/src/nodes/NodeHeader.jsx client/src/nodes/nodeIcons.jsx
git commit -m "Let a node's title differ from its type id

The output types need internal ids that cannot collide with the
image and video INPUT nodes, while still being titled image and
video on the canvas. Defaults to the type id, so no call site
changes."
```

---

### Task 4: The split

**Files:**
- Create: `client/src/nodes/ImageOutputNode.jsx`
- Create: `client/src/nodes/VideoOutputNode.jsx`
- Create: `client/src/nodes/TextOutputNode.jsx`
- Delete: `client/src/nodes/OutputNode.jsx`, `client/src/nodes/TextNode.jsx`
- Modify: `client/src/graph/resolve.js`, `client/src/App.jsx`, `client/src/library/insert.js`, `client/src/library/save.js`, `client/src/library/layerize.js`, `client/src/library/toJson.js`, `client/src/nodes/nodeIcons.jsx`
- Test: `client/src/graph/resolve.test.js`

**Interfaces:**
- Consumes: `migrateNodes` and `isOutput`/`isTextOutput` from Task 1; the whole core from Task 2; `NodeHeader`'s `title` prop from Task 3
- Produces: the three registered node types

This one is atomic — there is no half-renamed state that runs.

- [ ] **Step 1: Update the test file to the new type ids**

Replace all 16 occurrences of `type: 'output'` → `type: 'imageOutput'` and
`type: 'text'` → `type: 'textOutput'` in `resolve.test.js`, including the shared
`out` fixture on line 7. Update the two `presetFromSelection` assertions that
build `{ type: 'text' }` and `{ type: 'output' }` fragments.

Add one case for the trap named in the spec:

```js
// The silent trap: an @id pointing at a text output must resolve to its stored
// ANSWER, not to its instructions. Getting this wrong produces no error at all —
// just generations quietly built from the wrong text.
{
  const { nodes, edges } = graph(
    [
      { id: 't1', type: 'textOutput', position: { x: 0, y: 0 },
        data: { text: 'INSTRUCTIONS, not the answer', result: 'a red fox' } },
      { id: 'p1', type: 'prompt', position: { x: 0, y: 10 }, data: { text: 'draw @t1' } },
    ],
    [{ id: 'e1', source: 'p1', target: 'out' }],
  );
  assert.equal(buildRequest(nodes, edges, 'out').prompt, 'draw a red fox');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node client/src/graph/resolve.test.js`
Expected: FAIL — `buildRequest` returns an empty prompt and `imageRefNumbers`
returns `[]`, because `resolve.js` still matches the literal strings `'output'`
and `'text'`.

- [ ] **Step 3: Route `resolve.js` through the predicates**

Six sites, all in `client/src/graph/resolve.js`:

| Line | Now | Becomes |
| --- | --- | --- |
| 24 | `node.type === 'text'` | `isTextOutput(node)` |
| 37 | `n.type === 'prompt' \|\| n.type === 'text'` | `n.type === 'prompt' \|\| isTextOutput(n)` |
| 61 | `node.type !== 'prompt' && node.type !== 'text'` | `node.type !== 'prompt' && !isTextOutput(node)` |
| 81 | `n.type === 'output' \|\| n.type === 'text'` | `isOutput(n)` |
| 106 | `n.type === 'text'` | `isTextOutput(n)` |

Line 52's `n.type === 'image' \|\| n.type === 'video'` is the INPUT nodes and
does not change. Confirm that deliberately rather than by omission.

- [ ] **Step 4: Run to verify the graph logic passes**

Run: `node client/src/graph/resolve.test.js`
Expected: PASS.

- [ ] **Step 5: Split the components**

`ImageOutputNode.jsx` takes OutputNode's image path: runs and Free mode, the
repair prompt, the thumbnail strip, add-one and add-all, the image cost footer.
`VideoOutputNode.jsx` takes the video path: duration, audio, the share opt-in and
its `ExpandableNote`, job polling, the player, Add to canvas, the per-second
estimate. `TextOutputNode.jsx` is Task 2's `TextNode` with its type renamed.

Drop from all three: the `SegmentedControl` tab, `data.kind`, and every
`kind === 'video'` branch — each file now knows what it is. Keep the video
warnings (`wiredVideoIntoVideo`, the local-clip note, the "not known to accept
video" line) with their comments; they are hard-won and still true.

Each renders `<NodeHeader kind="imageOutput" title="image" family="output" />`
and so on.

- [ ] **Step 6: Register and wire**

- `App.jsx:66` — `nodeTypes` becomes `{ prompt, image, video, imageOutput, videoOutput, textOutput }`
- `App.jsx:147` — the starter graph's output node becomes `type: 'imageOutput'`
- `App.jsx:557-560` — `addOutput`/`addText` become `addImageOutput`/`addVideoOutput`/`addTextOutput`
- `App.jsx:570-592` — the Outputs section lists Image, Video, Text
- `App.jsx` graph load — apply `migrateNodes(nodes)` to what comes back from the server
- `library/insert.js` — apply `migrateNodes` to the fragment's nodes inside `instantiateFragment`
- `library/save.js` — `presetFromSelection` derives `kind` from the node type: `imageOutput` → image, `videoOutput` → video, `textOutput` → text, nothing → image
- `library/layerize.js` — its output node becomes `type: 'imageOutput'`
- `library/toJson.js` — its text node becomes `type: 'textOutput'`
- `nodeIcons.jsx` — drop the now-dead `output` and `text` keys

- [ ] **Step 7: Delete the old components**

```bash
git rm client/src/nodes/OutputNode.jsx client/src/nodes/TextNode.jsx
```

- [ ] **Step 8: Run the suite**

Run: `npm test`
Expected: PASS, all four suites.

- [ ] **Step 9: Manual verification**

Run `npm run dev`, then:

1. Both add menus show Inputs: Prompt · Image · Video and Outputs: Image · Video · Text. Titles read `image` / `video` / `text`; outputs are accent-coloured, inputs are not.
2. Image output: one run; 3 runs; Free mode with a wired text output; add one result and add-all — nothing stacks.
3. Video output: generate, the button reads queued → rendering, the clip plays, Add to canvas inlines it. Wire a local clip in and confirm the share opt-in and its warning still appear.
4. Text output: run it, edit the result, Add as prompt node.
5. Open all five projects. Compare against Task 0 Step 2's table — `sandbox` must come back with a video output, two image outputs and a text output; `inklings-character` with three image outputs and one video output. Wires intact.
6. Insert `layerize` and `to-json` from the Library. Save a selection as a user preset, check its derived chips, re-insert it.

- [ ] **Step 10: Commit**

```bash
git add -A client/src
git commit -m "Split the output node into image, video and text

Outputs now read Image, Video and Text — three comparable things —
instead of Text beside an Output that hid its medium behind a tab.
Picking the medium moves to the moment you add the node.

Old graphs and presets migrate on the way in, so nothing on disk
needs rewriting. The engine identifies outputs by predicate now
rather than by a list of type strings repeated down resolve.js."
```

---

### Task 5: Documentation

**Files:**
- Modify: `CLAUDE.md`, `CHANGELOG.md`, `status.md`

**Interfaces:**
- Consumes: the finished split
- Produces: nothing code depends on

`CLAUDE.md` is not optional housekeeping here — it documents the node types, says
"Labels match type ids" (now false), and describes the output node's Image/Video
tabs. Left stale it actively misleads the next session.

- [ ] **Step 1: Update `CLAUDE.md`**

- **Node types** section: three inputs, three outputs, with the new ids. Replace "Labels match type ids" with the new rule — output ids end in `Output` so they cannot collide with the `image`/`video` input nodes, and are titled by medium on the canvas.
- **Key design decisions**: replace the OutputNode `data.kind` description with the predicate rule (`isOutput`/`isTextOutput` in `resolve.js`), and add the migration: one pure function at graph load and at preset instantiation, permanent, with `presets.json` deliberately never rewritten because that PUT replaces the whole array.
- Update the `nodeTypes` registry line and any `type: 'output'` reference.

- [ ] **Step 2: Add a `CHANGELOG.md` entry**

Per the format contract in `status.md`: `## 2026-08-13`, `### Changed`, one
bullet per user-visible change. User-visible only:

- Outputs are now three nodes — Image, Video and Text — instead of one Output node with a tab inside it.
- Existing projects and saved presets open as before; their output nodes become image or video automatically.

- [ ] **Step 3: Update `status.md`**

- Delete the `OutputNode/TextNode dedup pass` todo — done, in Task 2.
- Delete the Layerize note "The planned OutputNode/TextNode dedup pass was deferred to the start of this sub-project", which is now false.
- Add a line under Todos for the deferred convert action: right-click an output node to convert between image and video, keeping position and wires. Note it was deliberately deferred, not forgotten, and that delete-and-re-add is the current answer.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CHANGELOG.md status.md
git commit -m "Document the output split

CLAUDE.md said labels match type ids, which the split makes false.
status.md loses the dedup todo it absorbed and gains the convert
action it deferred."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Node types table | 3 (title prop), 4 (registration) |
| `isOutput` / `isTextOutput` | 1 (defined + tested), 4 (used) |
| `presetFromSelection` kind from type | 4 Step 6 |
| File layout / shared core | 2 |
| Migration, both call sites | 1 (written + tested), 4 Step 6 (wired) |
| `presets.json` never rewritten | 4 Step 6 — migration is at instantiate only; no write path added |
| Edited in source, not migrated | 4 Steps 6 (starter graph, layerize, toJson) |
| No server change | Global Constraints |
| Automated tests | 1, 4 Step 1 |
| Manual checks | 4 Step 9 |
| Risk 1, the text-resolution trap | 4 Step 1's dedicated case, 4 Step 3's line-24 row |
| Risk 2, migration corrupting a graph | 0 (backup), 1 (tests land before any real load) |

No gaps.

**Placeholder scan:** none — every step names exact files, exact lines, exact
commands and expected output.

**Type consistency:** `migrateNodes`, `isOutput`, `isTextOutput`, `useModels`,
`useModelParams`, `freeSpot`, `capabilityTags`, `ratioLabel`, `ModelPicker`,
`ParamControls`, `CostFoot` are each named identically in the Interfaces block
that defines them and every later task that uses them. Type ids `imageOutput` /
`videoOutput` / `textOutput` are spelled consistently throughout.
