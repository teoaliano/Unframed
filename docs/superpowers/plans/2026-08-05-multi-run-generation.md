# Multi-Run Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One output node produces N images — N typed by the user, or decided by a wired-in text node that lists what to generate.

**Architecture:** `splitSections` (pure, in `resolve.js`) turns a text node's result into per-run prompt blocks; the output node fires the runs concurrently, each landing on the canvas as it finishes. Nothing new appears on the server for multi-run itself — N runs are N existing `/api/generate` calls — so the server work here is only the cost trail. Two review findings from sub-project 1 ride along: per-consumer image numbering, and sidecars for text runs.

**Tech Stack:** React 19 + `@xyflow/react` v12 (client, Vite), Express (server, single file), Astryx design system, OpenRouter API. Tests are assert-based self-checks run by `npm test` (no framework).

## Global Constraints

- **Cap: 10, one rule everywhere.** The Runs number input clamps to 1–10 on blur (typed `15` → `10`; `0` or empty → `1`). Free truncates at 10 and says `list had 14 items, running the first 10`.
- Node type ids stay `prompt`, `image`, `output`, `text`. Labels match ids.
- `resolve.js` stays pure: no React, no network, no new imports.
- **No generation spend during development.** Verify by stubbing `window.fetch` in the browser. The one exception is the final end-to-end check in Task 7, which the controller runs deliberately.
- Astryx rules (`client/.claude/CLAUDE.md`): components for layout, `var(--color-*)` / `var(--spacing-*)` tokens instead of raw hex/px. Check props with `cd client && npx astryx component <Name>` before using them — never guess a prop name.
- Model pickers label options by slug and sort alphabetically.
- The API key never returns to the browser beyond `keyHint`.
- Commit after every task. Do not push.
- Test with the `sandbox` project, never the user's real projects. Back up `output/sandbox/graph.json` before browser work and restore it after.

---

### Task 1: `splitSections` — turn one text result into per-run blocks

**Files:**
- Modify: `client/src/graph/resolve.js` (add export at end)
- Modify: `client/src/graph/resolve.test.js` (add cases)

**Interfaces:**
- Consumes: nothing
- Produces: `splitSections(text, max = 10) -> { blocks: string[], truncated: number }` — `blocks` are trimmed non-empty sections split on standalone `---` lines, capped at `max`; `truncated` is how many were dropped by the cap (0 when none).

- [ ] **Step 1: Write the failing tests**

Append to `client/src/graph/resolve.test.js`, before the final `console.log`:

```js
// --- splitSections ---
import { splitSections } from './resolve.js';

// Splits on standalone --- lines, trimming each block.
{
  const { blocks, truncated } = splitSections('one\n---\ntwo\n---\nthree');
  assert.deepEqual(blocks, ['one', 'two', 'three']);
  assert.equal(truncated, 0);
}

// Surrounding whitespace on the separator line is tolerated; empty blocks drop out.
{
  const { blocks } = splitSections('one\n  ---  \n\n---\n\ntwo\n');
  assert.deepEqual(blocks, ['one', 'two']);
}

// A --- inside a line of prose is not a separator.
{
  const { blocks } = splitSections('a --- b\n---\nc');
  assert.deepEqual(blocks, ['a --- b', 'c']);
}

// Text with no separator yields exactly one block — the caller decides what to do.
{
  const { blocks } = splitSections('just one long description');
  assert.deepEqual(blocks, ['just one long description']);
}

// Empty or whitespace-only input yields no blocks.
{
  assert.deepEqual(splitSections('').blocks, []);
  assert.deepEqual(splitSections('   \n\n  ').blocks, []);
}

// The cap truncates and reports how many were dropped.
{
  const many = Array.from({ length: 14 }, (_, i) => `layer ${i + 1}`).join('\n---\n');
  const { blocks, truncated } = splitSections(many);
  assert.equal(blocks.length, 10);
  assert.equal(blocks[9], 'layer 10');
  assert.equal(truncated, 4);
}

// A smaller cap is honoured (the caller passes 10 in production).
{
  const { blocks, truncated } = splitSections('a\n---\nb\n---\nc', 2);
  assert.deepEqual(blocks, ['a', 'b']);
  assert.equal(truncated, 1);
}
```

Move the new `import` to sit with the existing import at the top of the file — ESM hoists it either way, but keeping imports together is the file's existing style.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `SyntaxError` or `TypeError: splitSections is not a function`, because the export does not exist yet.

- [ ] **Step 3: Write the implementation**

Append to `client/src/graph/resolve.js`:

