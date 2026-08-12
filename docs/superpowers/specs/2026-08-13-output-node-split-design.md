# Splitting the output node into image, video and text

Status: designed, not built. Supersedes the "OutputNode/TextNode dedup pass" todo
in `status.md`, which this absorbs.

## The problem

The canvas offers five node types. Under **Outputs** they read *Output* and
*Text*, and "Output" is not a thing you can want — it is a node that makes an
image or a video depending on a tab inside it. So the menu names a mechanism
where the user is choosing a medium, and the two output entries are not
comparable to each other: one is a kind of thing, the other is a container.

Underneath, `OutputNode.jsx` is 784 lines carrying both media paths interleaved
through `kind === 'video'` checks, and `TextNode.jsx` has its own copies of the
model loading and canvas-placement logic. Those copies have already drifted:
OutputNode guards its model fetch against a reply arriving after unmount,
TextNode does not.

Both halves are the same fix. Splitting the node types without first extracting
what they share turns two copies into three.

## What changes for the user

The add menu becomes:

- **Inputs:** Prompt · Image · Video
- **Outputs:** Image · Video · Text

The Image/Video tab inside the output node is removed — the choice moves to the
moment you add the node.

"Image" and "Video" deliberately appear in both sections. One is a picture you
supply, one is a picture you generate; the section header says which, and the
node header already renders the two families in different colours. Renaming the
inputs to "Reference image" / "Reference video" was considered and rejected as
churn on nodes that are not the problem.

**There is no way to convert an existing output node between image and video.**
Changing your mind means deleting the node and adding the other kind, then
re-wiring. A right-click "Convert to…" action is the obvious later addition if
this proves annoying in practice; it is not worth the extra code path and the
what-carries-over decision up front.

## Node types

| Family | Type id | Title on canvas | Menu label |
| --- | --- | --- | --- |
| input | `prompt` | prompt | Prompt |
| input | `image` | image | Image |
| input | `video` | video | Video |
| output | `imageOutput` | image | Image |
| output | `videoOutput` | video | Video |
| output | `textOutput` | text | Text |

`NodeHeader` renders the type id as its title today, which stops working once id
and title differ. It gains an explicit `title` prop. `family` is unchanged and
keeps doing the colour work.

`text` is renamed to `textOutput` along with the rest. It costs five edits in
`resolve.js`, one in `save.js`, one in `toJson.js` and the test file — all
mechanical and all covered by `npm test`. Leaving it alone would save that and
leave a permanent oddity where two of three siblings share a suffix, and the
migration map has to exist for the other two regardless.

### The engine's rule stops being a list of strings

`resolve.js` identifies consumers with a literal — `n.type === 'output' ||
n.type === 'text'` — and names `text` in four other places. Extending each of
those strings for a third output type is how the rule drifts apart. Two
predicates replace them:

```js
export const isOutput = (n) => n.type?.endsWith('Output');
export const isTextOutput = (n) => n.type === 'textOutput';
```

A fourth output kind later is then one type id, not a grep.

`presetFromSelection` in `library/save.js` currently sniffs `out.data?.kind ||
'image'` to decide a preset's kind. After the split the node type *is* the
answer, so that fallback chain collapses to a lookup.

## File layout

```
client/src/nodes/
  output/
    core.js          — useModels(kind), useModelParams(entry, kind), freeSpot(),
                       capabilityTags(), ratioLabel()
    controls.jsx     — <ModelPicker>, <ParamControls>, <CostFoot>
  ImageOutputNode.jsx
  VideoOutputNode.jsx
  TextOutputNode.jsx
```

`OutputNode.jsx` and `TextNode.jsx` are deleted.

Two shared files, not six: the split is logic vs JSX, which is the only boundary
that pays for itself at this size.

**`core.js`**

- `useModels(kind)` — fetch the catalogue, hold the server default, return the
  selected entry. All three nodes. Carries the unmount guard TextNode lacks
  today, which is the drift this extraction exists to stop.
- `useModelParams(entry, kind)` — the whole `enumOf` derivation, including the
  rule that an exact `size` *replaces* resolution + aspect ratio rather than
  joining it. Image and video.
- `freeSpot(getNode, getNodes, id)` — the placement search currently duplicated
  in both files. All three.
- `capabilityTags()`, `ratioLabel()` — moved as-is.

**`controls.jsx`**

- `<ModelPicker>` — the Selector with capability tags per row.
- `<ParamControls>` — the Size / Quality / Ratio / Background row, rendering a
  control only where the model declares it.
- `<CostFoot>` — the footer band, taking a cost and optional extras; the video
  estimate and the Clear button stay caller-specific and are passed as children.

Each node file then holds only what is genuinely its own: runs, Free mode and
the repair prompt for image; duration, audio, the share opt-in, job polling and
the player for video; instructions and the result field for text.

**Expected size:** roughly 924 lines becomes roughly 820. The win is not line
count. It is that the largest file drops from 784 to about 280, each file is
readable in one sitting, and the shared behaviour has one home.

## Migration

One pure function in `client/src/graph/migrate.js`, two call sites, nothing
rewritten on disk by hand.

```js
export function migrateNodes(nodes) {
  return nodes.map((n) => {
    if (n.type === 'output') {
      const { kind, ...data } = n.data ?? {};
      return { ...n, type: kind === 'video' ? 'videoOutput' : 'imageOutput', data };
    }
    if (n.type === 'text') return { ...n, type: 'textOutput' };
    return n;
  });
}
```

`data.kind` is dropped as it is consumed: after the split the type carries that
information, and a leftover `kind: 'video'` on a node is the sort of stale field
someone later mistakes for load-bearing. A missing `kind` means image, matching
today's default — and covering the 8 of 11 saved output nodes that have no
`kind` at all.

