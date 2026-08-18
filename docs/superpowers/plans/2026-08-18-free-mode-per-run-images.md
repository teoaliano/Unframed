# Free Mode: Prompt Sources, Per-Run Images, and a Preview Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a plain prompt node drive Free mode, let the text model decide which wired images each run receives, and add an opt-in preview that shows the assembled batch before any image is paid for.

**Architecture:** All new logic is pure and lands in `client/src/graph/resolve.js`, tested by the existing assert-based `resolve.test.js`. One new exported seam, `freeBatch()`, turns list text into the exact runs that will be sent; both Generate and the preview dialog call it, so the preview cannot drift from what is sent. `ImageOutputNode.jsx` splits its `onGenerate` into a build half and a `fire()` half so the preview can sit between them. The dialog is one new presentational file.

**Tech Stack:** React 18 + `@xyflow/react`, `@astryxdesign/core` components, Vite. Tests are plain `node` with `node:assert/strict` — no framework, no fixtures.

**Spec:** `docs/superpowers/specs/2026-08-18-free-mode-per-run-images-design.md`

**This plan is scaffolding.** Per `CLAUDE.md`, delete it once the work is merged; move anything that outlives it into `docs/models.md` (Task 6) or `status.md` first.

## Global Constraints

- Node 18+, ESM (`import`) throughout. No new dependencies — everything needed is already imported somewhere in `client/src`.
- Tests are bare `assert` blocks in `client/src/graph/resolve.test.js`, run by `npm test`. No test framework, no `describe`, no fixtures. Each block is wrapped in `{ }` so `const` names can be reused.
- Node components (`.jsx`) have no tests by design. Verify those in the running app and say so.
- `@astryxdesign/core` APIs, confirmed against existing usage in this repo: `CheckboxInput` takes `label`, `value`, `onChange(bool)`. `TextArea` takes `label`, `isLabelHidden`, `rows`, `hasSpellCheck`, `value`, `onChange(v, e)`. `Dialog` takes `isOpen`, `onOpenChange(open)`, `purpose`, `width`; `DialogHeader` takes `title`, `subtitle`. `Text` types in use are `label` and `supporting` — there is no `body`. `HStack` supports `gap` and `justify="end"`; no other `justify` value appears in the repo, so do not invent one. `node_modules` is absent from this worktree, so if a prop below is rejected at runtime, grep an existing usage rather than guessing.
- Comments earn their length only if deleting them would let someone make a wrong change (`CLAUDE.md`). Every comment written below is there because the rule it states is invisible in the code.
- Run count cap stays `MAX_RUNS = 10` (`RunsControl.jsx`), applied by `splitSections`.
- Every `await` that can reject sits inside a `try/catch` — this Express/React setup has no catch-all.

---

### Task 1: Free mode can read a prompt node

**Files:**
- Modify: `client/src/graph/resolve.js` (replace `findWiredTextNode` at :159, refactor `freeRunPrompts` at :175)
- Test: `client/src/graph/resolve.test.js` (replace the `findWiredTextNode` block at :195-204, add new blocks)

**Interfaces:**
- Consumes: existing `isTextOutput`, `substitute`, `buildRequest` from this module.
- Produces:
  - `findFreeSource(nodes, edges, outputId) -> node | undefined`
  - `freeSourceText(node, nodes) -> string`
  - `freeShared(nodes, edges, outputId, sourceId) -> string`
  - `freeRunPrompts(nodes, edges, outputId, sourceId, blocks) -> string[]` (renamed 4th param, same behaviour)
  - `findWiredTextNode` is **gone** — Task 2 updates its only two callers.

- [ ] **Step 1: Write the failing tests**

Replace the block at `client/src/graph/resolve.test.js:195-204` (the "No text node wired in -> undefined" block) and its `// --- findWiredTextNode / freeRunPrompts ---` heading with:

```js
// --- findFreeSource / freeSourceText / freeRunPrompts ---

// A wired text output wins outright, even when a prompt node sits above it. Precedence
// rather than lowest-Y across both kinds: an existing Free graph with a context prompt
// above its text output would otherwise silently change which node supplies the list,
// and a batch built from the wrong text is only noticed after it is paid for.
{
  const { nodes, edges } = graph(
    [
      { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'context' } },
      { id: 't1', type: 'textOutput', position: { x: 0, y: 50 }, data: { result: 'a\n---\nb' } },
    ],
    [
      { id: 'e1', source: 'p1', target: 'out' },
      { id: 'e2', source: 't1', target: 'out' },
    ],
  );
  assert.equal(findFreeSource(nodes, edges, 'out').id, 't1', 'a text output outranks a prompt node');
}

// No text output wired -> the lowest-Y prompt node stands in.
{
  const { nodes, edges } = graph(
    [
      { id: 'p-lo', type: 'prompt', position: { x: 0, y: 50 }, data: { text: 'second' } },
      { id: 'p-hi', type: 'prompt', position: { x: 0, y: 10 }, data: { text: 'first' } },
    ],
    [
      { id: 'e1', source: 'p-lo', target: 'out' },
      { id: 'e2', source: 'p-hi', target: 'out' },
    ],
  );
  assert.equal(findFreeSource(nodes, edges, 'out').id, 'p-hi');
}

// Nothing wired in -> undefined.
{
  assert.equal(findFreeSource([out], [], 'out'), undefined);
}

// freeSourceText: a text output's answer verbatim (never re-scanned for @tokens), a
// prompt node's @ids expanded first so no literal token reaches the splitter.
{
  // @p2 DOES resolve, so this fails if the text output's result is ever re-scanned --
  // the bug the verbatim rule exists to prevent. A token naming nothing would pass either way.
  const t = { id: 't1', type: 'textOutput', position: { x: 0, y: 0 }, data: { result: 'raw @p2 answer' } };
  const other = { id: 'p2', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'golden hour' } };
  const p = { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'in @p2 light' } };
  const nodes = [out, t, other, p];
  assert.equal(freeSourceText(t, nodes), 'raw @p2 answer', "a text output's answer is taken verbatim");
  assert.equal(freeSourceText(p, nodes), 'in golden hour light', "a prompt node's @ids expand before splitting");
  assert.equal(freeSourceText(undefined, nodes), '', 'no source is an empty list, not a crash');
}

// freeRunPrompts with a PROMPT node as the source: its own text is blanked out of the
// shared context exactly as a text output's result is, so the list cannot smuggle
// itself back in either by being wired in or through @its-id.
{
  const src = { id: 'p-list', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'one\n---\ntwo' } };
  const shared = { id: 'p-shared', type: 'prompt', position: { x: 0, y: 50 }, data: { text: 'a shared subject' } };
  const sibling = { id: 'p-sib', type: 'prompt', position: { x: 0, y: 90 }, data: { text: 'ref: @p-list' } };
  const { nodes, edges } = graph([shared, src, sibling], [
    { id: 'e1', source: 'p-shared', target: 'out' },
    { id: 'e2', source: 'p-list', target: 'out' },
    { id: 'e3', source: 'p-sib', target: 'out' },
  ]);
  assert.equal(findFreeSource(nodes, edges, 'out').id, 'p-list');
  assert.equal(freeShared(nodes, edges, 'out', 'p-list').includes('one'), false, 'the list is not in the shared context');

  const prompts = freeRunPrompts(nodes, edges, 'out', 'p-list', ['one', 'two']);
  assert.equal(prompts.length, 2);
  for (const p of prompts) {
    assert.ok(p.includes('a shared subject'), 'shared context missing');
    assert.ok(!p.includes('---'), 'separator leaked');
    assert.ok(!p.includes('@p-list'), 'unresolved @token leaked');
  }
  assert.ok(prompts[0].includes('one') && !prompts[0].includes('two'), 'block 0 carries exactly one item');
}
```