```js
// Split a text node's result into one block per run. The separator is a line that
// contains only "---", so a --- inside prose is left alone. `max` is the run cap;
// `truncated` lets the caller say "list had 14 items, running the first 10" instead
// of silently dropping the tail.
export function splitSections(text, max = 10) {
  const all = String(text || '')
    .split('\n')
    .reduce(
      (acc, line) => {
        if (line.trim() === '---') acc.push([]);
        else acc[acc.length - 1].push(line);
        return acc;
      },
      [[]],
    )
    .map((lines) => lines.join('\n').trim())
    .filter(Boolean);

  return { blocks: all.slice(0, max), truncated: Math.max(0, all.length - max) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — `resolve.js: all checks passed`

- [ ] **Step 5: Commit**

```bash
git add client/src/graph/resolve.js client/src/graph/resolve.test.js
git commit -m "Add splitSections for turning a text result into per-run blocks

Splits on lines containing only ---, so a --- inside prose stays put. Returns
the truncated count alongside the blocks so the caller can say what it dropped
rather than silently running the first ten."
```

---

### Task 2: `imageRefNumbers` — one rank per consuming node

The badge currently ranks an image against every image feeding any output-family node, and presents that as if it held for all consumers. It doesn't: with image A wired only to an output, and image B wired to both that output and a text node, B's badge reads `2` while the text node sees B as its image 1. `buildRequest` is already right (it filters edges per `outputId`), so this is a badge lie, not a bad request — but Layerize says "Look at image 1" about an image wired into a text node, so it has to be true.

**Files:**
- Modify: `client/src/graph/resolve.js:63-85` (replace `imageRefNumber`)
- Modify: `client/src/nodes/ImageNode.jsx:7,12,40-43`
- Modify: `client/src/graph/resolve.test.js` (replace the two `imageRefNumber` cases)

**Interfaces:**
- Consumes: nothing
- Produces: `imageRefNumbers(nodes, edges, imageId) -> number[]` — deduplicated, ascending ranks, one per consuming node. `[]` means not wired into any consumer (or no image loaded). `imageRefNumber` is removed; `ImageNode` is its only caller.

- [ ] **Step 1: Write the failing tests**

In `client/src/graph/resolve.test.js`, replace the existing `imageRefNumber` block (the case added in sub-project 1, asserting `1` for an image wired only into a text node and `null` for an unwired one) with:

```js
// --- imageRefNumbers ---

// An image wired only into a text node is rank 1 there.
{
  const t = { id: 't1', type: 'text', position: { x: 200, y: 0 }, data: { result: 'x' } };
  const i1 = { id: 'i1', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: 'data:,a' } };
  const nodes = [out, t, i1];
  const edges = [{ id: 'e1', source: 'i1', target: 't1' }];
  assert.deepEqual(imageRefNumbers(nodes, edges, 'i1'), [1]);
}

// An unwired image, and an image with no picture, have no ranks.
{
  const i1 = { id: 'i1', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: 'data:,a' } };
  const i2 = { id: 'i2', type: 'image', position: { x: 0, y: 10 }, data: {} };
  const nodes = [out, i1, i2];
  const edges = [{ id: 'e1', source: 'i2', target: 'out' }];
  assert.deepEqual(imageRefNumbers(nodes, edges, 'i1'), []);
  assert.deepEqual(imageRefNumbers(nodes, edges, 'i2'), []);
}

// Ranks are per consumer: A (y=0) and B (y=100) both feed the output, so B is 2 there;
// B alone feeds the text node, so it is 1 there. B's ranks are [1, 2].
{
  const t = { id: 't1', type: 'text', position: { x: 200, y: 0 }, data: { result: 'x' } };
  const a = { id: 'a', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: 'data:,a' } };
  const b = { id: 'b', type: 'image', position: { x: 0, y: 100 }, data: { dataUrl: 'data:,b' } };
  const nodes = [out, t, a, b];
  const edges = [
    { id: 'e1', source: 'a', target: 'out' },
    { id: 'e2', source: 'b', target: 'out' },
    { id: 'e3', source: 'b', target: 't1' },
  ];
  assert.deepEqual(imageRefNumbers(nodes, edges, 'a'), [1]);
  assert.deepEqual(imageRefNumbers(nodes, edges, 'b'), [1, 2]);
}