**Call site 1 — loading a project's graph**, where `graph.json` comes back in
`App.jsx`. The next autosave writes the new format, so each project self-heals
on first open. The five existing projects need no manual touch.

**Call site 2 — `instantiateFragment`**, through which every preset reaches the
canvas, bundled or user-saved.

**`presets.json` on disk is deliberately never rewritten.** Migrating it and
saving it back means a whole-array PUT to fix data the instantiate-time
migration already handles for free — and per `CLAUDE.md` that write path is the
one place where a stale or failed read erases presets still on disk. Old
fragments migrate on their way onto the canvas instead, indefinitely.

**The migration is permanent, not transitional.** Six lines, and deleting it
later would silently break any graph or preset not opened since.

**Edited directly in source, not migrated:** the starter graph in `App.jsx`, the
`layerize` preset's output node, and `toJson`'s text node. Those are code.

## Surface touched

Client only. Nothing else in the repo should need an edit; if it does, that is a
signal the change has grown beyond this spec.

| File | Change |
| --- | --- |
| `nodes/output/core.js` | new — shared hooks and pure helpers |
| `nodes/output/controls.jsx` | new — shared markup |
| `nodes/ImageOutputNode.jsx` | new — from OutputNode's image path |
| `nodes/VideoOutputNode.jsx` | new — from OutputNode's video path |
| `nodes/TextOutputNode.jsx` | new — from TextNode, onto the core |
| `nodes/OutputNode.jsx` | deleted |
| `nodes/TextNode.jsx` | deleted |
| `graph/migrate.js` | new — `migrateNodes` |
| `graph/resolve.js` | `isOutput` / `isTextOutput`, six literals routed through them |
| `graph/resolve.test.js` | new migration + predicate cases; 16 type literals updated |
| `nodes/NodeHeader.jsx` | explicit `title` prop |
| `nodes/nodeIcons.jsx` | `NODE_ICONS` is keyed by type id — three new keys |
| `App.jsx` | `nodeTypes` registry, both add menus, starter graph, migrate on graph load |
| `library/insert.js` | migrate fragments in `instantiateFragment` |
| `library/save.js` | kind derived from node type |
| `library/layerize.js` | fragment's output node retyped |
| `library/toJson.js` | fragment's text node retyped |

Node ids are a bare counter and carry no type prefix, so nothing about id
minting changes.

## No server change

The server has no knowledge of node types: it receives a prompt and
`input_references` from `buildRequest`, and stores `graph.json` as opaque JSON.

Note for whoever reads this next: `listModels('text')` and the `?type=text`
query on `/api/models` are the **model catalogue**, not the node type. They are
unaffected by this rename and must not be "aligned" with the new ids.

## Testing

Automated, in the existing assert-based `resolve.test.js` that `npm test` runs:

- `migrateNodes`: output with no kind → `imageOutput`; `kind: 'video'` →
  `videoOutput` with `kind` stripped; `text` → `textOutput`; other types
  untouched; **idempotent**, so a second pass over a migrated graph is a no-op.
- `isOutput` / `isTextOutput` asserted directly, not only implied.
- The 16 existing occurrences of `type: 'output'` / `type: 'text'` updated.
  Those tests cover `buildRequest`, `freeRunPrompts`, `imageRefNumbers`,
  `presetFromSelection` and `instantiateFragment`, so the suite passing is the
  evidence the engine survived.

Manual, because node components have no tests here by design:

1. Each of the three added from the toolbar menu and the canvas context menu;
   titles read image / video / text, outputs accent-coloured.
2. Image: single run, 3× run, Free mode with a wired text node, add one result
   and add-all — no stacking.
3. Video: generate, queued → rendering in the button label, playback, Add to
   canvas inlines the clip, local-clip share opt-in still appears and warns.
4. Text: run, edit the result, Add as prompt node.
5. Open all five existing projects. `sandbox` is the one that matters — it holds
   a video output, image outputs and a text node.
6. Insert `layerize` and `to-json` from the Library; save a selection as a user
   preset, check its derived chips, re-insert it.

## The two real risks

**1. The silent text-resolution trap.** `resolve.js:24` reads `if (node.type ===
'text') return node.data?.result`. Miss that line during the rename and an `@id`
pointing at a text node stops returning the model's *answer* and falls through to
`substitute(node.data?.text)` — the node's *Instructions* field. No error, no
warning: generations quietly built from the wrong text. This is why the rename
routes through `isTextOutput` rather than a find-and-replace.

**2. A bad migration writes itself to disk.** Graphs autosave, so opening a
project with a wrong `migrateNodes` corrupts its `graph.json` on the way back
out. Mitigation, in order: land and pass the migration tests *before* the app is
opened against real projects, and copy `output/*/graph.json` first. Five small
files, thirty seconds, and it removes the only irreversible failure in this
change.

## Rejected

- **Relabel without splitting.** The menu offers Image and Video as two entries
  that both create today's node with `data.kind` preset; the title reads the
  kind; the tab is removed. About 30 lines, no migration, and it delivers the
  whole user-facing win. Rejected because it leaves the 784-line file and the
  dedup todo exactly where they are, and this file gets harder to split the
  longer the paid tier and Electron work accumulate on top of it.
- **Split with no shared core** — three standalone files with the common parts
  copied. Fastest to write, and it turns two copies into three, which is the
  thing the dedup todo exists to prevent.
- **Renaming the input nodes to "Reference image" / "Reference video"** to avoid
  the repeated labels. The section headers already disambiguate.
- **A convert-between-kinds action.** Deferred, not refused. Worth adding if
  delete-and-re-add proves irritating.