Then update the import on line 3 — drop `findWiredTextNode`, add the three new names:

```js
import { buildRequest, bucketSources, sourceRoles, splitSections, findFreeSource, freeSourceText, freeShared, freeRunPrompts, isOutput, isTextOutput } from './resolve.js';
```

And in the surviving `freeRunPrompts` block further down (the one starting `// freeRunPrompts: the shared context`), rename its two `findWiredTextNode` calls to `findFreeSource`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node client/src/graph/resolve.test.js`
Expected: FAIL — `SyntaxError: The requested module './resolve.js' does not provide an export named 'findFreeSource'`.

- [ ] **Step 3: Implement in `resolve.js`**

Replace `findWiredTextNode` (currently at :159) with:

```js
// The node supplying Free mode's list. A wired text output wins outright; only when
// none is wired does a prompt node stand in. Precedence rather than lowest-Y across
// both kinds: an existing Free graph with a context prompt sitting above its text
// output would otherwise silently change which node supplies the list, and a batch
// built from the wrong text is only noticed after it has been paid for. Lowest Y
// breaks ties within a kind, matching buildRequest's ordering.
export function findFreeSource(nodes, edges, outputId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const wired = edges
    .filter((e) => e.target === outputId)
    .map((e) => byId.get(e.source))
    .filter(Boolean)
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0));
  return wired.find(isTextOutput) || wired.find((n) => n.type === 'prompt');
}

// Free mode's list, as text. A text output's answer is taken verbatim -- never
// re-scanned for @tokens, per resolveRef's rule. A prompt node holds what the user
// typed, so its @ids are substituted first: an unexpanded @p-123 would otherwise
// reach the splitter as a literal token and travel to the model that way.
export function freeSourceText(node, nodes) {
  if (!node) return '';
  if (isTextOutput(node)) return node.data?.result || '';
  const refs = new Map(
    nodes.filter((n) => n.type === 'prompt' || isTextOutput(n)).map((n) => [n.id, n]),
  );
  // Seeded with the source's own id so @itself throws Circular instead of recursing,
  // the same guard resolveRef applies.
  return substitute(node.data?.text, refs, [node.id]);
}
```

Then replace the body of `freeRunPrompts` (currently at :175) with a `freeShared` extraction — the preview dialog needs the shared context on its own, and computing it twice is how the two would eventually disagree:

```js
// Everything wired into the output EXCEPT the list source -- the context every Free run
// receives. Asking buildRequest for the graph with the source blanked (rather than
// subtracting its text from the joined prompt) is what keeps a blank line inside the
// list, or an @id reference to the source itself, from smuggling the whole list back in.
// BOTH text and result are blanked, so this works whichever kind of node the source is:
// known-and-empty is the intent, and an absent node would leave the @token itself in
// the prompt.
export function freeShared(nodes, edges, outputId, sourceId) {
  return buildRequest(
    nodes.map((n) => (n.id === sourceId ? { ...n, data: { ...n.data, text: '', result: '' } } : n)),
    edges,
    outputId,
  ).prompt;
}