// The rank a consumer sees matches the order buildRequest sends for that same consumer.
{
  const t = { id: 't1', type: 'text', position: { x: 200, y: 0 }, data: { result: 'x' } };
  const a = { id: 'a', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: 'data:,a' } };
  const b = { id: 'b', type: 'image', position: { x: 0, y: 100 }, data: { dataUrl: 'data:,b' } };
  const nodes = [out, t, a, b];
  const edges = [{ id: 'e1', source: 'b', target: 't1' }, { id: 'e2', source: 'a', target: 't1' }];
  const { input_references } = buildRequest(nodes, edges, 't1');
  // a is above b, so a is image 1 for the text node
  assert.equal(input_references[0].image_url.url, 'data:,a');
  assert.deepEqual(imageRefNumbers(nodes, edges, 'a'), [1]);
  assert.deepEqual(imageRefNumbers(nodes, edges, 'b'), [2]);
}
```

Add `imageRefNumbers` to the file's existing import from `./resolve.js`, and drop `imageRefNumber` from it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `imageRefNumbers is not a function`.

- [ ] **Step 3: Write the implementation**

In `client/src/graph/resolve.js`, replace the entire `imageRefNumber` function (comment included) with:

```js
// The reference numbers an image node will be sent as, one per node consuming it
// (1-based, ascending, deduplicated). Empty when it has no picture or feeds nothing.
// Numbering is per consumer because that is how buildRequest sends them: an image can
// be image 1 to a text node and image 2 to an output node at the same time. Kept here
// so the node badge and buildRequest cannot disagree. `nodes`/`edges` are the live
// React Flow arrays.
export function imageRefNumbers(nodes, edges, imageId) {
  const self = nodes.find((n) => n.id === imageId);
  if (!self || self.type !== 'image' || !self.data?.dataUrl) return [];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const consumers = nodes.filter((n) => n.type === 'output' || n.type === 'text');
  const ranks = new Set();

  for (const consumer of consumers) {
    const images = edges
      .filter((e) => e.target === consumer.id)
      .map((e) => byId.get(e.source))
      .filter((n) => n && n.type === 'image' && n.data?.dataUrl)
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0));
    const idx = images.findIndex((n) => n.id === imageId);
    if (idx !== -1) ranks.add(idx + 1);
  }

  return [...ranks].sort((a, b) => a - b);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Update the badge**

In `client/src/nodes/ImageNode.jsx`, change the import:

```jsx
import { imageRefNumbers } from '../graph/resolve.js';
```

Replace the `num` line:

```jsx
  // Live numbers this image will be sent as, recomputed as connections/positions
  // change. One entry per consuming node — usually one, two when the same image is
  // image 1 to one target and image 2 to another. Empty = not wired anywhere.
  const nums = imageRefNumbers(useNodes(), useEdges(), id);
```

Replace the `status` line and the `NodeHeader` props:

```jsx
  const status = nums.length ? nums.join(' / ') : data.dataUrl ? 'not connected' : undefined;
```

```jsx
        right={status}
        rightTone={nums.length ? 'accent' : 'secondary'}
```

- [ ] **Step 6: Verify no callers of the old name remain**

Run: `grep -rn "imageRefNumber\b" client/src server`
Expected: no output. The `\b` will not match `imageRefNumbers` (the `s` is a word character, so there is no boundary there), so any hit is a genuine leftover call to the removed singular function.

- [ ] **Step 7: Commit**

```bash
git add client/src/graph/resolve.js client/src/graph/resolve.test.js client/src/nodes/ImageNode.jsx
git commit -m "Number images per consumer instead of globally

An image can be image 1 to a text node and image 2 to an output node at once.
The old single number claimed one rank held everywhere, which went wrong as soon
as text nodes started consuming edges — and Layerize's prompt says \"Look at
image 1\" about an image wired into a text node.

The badge shows \"1 / 2\" in the genuinely divergent case rather than silently
picking one."
```

---

### Task 3: The Runs control on the output node

**Files:**
- Modify: `client/src/nodes/OutputNode.jsx`
- Modify: `client/src/App.jsx` (starter graph `out` node data — add `runs: 1`)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `data.runs` (number, 1–10) and `data.freeRuns` (boolean) on output nodes. Task 4 reads both.

- [ ] **Step 1: Check the components' props before using them**

```bash
cd client && npx astryx component NumberInput 2>&1 | sed -n '/| Prop/,/^$/p'
cd client && npx astryx component Switch 2>&1 | sed -n '/| Prop/,/^$/p'
```

If `NumberInput` does not exist, use `TextInput` with `type="text"` and parse on change (its props are already known: `label`, `value`, `onChange`, `size`, `status`, `isDisabled`, `labelTooltip`). If `Switch` does not exist, use `Checkbox`; if neither, use two `Button`s acting as a segmented toggle. Record in your report which components you used and the CLI evidence.

- [ ] **Step 2: Add the clamp helper and the control**

In `client/src/nodes/OutputNode.jsx`, add above the component:

```js
const MAX_RUNS = 10;
// Typed input is clamped rather than rejected: 15 becomes 10, 0 or empty becomes 1.
const clampRuns = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_RUNS, Math.max(1, n));
};
```

Inside the component, derive the values with defaults so graphs saved before this change still work:

```js
  const freeRuns = Boolean(data.freeRuns);
  const runs = clampRuns(data.runs ?? 1);
```

Add the control to the JSX, in its own `HStack` directly below the existing Size / Quality / Ratio row:

```jsx
        <HStack gap={2} align="end">
          <TextInput
            label="Runs"
            size="sm"
            value={freeRuns ? '' : String(runs)}
            isDisabled={freeRuns}
            disabledMessage="Free mode decides the number from the flow"
            onChange={(v) => updateNodeData(id, { runs: v.replace(/[^\d]/g, '') })}
            onBlur={() => updateNodeData(id, { runs: clampRuns(data.runs) })}
          />
          <Button
            label="Free"
            size="sm"
            variant={freeRuns ? 'primary' : 'ghost'}
            tooltip="Free: the number of runs comes from the flow — a connected Text node lists what to generate, and each item becomes one image."
            onClick={() => updateNodeData(id, { freeRuns: !freeRuns })}
          />
        </HStack>
```

`TextInput` is used deliberately over a number input: the clamp-on-blur behaviour needs the raw string while typing, and `onChange` stripping non-digits keeps the field from ever holding junk. If Step 1 found a `NumberInput` with a `min`/`max`/`onBlur` combination that gives the same clamp semantics, prefer it and say so in your report.

Verify `TextInput` accepts `onBlur` (`cd client && npx astryx component TextInput | grep -i onblur`). If it does not, do the clamp inside `onChange` when the value is 2+ digits, and note the deviation.

- [ ] **Step 3: Seed the starter graph**

In `client/src/App.jsx`, the `out` node in `initialNodes` gets `runs: 1` in its `data`, beside `resolution`, `quality`, `aspect_ratio`. Leave `freeRuns` unset — absent is falsy, and an absent key keeps saved graphs smaller.

- [ ] **Step 4: Verify in the browser**

The client hot-reloads. In the `sandbox` project (back up `output/sandbox/graph.json` first):

1. The output node shows a `Runs` field reading `1` and a `Free` button.
2. Type `15`, click elsewhere → the field reads `10`. Type `0` → reads `1`. Clear it → reads `1`.
3. Click `Free` → the button goes primary and the Runs field greys out.
4. Hover `Free` → the tooltip explains where the number comes from.
5. Reload → both states persisted.
6. `read_console_messages` shows no errors.

Restore `output/sandbox/graph.json` afterwards.

- [ ] **Step 5: Commit**

```bash
git add client/src/nodes/OutputNode.jsx client/src/App.jsx
git commit -m "Add the Runs control to the output node

A number input clamped to 1-10 on blur, plus a Free toggle that hands the count
to the flow. Clamping rather than rejecting means a typed 15 becomes 10 instead
of erroring, and an absent data.runs still reads as 1 on graphs saved earlier."
```

---

### Task 4: Fire N runs — fixed count, progress, partial failure

**Files:**
- Modify: `client/src/nodes/OutputNode.jsx` (`onGenerate`, result rendering)

**Interfaces:**
- Consumes: `data.runs` / `data.freeRuns` from Task 3; the existing `generate(body)` from `api.js`
- Produces: `onGenerate` running N concurrent generations; `data.batchId` written per Generate click (Task 6 reads it server-side). Free mode is Task 5 — this task treats `freeRuns` as "1 run" so the code stays runnable between commits.

- [ ] **Step 1: Replace the single-result state with batch state**

Replace the `result` and `cost` state declarations with:

```js
  const [results, setResults] = useState([]); // [{ image, cost, savedPath }]
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(1);
```

Delete the now-unused `result` / `cost` state. `status` gains a `'partial'` value alongside `idle | running | done | error`. This step comes first so the file still parses once Step 2 references these setters.

- [ ] **Step 2: Replace the single-run body of `onGenerate`**

The current `onGenerate` sets `result`/`cost` state and adds one node. Replace its body (keeping the function name and the surrounding `try`/`catch` shape) with a batch runner:

```js
  async function onGenerate() {
    setStatus('running');
    setError(null);
    setResults([]);
    setDone(0);
    try {
      const { prompt, input_references } = buildRequest(getNodes(), getEdges(), id);
      if (!prompt.trim()) {
        throw new Error('Nothing connected. Wire a prompt node into this output node.');
      }

      // Free mode arrives in the next task; until then it means a single run.
      const prompts = [prompt];
      setTotal(prompts.length);

      // One id per Generate click, so a batch's sidecars can be summed later.
      const batchId = `b-${Date.now()}`;
      const settled = await Promise.allSettled(
        prompts.map((p, i) =>
          generate({
            prompt: p,
            input_references,
            model,
            resolution: data.resolution,
            quality: data.quality,
            aspect_ratio: data.aspect_ratio,
            batchId,
            runIndex: i + 1,
            runCount: prompts.length,
          }).then((resp) => {
            setDone((d) => d + 1);
            setResults((r) => [...r, resp]);
            placeResult(resp);
            return resp;
          }),
        ),
      );

      const failures = settled.filter((s) => s.status === 'rejected').map((s) => s.reason?.message || 'failed');
      const ok = settled.length - failures.length;
      if (failures.length) {
        setError(
          `${ok} of ${settled.length} succeeded. ${[...new Set(failures)].join('; ')}`,
        );
        setStatus(ok ? 'partial' : 'error');
      } else {
        setStatus('done');
      }
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }
```

`Promise.allSettled` is the point: one failed run must not discard the images that did arrive.

- [ ] **Step 3: Extract the placement logic**

The existing `onGenerate` body ends with the "drop the generated image onto the canvas" block. Move it verbatim into a helper inside the component so every run in the batch uses it:

```js
  // Drop a finished image onto the canvas as an image node so it can be wired back in
  // as input for the next generation. It goes to the right of the output node,
  // top-aligned; repeat results step down instead of stacking invisibly.
  function placeResult(resp) {
    const self = getNode(id);
    const pos = self?.position ?? { x: 0, y: 0 };
    const width = self?.measured?.width ?? 300;
    const spot = { x: pos.x + width + 40, y: pos.y };
    while (getNodes().some((n) => Math.hypot(n.position.x - spot.x, n.position.y - spot.y) < 24)) {
      spot.y += 48;
    }
    addNodes({
      id: `gen-${Date.now()}-${Math.round(spot.y)}`,
      type: 'image',
      dragHandle: '.xnode-head',
      position: spot,
      data: { fileName: resp.savedPath?.split('/').pop() || 'generated', dataUrl: resp.image },
    });
  }
```

The id gains the y offset because a concurrent batch can produce two results inside the same millisecond, and `gen-${Date.now()}` alone would collide.

- [ ] **Step 4: Update the button and the result area**

Button label reflects the count and progress:

```jsx
        <Button
          label={
            status === 'running'
              ? `Generating ${done} / ${total}…`
              : runs > 1 && !freeRuns
                ? `Generate ${runs} ×`
                : 'Generate'
          }
          variant="primary"
          isLoading={status === 'running'}
          onClick={onGenerate}
        />
```

The error `Text` renders for both failure states:

```jsx
        {(status === 'error' || status === 'partial') && (
          <Text type="supporting" color={status === 'partial' ? 'warning' : 'error'}>{error}</Text>
        )}
```

The result area shows every image from the batch with the summed cost beneath:

```jsx
        {results.length > 0 && (
          <VStack gap={1}>
            {results.map((r, i) => (
              <Thumbnail
                key={r.savedPath || i}
                className="xnode-thumb"
                src={r.image}
                alt={`generated result ${i + 1}`}
                label={`result ${i + 1}`}
              />
            ))}
            {results.some((r) => r.cost != null) && (
              <Text type="supporting" color="accent" hasTabularNumbers>
                ${results.reduce((sum, r) => sum + (Number(r.cost) || 0), 0).toFixed(4)}
                {results.length > 1 ? ` · ${results.length} images` : ''}
              </Text>
            )}
          </VStack>
        )}
```

- [ ] **Step 5: Verify with the network stubbed**

Back up `output/sandbox/graph.json`. In the browser, stub `/api/generate` so each call resolves after a short random-free delay — use a fixed 200ms, not randomness, so the run is reproducible:

```js
window.__f = window.fetch;
window.__calls = [];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABLCAYAAAC2Zk4uAAAAJ0lEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAADwbSBAAAHrGGJmAAAAAElFTkSuQmCC';
window.fetch = (u, o) => {
  if (String(u).includes('/api/generate')) {
    const body = JSON.parse(o.body);
    window.__calls.push(body);
    return new Promise((res) => setTimeout(() => res(new Response(JSON.stringify({ image: PNG, cost: 0.01, savedPath: `/fake/${body.runIndex}.png` }), { status: 200, headers: { 'Content-Type': 'application/json' } })), 200));
  }
  return window.__f(u, o);
};
```