// One prompt per Free-mode block: the shared context, then the block after a blank line.
export function freeRunPrompts(nodes, edges, outputId, sourceId, blocks) {
  const shared = freeShared(nodes, edges, outputId, sourceId);
  return blocks.map((b) => [shared, b].filter(Boolean).join('\n\n'));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — `resolve.js: all checks passed`, plus the server suites. `ImageOutputNode.jsx` still imports the deleted `findWiredTextNode`; that is Task 2 and does not affect `npm test`, which never loads JSX.

- [ ] **Step 5: Commit**

```bash
git add client/src/graph/resolve.js client/src/graph/resolve.test.js
git commit -m "Let Free mode's list come from a prompt node, not only a text output"
```

---

### Task 2: Wire the prompt-node source into the image output node

**Files:**
- Modify: `client/src/nodes/ImageOutputNode.jsx` (import :16, `liveWiredTextNode` :140-144, `onGenerate`'s Free branch :196-203, button `isDisabled` :403, hint :414-419)

**Interfaces:**
- Consumes: `findFreeSource`, `freeSourceText`, `isTextOutput` from Task 1.
- Produces: no new exports. Free mode is usable with a prompt node wired in.

- [ ] **Step 1: Update the import**

In `client/src/nodes/ImageOutputNode.jsx:16`:

```js
import { buildRequest, splitSections, findFreeSource, freeSourceText, freeRunPrompts, isTextOutput } from '../graph/resolve.js';
```

- [ ] **Step 2: Rename the live twin**

Replace lines 140-144 (the `liveWiredTextNode` block):

```js
  // Render-time twin of findFreeSource(): getNodes()/getEdges() are stable function
  // references, so React has no way to know an edge changed and won't re-render this
  // warning on its own. useNodes()/useEdges() subscribe to canvas state, so the hint
  // appears and disappears live as wiring changes.
  const liveFreeSource = findFreeSource(liveNodes, liveEdges, id);
```

Then replace both remaining uses: `isDisabled={isRunning || (freeRuns && !liveFreeSource)}` on the Button, and `{freeRuns && !liveFreeSource && (` on the StatusLine.

- [ ] **Step 3: Read the list from either kind of node**

Replace lines 196-203 inside `onGenerate` (the `if (freeRuns) {` opening through the second guard) with:

```js
      if (freeRuns) {
        const source = findFreeSource(getNodes(), getEdges(), id);
        if (!source) {
          throw new Error('Free needs a prompt or text node wired in. It lists what to generate.');
        }
        // A prompt node's @ids are expanded here, before splitting -- see freeSourceText.
        let listText = freeSourceText(source, getNodes()).trim();
        if (!listText) {
          throw new Error(
            isTextOutput(source)
              ? 'The text node has no result yet. Run it first.'
              : 'The prompt node is empty. It lists what to generate.',
          );
        }
```

Inside that branch, the existing code still refers to `textNode`. Replace those three references:
- `splitSections(textNode.data.result)` becomes `splitSections(listText)`
- `textNode.data.result` in the repair prompt's last array element becomes `listText`
- `model: textNode.data.model || undefined` becomes `model: isTextOutput(source) ? source.data.model || undefined : undefined` — a prompt node has no model of its own, so repair falls to the server's configured text model
- `const fallback = textNode.data.result.trim();` becomes `const fallback = listText;` (already trimmed)
- `freeRunPrompts(getNodes(), getEdges(), id, textNode.id, blocks)` becomes `freeRunPrompts(getNodes(), getEdges(), id, source.id, blocks)`

- [ ] **Step 4: Update the hint copy**

Replace the StatusLine body at :414-419:

```js
        {freeRuns && !liveFreeSource && (
          <StatusLine type="info">
            Wire a prompt or text node in. Each item turns into one generation
            <br />
            — a &quot;---&quot; separated list, or prose a text model can split.
          </StatusLine>
        )}
```

- [ ] **Step 5: Verify in the running app**

Start the app: `npm run dev`. Then:
1. Add a prompt node, type two items separated by a line containing only `---`, wire it into an image output node, switch Runs to **Free**.
2. Generate must be **enabled** (it was disabled before this task) and the hint gone.
3. Click Generate. Expect two images and no repair-cost line (the list already had `---`, so no repair call).
4. Replace the prompt text with prose asking for two variations of one subject, no `---`. Generate. Expect a repair cost in the footer, the note `re-split into 2 sections`, and two different images.
5. Wire a text output node in **above** the prompt node, run it so it has a result, and confirm the text output takes precedence (its result drives the batch, not the prompt node).

- [ ] **Step 6: Commit**

```bash
git add client/src/nodes/ImageOutputNode.jsx
git commit -m "Accept a prompt node as Free mode's list source"
```

---

### Task 3: Per-run image directives (pure)

**Files:**
- Modify: `client/src/graph/resolve.js` (extract the reference mapping out of `buildRequest` at :98-103, add three exports)
- Test: `client/src/graph/resolve.test.js`

**Interfaces:**
- Consumes: `bucketSources`, `splitSections`, `freeRunPrompts`, `freeShared` from this module.
- Produces:
  - `parseImagePicks(block) -> { text: string, picks: number[] | null }`
  - `runReferences(nodes, edges, outputId, picks) -> { input_references: object[], used: number[] | null, dropped: number[] }`
  - `freeBatch(nodes, edges, outputId, sourceId, listText, max = 10) -> { runs: [{ prompt, input_references, used, dropped }], truncated: number, shared: string }`

- [ ] **Step 1: Write the failing tests**

Append to `client/src/graph/resolve.test.js`, before the final `console.log` line:

```js
// --- parseImagePicks ---

// A section may open with a line naming which wired images it uses. The line is stripped
// from the prompt: the provider must never see the bookkeeping.
{
  const { text, picks } = parseImagePicks('images: 2, 5\nA hand, palm forward');
  assert.deepEqual(picks, [2, 5]);
  assert.equal(text, 'A hand, palm forward', 'the directive line is stripped from the prompt');
}

// Singular form, spaces instead of commas, leading blank lines, and a repeat.
{
  assert.deepEqual(parseImagePicks('\n\n image : 3 1 3 \nprose').picks, [3, 1], 'order preserved, duplicates collapsed');
}

// Recognised on the FIRST non-empty line only: prose saying "images: ..." halfway down
// a section must not silently reduce what that run sends.
{
  const { text, picks } = parseImagePicks('A hand\nimages: 2, 5');
  assert.equal(picks, null, 'only the first non-empty line can be a directive');
  assert.equal(text, 'A hand\nimages: 2, 5', 'and it stays in the prompt untouched');
}

// No directive at all -> null, meaning every image.
{
  assert.equal(parseImagePicks('just prose').picks, null);
}

// A directive line with no usable numbers degrades to "every image", line still stripped.
{
  const { text, picks } = parseImagePicks('images: none of them\nprose');
  assert.equal(picks, null);
  assert.equal(text, 'prose');
}

// --- runReferences ---

const img = (i, y) => ({ id: `i${i}`, type: 'image', position: { x: 0, y }, data: { dataUrl: `data:image/png;base64,IMG${i}` } });

{
  const vid = { id: 'v1', type: 'video', position: { x: 0, y: 99 }, data: { dataUrl: 'data:video/mp4;base64,VID' } };
  const { nodes, edges } = graph([img(1, 0), img(2, 10), img(3, 20), vid], [
    { id: 'e1', source: 'i1', target: 'out' },
    { id: 'e2', source: 'i2', target: 'out' },
    { id: 'e3', source: 'i3', target: 'out' },
    { id: 'e4', source: 'v1', target: 'out' },
  ]);

  // No directive -> byte-for-byte what buildRequest sends today. This is the assertion
  // that pins "not asking for a split still gets everything".
  const all = runReferences(nodes, edges, 'out', null);
  assert.deepEqual(all.input_references, buildRequest(nodes, edges, 'out').input_references);
  assert.equal(all.used, null);
  assert.deepEqual(all.dropped, []);

  // A directive picks by badge number, IN THE ORDER IT LISTED THEM -- that order is what
  // "image 1" means inside the section's prose, since the provider only sees attachments.
  const picked = runReferences(nodes, edges, 'out', [3, 1]);
  assert.deepEqual(picked.used, [3, 1]);
  assert.deepEqual(
    picked.input_references.map((r) => r.image_url?.url ?? r.video_url.url),
    ['data:image/png;base64,IMG3', 'data:image/png;base64,IMG1', 'data:video/mp4;base64,VID'],
    'picked images in listed order, videos appended untouched',
  );

  // An out-of-range number is dropped and reported; the rest of the directive still runs.
  const partial = runReferences(nodes, edges, 'out', [2, 9]);
  assert.deepEqual(partial.used, [2]);
  assert.deepEqual(partial.dropped, [9]);
  assert.equal(partial.input_references.length, 2, 'one picked image plus the video');

  // Every number out of range -> fall back to every image rather than a run with none.
  const none = runReferences(nodes, edges, 'out', [8, 9]);
  assert.equal(none.used, null);
  assert.deepEqual(none.dropped, [8, 9]);
  assert.equal(none.input_references.length, 4);
}

// --- freeBatch ---

// The seam the preview dialog and Generate share: one call turns list text into the exact
// runs that will be sent. A preview deriving its rows any other way is how a preview
// starts lying about what it is previewing.
{
  const src = { id: 'p-list', type: 'prompt', position: { x: 0, y: 50 }, data: { text: '' } };
  const ctx = { id: 'p-ctx', type: 'prompt', position: { x: 0, y: 5 }, data: { text: 'shared style' } };
  const { nodes, edges } = graph([ctx, src, img(1, 0), img(2, 10)], [
    { id: 'e0', source: 'p-ctx', target: 'out' },
    { id: 'e1', source: 'p-list', target: 'out' },
    { id: 'e2', source: 'i1', target: 'out' },
    { id: 'e3', source: 'i2', target: 'out' },
  ]);
  const { runs, truncated, shared } = freeBatch(nodes, edges, 'out', 'p-list', 'images: 2\nfirst\n---\nsecond');
  assert.equal(truncated, 0);
  assert.equal(shared, 'shared style');
  assert.equal(runs.length, 2);
  assert.equal(runs[0].prompt, 'shared style\n\nfirst', 'the directive line never reaches the model');
  assert.deepEqual(runs[0].used, [2]);
  assert.equal(runs[0].input_references.length, 1);
  assert.equal(runs[1].used, null, 'a section without a directive gets every image');
  assert.equal(runs[1].input_references.length, 2);
}

// The 10-run cap still applies through freeBatch, and reports what it dropped.
{
  const src = { id: 'p-list', type: 'prompt', position: { x: 0, y: 0 }, data: { text: '' } };
  const { nodes, edges } = graph([src], [{ id: 'e1', source: 'p-list', target: 'out' }]);
  const many = Array.from({ length: 12 }, (_, i) => `item ${i}`).join('\n---\n');
  const { runs, truncated } = freeBatch(nodes, edges, 'out', 'p-list', many);
  assert.equal(runs.length, 10);
  assert.equal(truncated, 2);
}
```

Update the import on line 3 to add the three names:

```js
import { buildRequest, bucketSources, sourceRoles, splitSections, findFreeSource, freeSourceText, freeShared, freeRunPrompts, parseImagePicks, runReferences, freeBatch, isOutput, isTextOutput } from './resolve.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node client/src/graph/resolve.test.js`
Expected: FAIL — `does not provide an export named 'parseImagePicks'`.

- [ ] **Step 3: Implement in `resolve.js`**

First extract the mapping out of `buildRequest`. Add above `buildRequest`:

```js
// Media nodes -> the array the API takes. Shared by buildRequest and runReferences so a
// new reference kind cannot be added to one and silently forgotten in the other.
function toReferences(media) {
  return media.map((n) =>
    n.type === 'video'
      ? { type: 'video_url', video_url: { url: n.data.dataUrl } }
      : { type: 'image_url', image_url: { url: n.data.dataUrl } },
  );
}
```

and in `buildRequest` replace the `const input_references = references.map(...)` block (:98-103) with:

```js
  const input_references = toReferences(references);
```

Then append the three new exports after `splitSections`:

```js
// A section may open with a line naming which wired images it uses -- `images: 2, 5`, the
// badge numbers sourceRoles already puts on the canvas, so what the user sees is what the
// directive means. Recognised on the FIRST non-empty line only: prose reading
// "images: three of them" halfway down a section must not silently reduce what that run
// sends. picks is null when there is no directive, meaning every image -- the behaviour
// every run had before directives existed, and what a text model that ignores the syntax
// falls back to.
const PICKS_RE = /^images?\s*:\s*(.+)$/i;

export function parseImagePicks(block) {
  const lines = String(block || '').split('\n');
  const at = lines.findIndex((l) => l.trim() !== '');
  if (at === -1) return { text: '', picks: null };
  const m = lines[at].trim().match(PICKS_RE);
  if (!m) return { text: String(block).trim(), picks: null };
  const picks = [
    ...new Set(
      m[1]
        .split(/[,\s]+/)
        .map((t) => Number(t))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  // The line is stripped even when it named nothing usable: it is bookkeeping either way,
  // and an empty pick list means the same as no directive.
  return { text: lines.slice(at + 1).join('\n').trim(), picks: picks.length ? picks : null };
}

// One run's input_references. `picks` are directive numbers; null means every wired
// reference, which is what a section without a directive gets. Picked images come first,
// in the order the directive listed them -- that order is what "image 1" means inside that
// section's prose, since the provider only ever sees the attachments it is handed. Videos
// are appended untouched: an image output already warns that it sends and ignores them,
// and a directive numbers images only.
export function runReferences(nodes, edges, outputId, picks) {
  const { references } = bucketSources(nodes, edges, outputId);
  if (!picks) return { input_references: toReferences(references), used: null, dropped: [] };
  const images = references.filter((n) => n.type === 'image');
  const videos = references.filter((n) => n.type !== 'image');
  const used = picks.filter((n) => images[n - 1]);
  const dropped = picks.filter((n) => !images[n - 1]);
  // Every number named an image that is not wired. Falling back to all of them keeps a
  // garbled directive costing one text call to fix rather than a paid run with no
  // reference at all; `dropped` is what the caller reports.
  if (!used.length) return { input_references: toReferences(references), used: null, dropped };
  return {
    input_references: toReferences([...used.map((n) => images[n - 1]), ...videos]),
    used,
    dropped,
  };
}

// The whole of Free mode after the list text is in hand: split, read each section's
// directive, assemble prompts, pick each run's references. ONE seam, because the preview
// dialog derives its rows from this same call -- a preview that assembled its own view of
// the batch would eventually disagree with what gets sent, which is the one thing a
// preview must never do.
export function freeBatch(nodes, edges, outputId, sourceId, listText, max = 10) {
  const { blocks, truncated } = splitSections(listText, max);
  const parsed = blocks.map(parseImagePicks);
  const prompts = freeRunPrompts(nodes, edges, outputId, sourceId, parsed.map((p) => p.text));
  return {
    runs: prompts.map((prompt, i) => ({
      prompt,
      ...runReferences(nodes, edges, outputId, parsed[i].picks),
    })),
    truncated,
    shared: freeShared(nodes, edges, outputId, sourceId),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — `resolve.js: all checks passed` plus the server suites.

- [ ] **Step 5: Commit**

```bash
git add client/src/graph/resolve.js client/src/graph/resolve.test.js
git commit -m "Read per-run image directives out of a Free mode list"
```

---

### Task 4: Send per-run references, and teach the repair model the syntax

**Files:**
- Modify: `client/src/nodes/ImageOutputNode.jsx` (import :16, `onGenerate` :190-330)

**Interfaces:**
- Consumes: `freeBatch` from Task 3, `bucketSources` from `resolve.js`.
- Produces: `onGenerate` now builds `batch` — an array of `{ prompt, input_references, used, dropped }` — and fires one `generate()` per entry with **that entry's** references. Task 5 depends on this shape and on the `fire(batch, batchId)` extraction below.

- [ ] **Step 1: Update the import**

```js
import { buildRequest, splitSections, findFreeSource, freeSourceText, freeBatch, bucketSources, isTextOutput } from '../graph/resolve.js';
```

`freeRunPrompts` is no longer called from this file — `freeBatch` composes it.

- [ ] **Step 2: Add the directive clauses to the repair prompt**

Inside the `if (splitSections(listText).blocks.length < 2)` branch, immediately before the `const repaired = await runText({` call, insert:

```js
          // The count is known here and nowhere else: the model cannot see the canvas, so
          // "images 1 to 8" has to be stated or it invents numbers. Zero wired images
          // means the directive clauses are noise, so they are left out entirely.
          const imageCount = bucketSources(getNodes(), getEdges(), id)
            .references.filter((n) => n.type === 'image').length;
          const ask = [
            'Rewrite the text below as image prompts, one per image, separated by lines containing only ---.',
            '',
            'Each section must read as a complete prompt on its own: repeat the shared subject and style rather than referring back to another section.',
            'If the text asks for several versions or variations of one subject, write that many sections, each describing a different specific variation, and drop the count itself ("3 versions of a fox" becomes three sections, each describing one fox).',
            'Never emit the same section twice.',
            'If the text describes a single image with no variations implied, return it unchanged.',
            'No preamble, no numbering, no commentary.',
          ];
          if (imageCount > 0) {
            ask.push(
              '',
              `${imageCount} reference image${imageCount > 1 ? 's are' : ' is'} attached, numbered 1 to ${imageCount}.`,
              'If the text says which of them a section should use, begin that section with a line reading "images: " followed by their numbers, for example "images: 1, 4". Omit that line when a section should receive all of them.',
              'Inside a section, refer to the images you named by their position in that line: the first number you list is "image 1" for that section, the second is "image 2". Rewrite the text\'s own image numbers to match.',
            );
          }
          ask.push('', listText);
```

Then replace the `prompt:` value of the `runText` call with `prompt: ask.join('\n'),`, deleting the inline array that is there now. Keep the existing comment above the call — it records why the original clauses are load-bearing.

- [ ] **Step 3: Build a batch instead of a prompt list**

In the repair branch, replace the `const again = splitSections(repaired.text); if (again.blocks.length > 1) { blocks = again.blocks; ... }` block and the `if (blocks.length === 0)` fallback that follows it with:

```js
          const again = splitSections(repaired.text);
          if (again.blocks.length > 1) {
            listText = repaired.text;
            notes.push(`re-split into ${again.blocks.length} sections`);
          } else {
            notes.push('no sections found, running as a single generation');
          }
        }

        const built = freeBatch(getNodes(), getEdges(), id, source.id, listText);
        // A list made of nothing but separators splits to zero sections. Saying so beats
        // the old fall-back-to-one-run, which spent money on the shared context alone.
        if (!built.runs.length) throw new Error('That list has no sections to run.');
        if (built.truncated) {
          notes.push(`list had ${built.runs.length + built.truncated} items, running the first ${built.runs.length}`);
        }
        const missing = [...new Set(built.runs.flatMap((r) => r.dropped))].sort((a, b) => a - b);
        if (missing.length) notes.push(`no image ${missing.join(', ')} wired`);
        batch = built.runs;
      } else {
        batch = Array.from({ length: runs }, () => ({ prompt, input_references }));
      }
```

Rename the declaration above the `if (freeRuns)` from `let prompts;` to `let batch;`, and delete the now-dead `let { blocks, truncated } = splitSections(...)` line, replacing it with the plain repair test:

```js
        if (splitSections(listText).blocks.length < 2) {
```

- [ ] **Step 4: Extract `fire()` and send each run its own references**

Replace everything from `setNote(notes.length ? ... )` through the end of `onGenerate`'s `try` block with:

```js
      setNote(notes.length ? notes.join(' · ') : null);
      await fire(batch, batchId);
```

Then add `fire` as a sibling function of `onGenerate`, above it:

```js
  // The paid half of a run, split out so the preview gate can sit between building a
  // batch and sending it -- and so confirming a preview reuses this exact code rather
  // than a second copy that drifts. The caller owns `status`, the `running` marker and
  // the cleared results; fire() owns the requests and the settlement.
  async function fire(batch, batchId) {
    // Captured before anything is awaited, same reasoning as onGenerate's copy: a write
    // after an await reaches whichever project is CURRENTLY loaded, never this one.
    const startedIn = getProject();
    setTotal(batch.length);
    try {
      const settled = await Promise.allSettled(
        batch.map((run, i) =>
          generate({
            prompt: run.prompt,
            input_references: run.input_references,
            model,
            resolution: supported(resolutionTiers, data.resolution),
            quality: supported(qualities, data.quality),
            aspect_ratio: supported(ratios, data.aspect_ratio),
            background: supported(backgrounds, data.background),
            batchId,
            runIndex: i + 1,
            runCount: batch.length,
          }).then((resp) => {
            if (getProject() !== startedIn) return resp;
            setDone((d) => d + 1);
            const withIndex = { ...resp, runIndex: i };
            setResults((r) => [...r, withIndex]);
            updateNodeData(id, (node) => ({
              results: [
                ...(node.data.results || []),
                { url: withIndex.url, savedPath: withIndex.savedPath, cost: withIndex.cost, runIndex: withIndex.runIndex },
              ],
            }));
            return resp;
          }),
        ),
      );

      if (getProject() !== startedIn) {
        updateNodeData(id, { running: undefined });
        return;
      }

      const failures = settled.filter((s) => s.status === 'rejected').map((s) => s.reason?.message || 'failed');
      const ok = settled.length - failures.length;
      if (failures.length) {
        setError(`${ok} of ${settled.length} succeeded. ${[...new Set(failures)].join('; ')}`);
        setStatus(ok ? 'partial' : 'error');
      } else {
        setStatus('done');
      }
      updateNodeData(id, { running: undefined });
    } catch (err) {
      if (getProject() !== startedIn) {
        updateNodeData(id, { running: undefined });
        return;
      }
      setError(err.message);
      setStatus('error');
      updateNodeData(id, { running: undefined });
    }
  }
```

Keep the long comments already on the result handler and both project guards — move them across verbatim; they record failures that cost real money to find.

`onGenerate`'s own `try/catch` stays and now covers only the build half (`buildRequest`, `freeSourceText`, the `runText` repair call, `freeBatch`). Delete `setTotal(null)`'s stale-total comment only if you also delete the line — it is still correct, since the count is unknown until the build finishes.

- [ ] **Step 5: Verify in the running app**

`npm run dev`, then:
1. Wire three image nodes plus a prompt node into an image output. Note the badge numbers on each image node.
2. In the prompt node, type a two-section list with explicit directives and no prose ambiguity:
   ```
   images: 2
   a close crop of the subject, dramatic light
   ---
   images: 1, 3
   the two subjects side by side
   ```
3. Free, Generate. Expect two generations, no repair cost (the `---` is already there).
4. Read the sidecars in the output folder: run 1's JSON must list **one** reference, run 2's must list **two**. This is the assertion that matters — it is what you are no longer paying for.
5. Change a directive to `images: 9` and Generate again. Expect the note `no image 9 wired` and that run receiving every image rather than none.
6. Now type prose asking for one image per wired reference with no `---`, and confirm the repair model emits `images:` lines. If it does not, that is prompt-tuning, and Task 5 makes iterating on it free.

- [ ] **Step 6: Commit**

```bash
git add client/src/nodes/ImageOutputNode.jsx
git commit -m "Give each Free run only the images its section asked for"
```

---

### Task 5: The "View final prompt" gate

**Files:**
- Create: `client/src/nodes/FreePreviewDialog.jsx`
- Modify: `client/src/nodes/ImageOutputNode.jsx` (imports, staged state, preview gate in `onGenerate`, confirm handler, checkbox under `RunsControl`, dialog mount)

**Interfaces:**
- Consumes: `fire(batch, batchId)` and the `batch` shape from Task 4; `freeBatch` from Task 3.
- Produces: `<FreePreviewDialog staged derive onCancel onConfirm />` where `staged` is `{ listText, notes, batchId }`, `derive(text) -> { runs, truncated, shared, error }`, and `onConfirm(text)` receives the possibly-edited list text.

- [ ] **Step 1: Create the dialog**

```jsx
import { useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack, HStack } from '@astryxdesign/core/Stack';
import StatusLine from './StatusLine.jsx';

/**
 * What Free mode is about to send, before a single image is paid for.
 *
 * The textarea holds the LIST TEXT -- sections, their --- separators and their `images:`
 * directives -- and every row below it is derived from that text by the same freeBatch()
 * call Generate uses. One source of truth on purpose: a preview that assembled its own
 * rows would eventually disagree with what gets sent, which is the one thing a preview
 * must never do.
 *
 * Edits are deliberately transient. They are not written back to the source node, whose
 * text or result must keep saying what the model actually produced.
 */
export default function FreePreviewDialog({ staged, derive, onCancel, onConfirm }) {
  const [text, setText] = useState(staged.listText);
  const { runs, truncated, shared, error } = derive(text);

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onCancel()} purpose="form" width={640}>
      <DialogHeader
        title="Final prompt"
        subtitle={
          error
            ? 'This list cannot be assembled yet.'
            : `${runs.length} generation${runs.length === 1 ? '' : 's'}. Nothing has been sent yet.`
        }
      />
      <VStack gap={3} padding={4}>
        {shared && (
          <VStack gap={1}>
            <Text type="label" color="secondary">Shared by every run</Text>
            {/* Read-only: it comes from the other wired nodes, not from this list. Each
                run is this text, a blank line, then its own section. */}
            <Text type="supporting" color="secondary">{shared}</Text>
          </VStack>
        )}

        <VStack gap={1}>
          <Text type="label" as="label" color="secondary">Sections</Text>
          <TextArea
            label="List text"
            isLabelHidden
            rows={12}
            hasSpellCheck={false}
            value={text}
            onChange={(v) => setText(v)}
          />
        </VStack>

        {error ? (
          <StatusLine type="error">{error}</StatusLine>
        ) : (
          <VStack gap={1}>
            {/* How the directives were READ, not what was typed -- the whole point of
                looking. "all images" is what a section with no directive gets. */}
            {runs.map((run, i) => (
              <HStack key={i} gap={2}>
                <Text type="label" color="secondary">Run {i + 1}</Text>
                <Text type="label">{run.used ? `images ${run.used.join(', ')}` : 'all images'}</Text>
              </HStack>
            ))}
            {truncated > 0 && (
              <StatusLine type="warning">
                {truncated} more section{truncated === 1 ? '' : 's'} beyond the 10-run cap will not run.
              </StatusLine>
            )}
          </VStack>
        )}

        {staged.notes.length > 0 && <StatusLine type="info">{staged.notes.join(' · ')}</StatusLine>}

        <HStack gap={2} justify="end">
          <Button label="Cancel" variant="ghost" onClick={onCancel} />
          <Button
            label={`Generate ${runs.length}×`}
            variant="primary"
            isDisabled={Boolean(error) || runs.length === 0}
            onClick={() => onConfirm(text)}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add the imports and state to `ImageOutputNode.jsx`**

```js
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import FreePreviewDialog from './FreePreviewDialog.jsx';
```

and alongside the other `useState` calls:

```js
  // A built-but-unsent batch, waiting on the preview dialog. Component state, not node
  // data: it is transient, and autosaving a prompt blob into graph.json on every edit is
  // exactly what the results pointer exists to avoid. Losing it on unmount costs nothing
  // but the text call already made.
  const [staged, setStaged] = useState(null);
```

- [ ] **Step 3: Stage instead of firing when the checkbox is on**

In `onGenerate`, replace the two lines added in Task 4 (`setNote(...)` and `await fire(batch, batchId)`) with:

```js
      setNote(notes.length ? notes.join(' · ') : null);
      if (freeRuns && data.previewPrompt) {
        // The marker and the spinner both have to come back off: leaving them set would
        // freeze Generate behind its own disabled guard with nothing in flight.
        setStaged({ listText, notes, batchId });
        setStatus('idle');
        updateNodeData(id, { running: undefined });
        return;
      }
      await fire(batch, batchId);
```

`listText` is in scope only inside the `if (freeRuns)` branch — hoist its declaration to just above `let batch;` as `let listText = '';` and assign inside the branch.

- [ ] **Step 4: Add derive and confirm handlers**

Above the render, after `fire`:

```js
  // The dialog's live rows and its confirm both go through freeBatch, so what is shown
  // and what is sent cannot diverge. Errors are returned rather than thrown: a circular
  // @reference typed mid-edit must grey the button out, not blank the dialog.
  function derivePreview(text) {
    const source = findFreeSource(getNodes(), getEdges(), id);
    if (!source) return { runs: [], truncated: 0, shared: '', error: 'The list source is no longer wired in.' };
    try {
      return { ...freeBatch(getNodes(), getEdges(), id, source.id, text), error: null };
    } catch (err) {
      return { runs: [], truncated: 0, shared: '', error: err.message };
    }
  }

  async function onConfirmPreview(text) {
    const { runs: built, error: bad } = derivePreview(text);
    if (bad || !built.length) {
      setError(bad || 'That list has no sections to run.');
      setStatus('error');
      setStaged(null);
      return;
    }
    // Reuses the staged batchId, so the repair call's text sidecar and these images stay
    // summable as one batch -- the reason a batch has an id at all.
    const batchId = staged.batchId;
    setStaged(null);
    setStatus('running');
    setError(null);
    setResults([]);
    updateNodeData(id, {
      results: undefined,
      running: { startedAt: Date.now(), session: SESSION_ID },
    });
    setDone(0);
    await fire(built, batchId);
  }
```

- [ ] **Step 5: Add the checkbox and mount the dialog**

Inside the `Runs` `VStack`, directly after `<RunsControl ... />`:

```js
          {freeRuns && (
            <CheckboxInput
              label="View final prompt"
              value={Boolean(data.previewPrompt)}
              onChange={(on) => updateNodeData(id, { previewPrompt: on })}
            />
          )}
```

And at the end of the component's returned tree, as the last child of the outer `<Card>`:

```js
      {/* Keyed by batchId so a second staging mounts a FRESH dialog: its textarea seeds
          from staged.listText once, and React Flow's habit of reusing an instance for a
          node id is exactly how a stale draft would survive into the next preview. */}
      {staged && (
        <FreePreviewDialog
          key={staged.batchId}
          staged={staged}
          derive={derivePreview}
          onCancel={() => setStaged(null)}
          onConfirm={onConfirmPreview}
        />
      )}
```

- [ ] **Step 6: Record that `previewPrompt` is not a model param**

In `client/src/nodes/output/defaults.js`, extend the existing "NOT here on purpose" comment above `MODEL_PARAM_KEYS`:

```js
// NOT here on purpose: runs/freeRuns/previewPrompt (batch size and how a batch is
// confirmed, not model traits), shareLocalVideos (consent about a wired clip),
// text/result/model itself.
```

And in `client/src/graph/resolve.test.js`, add `'previewPrompt'` to the `mustSurvive` array in the `MODEL_PARAM_KEYS` block, so switching models can never silently clear it.

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS. The `mustSurvive` assertion now also guards `previewPrompt`.

- [ ] **Step 8: Verify in the running app**

`npm run dev`, with three images and a prompt node wired into an image output in Free mode:
1. Tick **View final prompt**. Generate. Expect no image generated, the dialog open, one row per run, and a repair cost in the node footer if repair ran.
2. Confirm the rows read `images 2` / `all images` matching the directives in the textarea.
3. Edit a directive in the textarea to `images: 1, 3`. The row must update as you type, with no network call.
4. Cancel. Nothing generated, Generate re-enabled.
5. Generate again, then confirm with `Generate N×`. Expect exactly N images, and check the sidecars share one `batchId` with the repair call's text sidecar.
6. Reload the page. The checkbox must still be ticked (it lives in node data).
7. Untick it and Generate — the old path, straight to images.

- [ ] **Step 9: Commit**

```bash
git add client/src/nodes/FreePreviewDialog.jsx client/src/nodes/ImageOutputNode.jsx client/src/nodes/output/defaults.js client/src/graph/resolve.test.js
git commit -m "Add an opt-in preview of Free mode's assembled batch"
```

---

### Task 6: Documentation, changelog, and end-to-end verification

**Files:**
- Modify: `docs/models.md` (the `## Multi-run` section)
- Modify: `CHANGELOG.md`
- Modify: `status.md` (gitignored — local only)
- Delete: `docs/superpowers/plans/2026-08-18-free-mode-per-run-images.md`

**Interfaces:** none — this task ships no code.

Docs land in one task rather than being folded into each: `docs/models.md`'s Multi-run section needs a single coherent rewrite, and three overlapping edits to the same twenty lines would churn.

- [ ] **Step 1: Rewrite the Multi-run section of `docs/models.md`**

Replace the two paragraphs after `Cap is 10 everywhere.` with:

```markdown
Free mode takes the run count from the flow. Its list comes from the lowest-Y wired
**text output**, or — only when none is wired — the lowest-Y wired **prompt** node, whose
`@id` references are expanded before splitting. Precedence rather than lowest-Y across
both kinds: an existing Free graph with a context prompt above its text output would
otherwise silently change which node supplies the list, and a batch built from the wrong
text is only noticed after it is paid for. `splitSections` cuts the text on standalone
`---` lines; fewer than two blocks triggers one repair call through `/api/text`.

The repair prompt is load-bearing and is not a "split this up" instruction. Asked merely
to split, models copy the whole text N times: a real batch came back as three identical
prompts each still reading "3 versions of …", so every image rendered three subjects and
the run cost triple for one result. Two clauses earn their place — each section must read
as a complete prompt on its own, and a text that is not a list comes back untouched rather
than chopped into fragments that each bill as a generation.

**A section can name the images it uses.** `images: 2, 5` on a section's first line — the
badge numbers the canvas already shows — sends only those, and the line is stripped before
the prompt travels. No line means every image, which is what every run got before
directives existed, so a text model that ignores the syntax degrades to the old behaviour
rather than to a broken one. Within a section, a picked image is referred to by its
position in that line: the first listed is "image 1" for that run, because the provider
only ever sees the attachments it is handed. The repair prompt is told the attached count
and that renumbering rule; a hand-written text output emitting the same lines parses
identically. Out-of-range numbers are dropped and noted, and a directive whose numbers all
miss falls back to every image rather than a paid run with no reference at all.

One caveat the code cannot state: a *separate* prompt node that stays in the shared context
and refers to images by number can contradict a run's renumbering, since the shared text is
prepended verbatim. Let the list source own the image references.

`freeBatch` in `resolve.js` is the single seam from list text to the runs that get sent —
split, directive parse, prompt assembly, per-run references. The **View final prompt**
checkbox (Free only, `data.previewPrompt`) stages a built batch and opens a dialog that
derives its rows from that same call, so what is previewed cannot drift from what is sent;
confirming reuses the staged `batchId` and makes no second text call. It exists to make
prompt-tuning free and is expected to be removed once the repair prompt settles.
`freeRunPrompts`, `parseImagePicks`, `runReferences` and `freeBatch` have tests in
`resolve.test.js`, so extend them if insertion changes prompt assembly.
```

- [ ] **Step 2: Add a `CHANGELOG.md` entry**

Follow the format the file's own header states, dated 2026-08-18:

```markdown
- Free mode now works from a plain prompt node, not only a text output — wire prose in
  and the text model splits it into one prompt per image.
- A Free section can name which wired images it uses (`images: 2, 5` on its first line),
  so a nine-run batch no longer sends every reference to every run. No line still means
  every image.
- New **View final prompt** checkbox under Free: see the assembled sections, edit them,
  and check which images each run will get before anything is generated.
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all four suites.

- [ ] **Step 4: End-to-end verification in the running app**

`npm run dev`, and reproduce the graph this work came from: ten image nodes plus one prompt node into one image output, Free, **View final prompt** ticked. The prompt says to apply an effect to images 2–9 with image 1 as the reference, nine separate images.

1. Generate. Read the dialog: nine rows, each naming two images (the reference plus its target).
2. If the repair model's numbering is wrong, fix the textarea by hand, confirm the rows, and iterate on the repair clauses — each round costs one text call.
3. Confirm and let it run. Check nine sidecars, each listing exactly two references.
4. Untick the checkbox, set Runs to 3 fixed, Generate. Three identical-prompt runs with every image attached — the old path, unchanged.

- [ ] **Step 5: Update `status.md` and delete this plan**

`status.md` is gitignored, so this is local bookkeeping: tick off any todo this closed, and record under **Decided not to build** the rejected per-image toggle ("every run" / "one run each") with its reasoning — mechanical, and it asks the user to hold the distribution rule in their head while wiring. The spec keeps the full account; `status.md` is what stops it being re-proposed.

Then delete the plan, per `CLAUDE.md`: the code is the truth, the git log is the record, and a stale plan describing an intermediate state is a trap.

```bash
git rm docs/superpowers/plans/2026-08-18-free-mode-per-run-images.md
git add docs/models.md CHANGELOG.md
git commit -m "Document Free mode's prompt sources, image directives and preview"
```

- [ ] **Step 6: Open the PR**

Changes land by PR, never a direct push to `main` (`CLAUDE.md`). Confirm the right account first — `gh auth status`, and `gh auth switch --user teoaliano` if it is not active.

```bash
gh pr create --title "Free mode: prompt sources, per-run images, and a preview gate" --body "$(cat <<'EOF'
## Summary
- Free mode's list can come from a plain prompt node, not only a text output
- A section can name which wired images it uses; no directive still means every image
- New opt-in "View final prompt" dialog stages a batch before any image is paid for

Spec: `docs/superpowers/specs/2026-08-18-free-mode-per-run-images-design.md`

## Testing
- `npm test` (four suites)
- Verified in the running app: prompt-node source, per-run sidecars carrying only the
  named references, the preview dialog's live rows, and the unchanged fixed-runs path

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