Set Runs to 3, click Generate, and confirm:
1. `window.__calls.length === 3`, each with the same `batchId` and `runIndex` 1, 2, 3 and `runCount: 3`.
2. Three image nodes appeared, cascading down-right, with three distinct ids.
3. The node shows three thumbnails and `$0.0300 · 3 images`.
4. The button read `Generating 1 / 3…` etc. while running (check by reading its label mid-flight, or accept the end state and note it).

Then test partial failure: restub so `runIndex === 2` rejects with a 500, run 3 again, and confirm the node says `2 of 3 succeeded` with the error text, and two images still landed.

Restore `window.fetch` and `output/sandbox/graph.json`.

- [ ] **Step 6: Commit**

```bash
git add client/src/nodes/OutputNode.jsx
git commit -m "Run N generations per Generate click

Promise.allSettled rather than Promise.all: one failed run must not discard the
images that did arrive, so the node reports \"2 of 3 succeeded\" and keeps them.
Each result lands as it finishes, and the generated node id carries its y offset
because a concurrent batch can produce two results in the same millisecond."
```

---

### Task 5: Free mode — one run per section, with LLM repair

**Files:**
- Modify: `client/src/nodes/OutputNode.jsx` (`onGenerate`, plus a wired-text-node check)

**Interfaces:**
- Consumes: `splitSections` (Task 1), the batch runner (Task 4), `runText` from `api.js`
- Produces: nothing new for later tasks

- [ ] **Step 1: Find the wired text node**

Add inside the component, above `onGenerate`:

```js
  // The text node feeding this output, if any — Free mode needs its result to know
  // what to generate. Y order matches buildRequest, so "the first one" is stable.
  function wiredTextNode() {
    const edges = getEdges().filter((e) => e.target === id);
    const nodes = getNodes();
    return edges
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n) => n && n.type === 'text')
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))[0];
  }
```

- [ ] **Step 2: Build the prompt list in `onGenerate`**

Replace the placeholder from Task 4:

```js
      // Free mode arrives in the next task; until then it means a single run.
      const prompts = [prompt];
```

with:

```js
      let prompts;
      let note = null;
      if (freeRuns) {
        const textNode = wiredTextNode();
        if (!textNode) {
          throw new Error('Free needs a text node wired in — it lists what to generate.');
        }
        if (!textNode.data?.result?.trim()) {
          throw new Error('The text node has no result yet. Run it first.');
        }

        // The text node's own result is a prompt part too, so strip it from the shared
        // context: each run gets the shared context plus its own section, never the
        // whole list.
        const shared = prompt.split('\n\n').filter((part) => part !== textNode.data.result.trim());

        let { blocks, truncated } = splitSections(textNode.data.result);
        if (blocks.length < 2) {
          // The model ignored the format. One repair call, using its own model.
          const repaired = await runText({
            prompt: `Rewrite the following as sections separated by a line containing only ---, one section per item, no preamble.\n\n${textNode.data.result}`,
            model: textNode.data.model || undefined,
          });
          const again = splitSections(repaired.text);
          if (again.blocks.length > 1) {
            blocks = again.blocks;
            truncated = again.truncated;
            note = `re-split into ${blocks.length} sections`;
          } else {
            note = 'no sections found — running as a single generation';
          }
        }
        if (truncated) note = `list had ${blocks.length + truncated} items, running the first ${blocks.length}`;

        prompts = blocks.map((b) => [...shared, b].filter(Boolean).join('\n\n'));
      } else {
        prompts = Array.from({ length: runs }, () => prompt);
      }
      setNote(note);
      setTotal(prompts.length);
```

Add `const [note, setNote] = useState(null);` to the component's state, and `setNote(null)` beside the other resets at the top of `onGenerate`.

- [ ] **Step 3: Show the note**

Below the error `Text` in the JSX:

```jsx
        {note && (
          <Text type="supporting" color="secondary">{note}</Text>
        )}
```

- [ ] **Step 4: Warn when Free has nothing to work with**

Beneath the Runs row, so the problem is visible before clicking:

```jsx
        {freeRuns && !wiredTextNode() && (
          <Text type="supporting" color="warning">
            Wire a text node in — Free takes the number of runs from its list.
          </Text>
        )}
```

`wiredTextNode()` reads `getEdges()`/`getNodes()`, which are stable functions, so calling it during render is safe here — but it will not re-render on its own when an edge changes. `ImageNode` solves the same problem with the `useNodes()`/`useEdges()` hooks; use those two hooks for this check instead, and keep `getNodes()`/`getEdges()` inside `onGenerate` where a fresh read is what you want. Import them from `@xyflow/react` alongside `useReactFlow`.

- [ ] **Step 5: Verify with the network stubbed**

Back up `output/sandbox/graph.json`. Stub both endpoints. Test each path:

1. **Happy path.** Text node result `layer one\n---\nlayer two\n---\nlayer three`, wired into the output, Free on. Generate → 3 calls, each prompt ending in a different block, and no `/api/text` call fired (no repair needed).
2. **Shared context.** Add a prompt node saying `watercolour` wired into the same output. Generate → each of the 3 prompts contains `watercolour` and exactly one block, and none contains the other blocks or the whole list.
3. **Repair.** Text result `one two three` (no separators), and stub `/api/text` to return `one\n---\ntwo`. Generate → one `/api/text` call, 2 generations, node shows `re-split into 2 sections`.
4. **Repair fails.** Same, but `/api/text` returns prose with no `---`. Generate → 1 generation and `no sections found — running as a single generation`.
5. **Cap.** Text result with 14 blocks. Generate → 10 calls and `list had 14 items, running the first 10`.
6. **No text node.** Free on with no text node wired → the warning shows, and clicking Generate surfaces the error without calling `/api/generate`.

Restore the stub and the graph.

- [ ] **Step 6: Commit**

```bash
git add client/src/nodes/OutputNode.jsx
git commit -m "Add Free mode: one generation per section of a text node's list

Splits the text node's result on --- and runs each block with the shared context
around it — the list itself is stripped, so no run receives the whole plan. When
the model ignored the format, one repair call reformats it; if that also fails
the node runs once and says so rather than refusing, since a one-item list is
legitimate."
```

---

### Task 6: The cost trail on disk

**Files:**
- Modify: `server/index.js` (`/api/text` — add the sidecar; `/api/generate` — add batch fields)
- Modify: `client/src/api.js` (`runText` sends `project`)

**Interfaces:**
- Consumes: `batchId` / `runIndex` / `runCount` sent by Task 4
- Produces: `<timestamp>-text-<slug>.json` per text run; batch fields in generation sidecars

- [ ] **Step 1: Send the project with text runs**

In `client/src/api.js`, `runText` currently posts `body` as-is. Make it tag the project the way `generate` does:

```js
export async function runText(body) {
  const res = await fetch('/api/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, project: currentProject }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
```

- [ ] **Step 2: Write a sidecar for text runs**

In `server/index.js`, in the `/api/text` handler: destructure `project` from the body alongside the existing fields, and replace the final `console.log` + `res.json` with:

```js
  const cost = data?.usage?.cost ?? null;

  // Same treatment as a generation: the project folder should be a complete record
  // of what was spent in it, and a Free batch is one repair call plus N generations.
  try {
    const dir = project ? projectDir(project) : OUTPUT_DIR;
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const metaPath = path.join(dir, `${stamp}-text-${slugify(p)}.json`);
    await fs.writeFile(
      metaPath,
      JSON.stringify(
        {
          kind: 'text',
          prompt: p,
          model: model || TEXT_MODEL,
          result: String(text),
          referenceCount: refs.length,
          cost,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    // A missing cost record must not fail the run the user is waiting on.
    console.log(`  text sidecar failed: ${err.message}`);
  }

  console.log(`  text →  ${String(text).length} chars${cost != null ? `  ($${Number(cost).toFixed(4)})` : ''}`);
  res.json({ text: String(text), cost });
```

Use whatever local names the handler already has for the coerced prompt and the guarded references array (they were introduced as `p` and a `refs`-style array in sub-project 1's fix wave — read the handler and match it; do not introduce new names).

- [ ] **Step 3: Add the batch fields to generation sidecars**

In `/api/generate`, destructure `batchId`, `runIndex`, `runCount` from the body, and add them to the sidecar object after `referenceCount`:

```js
          referenceCount: input_references.length,
          batchId: batchId || null,
          runIndex: runIndex || 1,
          runCount: runCount || 1,
          cost,
```

- [ ] **Step 4: Verify with one real text call**

The browser stubs used elsewhere never reach the server, so they cannot prove this code ran. The sidecar write only happens on a successful upstream response, which means the only honest check is one real call — and a text call is the cheapest request in the app (~$0.0001):

```bash
curl -s -X POST localhost:8787/api/text -H 'content-type: application/json' \
  -d '{"prompt":"Reply with the single word: ok","project":"sandbox"}'
ls -t output/sandbox/*text*.json | head -1 | xargs cat
```

Expected: `{"text":"ok…","cost":…}` and a sidecar containing `kind: "text"`, the prompt, the model, the result, and the cost. Delete the sidecar afterwards (`rm`) so the sandbox stays tidy, and report the exact spend.

For the generation fields, no real call is needed: they are pass-through, and the browser stub in Task 4 already proved the client sends them. Confirm by reading the diff.

- [ ] **Step 5: Commit**

```bash
git add server/index.js client/src/api.js
git commit -m "Record text runs and batch membership on disk

Text runs reported cost only on the node and in the log, so a Free batch — one
repair call plus up to ten generations — left no record of what it cost. Text
runs now get the same sidecar treatment as generations, and generation sidecars
carry batchId/runIndex/runCount so a batch's spend is a sum over one field.

A sidecar write that fails is logged, not surfaced: it must not fail the run the
user is waiting on."
```

---

### Task 7: End-to-end verification and docs

**Files:**
- Modify: `README.md` (the Output bullet under "How the graph works")
- Modify: `CLAUDE.md` (key design decisions)

**Interfaces:**
- Consumes: everything
- Produces: documentation

- [ ] **Step 1: Run the whole flow for real, once**

This is the deliberate spend check. In the `sandbox` project, back up `graph.json`, then build: a prompt node asking for three simple objects as `---`-separated image prompts → a text node → an output node with Free on, Size `512`, Quality `low`. Run the text node, read the plan, click Generate.

Expected: 3 images land beside the output node, the node shows 3 thumbnails and a summed cost, and `output/sandbox/` holds 3 PNGs + 3 sidecars sharing one `batchId` with `runIndex` 1–3, plus the text sidecar. Report the total spend.

Keep this graph — it is the sandbox's new saved state and a working example of the pattern. Do not restore the backup unless something failed.

- [ ] **Step 2: Update the README**

Replace the **Output** bullet under "How the graph works" with:

```markdown
- **Output** — collects everything wired into it, resolves the prompts top-to-bottom, sends the lot to OpenRouter, then shows the image plus the exact cost OpenRouter reports. **Runs** generates the same prompt up to 10 times at once; switch it to **Free** and the number comes from a wired-in text node instead — each `---`-separated item in its result becomes one image, which is how one prompt turns into a set.
```

- [ ] **Step 3: Update CLAUDE.md**

Add to **Key design decisions**:

```markdown
- **Multi-run is client-side.** N runs are N ordinary `/api/generate` calls fired with `Promise.allSettled`, so a partial batch keeps its successes (`2 of 3 succeeded`). `splitSections` in `resolve.js` cuts a text node's result on standalone `---` lines; fewer than two blocks triggers one repair call through `/api/text` before falling back to a single run. Cap is 10 everywhere.
- **Image numbering is per consumer.** `imageRefNumbers` returns one rank per consuming node, because an image can be image 1 to a text node and image 2 to an output node at once. The badge shows `1 / 2` when they diverge.
- **Every run leaves a sidecar.** Generations and text runs both write `<timestamp>-*.json` next to the output; batch runs share a `batchId` with `runIndex`/`runCount`, so a batch's spend is a sum over one field.
```

- [ ] **Step 4: Run the suite and check the app**

```bash
npm test
```

Expected: PASS. Then `read_console_messages` — no errors.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Document multi-run generation, per-consumer numbering, and sidecars"
```

---

## Verification checklist

- [ ] `npm test` passes, including the new `splitSections` and `imageRefNumbers` cases.
- [ ] Runs clamps: `15` → `10`, `0` → `1`, empty → `1`.
- [ ] Free with no text node wired warns inline and refuses without calling `/api/generate`.
- [ ] A 3-section list produces exactly 3 calls, each carrying the shared context plus one block — never the whole list.
- [ ] An unformatted list triggers exactly one repair call, then generates.
- [ ] A 14-section list runs 10 and says so.
- [ ] A failed run inside a batch leaves the successes on the canvas and reports `N of M succeeded`.
- [ ] Concurrent results get distinct node ids (no same-millisecond collision).
- [ ] An image wired into both a text node and an output node shows `1 / 2` when ranks diverge.
- [ ] `output/sandbox/` holds one sidecar per generation sharing a `batchId`, plus one per text run.
- [ ] No console errors; the user's real projects untouched.

## What this leaves out

- **The Library and Layerize** — sub-project 3. This plan makes Free mode work; Layerize is the preset that uses it.
- **Video format selector** on the output node — future.
- **Streaming** partial images, and any cost aggregation UI. The sidecars make aggregation a one-liner when it's wanted.
- **`OutputNode` / `TextNode` deduplication.** The two share model-picker and status scaffolding; sub-project 1's review deferred the extraction until after this task reshapes `OutputNode`. Revisit at the start of sub-project 3, not here.
