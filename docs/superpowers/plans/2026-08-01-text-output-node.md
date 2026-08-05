# Text Output Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `text` output node that runs a prompt (plus any wired-in images) through a text model and keeps the result as reusable context for image generation.

**Architecture:** The text node is an *output* node, preserving the engine's single rule — only output nodes consume edges. It reuses `buildRequest` untouched for gathering its inputs, calls a new `POST /api/text` route that proxies OpenRouter's chat-completions API, and stores its answer in `node.data.result`. Downstream prompts pull that result in with the existing `@id` token syntax. Two node *families* (input: prompt/image, output: output/text) get distinct chrome so the invariant is visible.

**Tech Stack:** React 19 + `@xyflow/react` v12 (client, Vite), Express (server, single file), Astryx design system components, OpenRouter API. No test framework in this repo — tests are assert-based self-checks run with `node`.

## Global Constraints

- Node type ids must not change: `prompt`, `image` (input), `output` (image generation), plus new `text`. Renaming would invalidate every saved `output/<project>/graph.json`.
- Labels match type ids exactly: `PROMPT`, `IMAGE`, `OUTPUT`, `TEXT`. The reference node is relabelled `REFERENCE` → `IMAGE` in this sub-project.
- The API key never returns to the browser. Only `/api/health` may expose key material, and only the last 4 characters as `keyHint`.
- Astryx rules (from `client/.claude/CLAUDE.md`): no raw `<div>` for layout — use components; no raw hex or px in CSS — use `var(--color-*)` / `var(--spacing-*)` / `var(--radius-*)` tokens. Structural px already present in `styles.css` (handle sizes, header heights) is the existing exception.
- Model pickers label options by slug (`m.id`), never OpenRouter's display name, and sort alphabetically.
- Text-model list is filtered to **vision-capable** models: `output_modalities` includes `text` AND `input_modalities` includes `image`. Verified live: 181 of 338 models qualify.
- Default text model: env `OPENROUTER_TEXT_MODEL`, falling back to `google/gemini-3.5-flash-lite` (verified live, vision, cheap). Cheaper alternative if it disappears: `qwen/qwen3.7-flash`.
- No generation spend during development. Verify network paths by stubbing `window.fetch` in the browser, as done previously.
- Commit after every task. Do not push.

---

### Task 1: `resolveRef` — resolve `@id` to a text node's result

`resolve.js` is pure (no React, no network) and is the only file in the repo with real logic. It currently resolves `@id` tokens against prompt nodes only. Text nodes must resolve too, so a prompt can say "using @t-plan, draw…".

**Files:**
- Modify: `client/src/graph/resolve.js:8-24` (`substitute`, `resolvePrompt`) and `:28-56` (`buildRequest`)
- Test: `client/src/graph/resolve.test.js` (create)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `buildRequest(nodes, edges, outputId) -> { prompt, input_references }` — unchanged signature, extended behaviour. Text nodes are `{ id, type: 'text', data: { result } }`.

- [ ] **Step 1: Write the failing test**

Create `client/src/graph/resolve.test.js`:

```js
// Assert-based self-check. Run with: node client/src/graph/resolve.test.js
import assert from 'node:assert/strict';
import { buildRequest } from './resolve.js';

const out = { id: 'out', type: 'output', position: { x: 400, y: 0 }, data: {} };

function graph(nodes, edges) {
  return { nodes: [out, ...nodes], edges };
}

// A text node's stored result is substituted for @its-id inside a prompt.
{
  const { nodes, edges } = graph(
    [
      { id: 't1', type: 'text', position: { x: 0, y: 0 }, data: { result: 'a red fox' } },
      { id: 'p1', type: 'prompt', position: { x: 0, y: 10 }, data: { text: 'draw @t1 running' } },
    ],
    [{ id: 'e1', source: 'p1', target: 'out' }],
  );
  const { prompt } = buildRequest(nodes, edges, 'out');
  assert.equal(prompt, 'draw a red fox running');
}

// A text node with no result yet contributes nothing, and does not print "undefined".
{
  const { nodes, edges } = graph(
    [
      { id: 't1', type: 'text', position: { x: 0, y: 0 }, data: {} },
      { id: 'p1', type: 'prompt', position: { x: 0, y: 10 }, data: { text: 'draw @t1 here' } },
    ],
    [{ id: 'e1', source: 'p1', target: 'out' }],
  );
  const { prompt } = buildRequest(nodes, edges, 'out');
  assert.equal(prompt, 'draw  here');
}

// Model output is inserted literally: @tokens inside a result are NOT re-substituted.
{
  const { nodes, edges } = graph(
    [
      { id: 't1', type: 'text', position: { x: 0, y: 0 }, data: { result: 'ignore @p2 entirely' } },
      { id: 'p2', type: 'prompt', position: { x: 0, y: 5 }, data: { text: 'SECRET' } },
      { id: 'p1', type: 'prompt', position: { x: 0, y: 10 }, data: { text: '@t1' } },
    ],
    [{ id: 'e1', source: 'p1', target: 'out' }],
  );
  const { prompt } = buildRequest(nodes, edges, 'out');
  assert.equal(prompt, 'ignore @p2 entirely');
}

// A text node wired straight into the output contributes its result as a prompt part,
// ordered by Y position along with the prompts.
{
  const { nodes, edges } = graph(
    [
      { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'top' } },
      { id: 't1', type: 'text', position: { x: 0, y: 50 }, data: { result: 'middle' } },
      { id: 'p2', type: 'prompt', position: { x: 0, y: 90 }, data: { text: 'bottom' } },
    ],
    [
      { id: 'e1', source: 'p1', target: 'out' },
      { id: 'e2', source: 't1', target: 'out' },
      { id: 'e3', source: 'p2', target: 'out' },
    ],
  );
  const { prompt } = buildRequest(nodes, edges, 'out');
  assert.equal(prompt, 'top\n\nmiddle\n\nbottom');
}

// A cycle through a text node terminates instead of hanging.
{
  const { nodes, edges } = graph(
    [
      { id: 't1', type: 'text', position: { x: 0, y: 0 }, data: { result: 'from @p1' } },
      { id: 'p1', type: 'prompt', position: { x: 0, y: 10 }, data: { text: 'draw @t1' } },
    ],
    [{ id: 'e1', source: 'p1', target: 'out' }],
  );
  const { prompt } = buildRequest(nodes, edges, 'out');
  assert.equal(prompt, 'draw from @p1');
}

// Existing behaviour still holds: prompt-to-prompt substitution and image ordering.
{
  const { nodes, edges } = graph(
    [
      { id: 'p-sub', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'a fox' } },
      { id: 'p1', type: 'prompt', position: { x: 0, y: 10 }, data: { text: 'draw @p-sub' } },
      { id: 'i1', type: 'image', position: { x: 0, y: 20 }, data: { dataUrl: 'data:image/png;base64,AAA' } },
    ],
    [
      { id: 'e1', source: 'p1', target: 'out' },
      { id: 'e2', source: 'i1', target: 'out' },
    ],
  );
  const { prompt, input_references } = buildRequest(nodes, edges, 'out');
  assert.equal(prompt, 'draw a fox');
  assert.equal(input_references.length, 1);
  assert.equal(input_references[0].image_url.url, 'data:image/png;base64,AAA');
}

console.log('resolve.js: all checks passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node client/src/graph/resolve.test.js`
Expected: FAIL — `AssertionError` on the first case, actual `'draw  running'` (the `@t1` token resolves to empty because only prompt nodes are in the lookup map).

- [ ] **Step 3: Write minimal implementation**

In `client/src/graph/resolve.js`, replace the top block (lines 1–24) with:

```js
// Pure graph logic. No React, no network — just turn the node/edge graph into
// a single generation request. This is the only part with real logic; everything
// else is UI wiring.

// @ref references another PROMPT or TEXT node by its id (word chars + hyphens).
// Images are not referenced this way — they are sent as an ordered array and named
// positionally ("image 1", "image 2") which the user types as plain text.
const TOKEN_RE = /@([\w-]+)/g;

function substitute(text, refs, stack) {
  return (text || '').replace(TOKEN_RE, (_, raw) => {
    const ref = raw.trim();
    if (refs.has(ref)) return resolveRef(ref, refs, stack);
    return ''; // unknown ref -> nothing
  });
}

// Resolve one referenced node to text. Prompt nodes substitute recursively; a text
// node's model output is inserted literally — re-scanning it for @tokens would let
// model output pull in arbitrary prompts, and makes cycles unresolvable.
// Throws on circular prompt references (A -> B -> A).
function resolveRef(id, refs, stack) {
  const node = refs.get(id);
  if (node.type === 'text') return node.data?.result || '';
  if (stack.includes(id)) {
    throw new Error(`Circular reference: ${[...stack, id].join(' -> ')}`);
  }
  return substitute(node.data.text, refs, [...stack, id]);
}
```

Then in `buildRequest`, replace the `promptsById` map (lines 30–32) with a map holding both referenceable types:

```js
  // Both prompt and text nodes can be pulled in with @id.
  const refs = new Map(
    nodes.filter((n) => n.type === 'prompt' || n.type === 'text').map((n) => [n.id, n]),
  );
```

and replace the prompt-parts loop (lines 47–53) with:

```js
  const promptParts = [];
  for (const node of sources) {
    if (node.type === 'prompt') {
      const text = resolveRef(node.id, refs, []).trim();
      if (text) promptParts.push(text);
    } else if (node.type === 'text') {
      const text = (node.data?.result || '').trim();
      if (text) promptParts.push(text);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node client/src/graph/resolve.test.js`
Expected: PASS — prints `resolve.js: all checks passed`

- [ ] **Step 5: Add the test to package.json**

In root `package.json`, add to `"scripts"`:

```json
    "test": "node client/src/graph/resolve.test.js"
```

Run: `npm test`
Expected: PASS — prints `resolve.js: all checks passed`

- [ ] **Step 6: Commit**

```bash
git add client/src/graph/resolve.js client/src/graph/resolve.test.js package.json
git commit -m "Resolve @id references to text node results

Text nodes join prompt nodes as @id-referenceable. Their model output is
inserted literally rather than re-substituted: re-scanning it would let model
output pull in arbitrary prompts, and it makes reference cycles terminate with
a stale string instead of throwing.

Adds the repo's first test — assert-based, run with npm test."
```

---

### Task 2: `POST /api/text` — run a prompt through a text model

**Files:**
- Modify: `server/index.js` (add route after the `/api/models` route, around line 52)

**Interfaces:**
- Consumes: module-level `API_KEY`, `MODEL` pattern from `server/index.js`
- Produces: `POST /api/text` accepting `{ prompt: string, input_references?: Array<{type:'image_url', image_url:{url:string}}>, model?: string }`, responding `200 {text: string, cost: number|null}` or `4xx/5xx {error: string}`

- [ ] **Step 1: Add the default text model constant**

In `server/index.js`, directly after the `MODEL` constant (line 15), add:

```js
// Vision-capable so a text node can describe images wired into it. Verified live
// on OpenRouter; qwen/qwen3.7-flash is the cheaper fallback if this slug retires.
const TEXT_MODEL = process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-3.5-flash-lite';
```

- [ ] **Step 2: Report it at startup and document it**

In the startup log block (around line 213), after the `model:` line, add:

```js
  console.log(`  text:     ${TEXT_MODEL}`);
```

Then add it to `.env.example`, after the `OPENROUTER_MODEL` block:

```
# Text model for text nodes. Must accept image input, since images wired into a text
# node are sent along with the prompt. Browse: https://openrouter.ai/models
OPENROUTER_TEXT_MODEL=google/gemini-3.5-flash-lite
```

- [ ] **Step 3: Write the route**

In `server/index.js`, after the `/api/models` route closes, add:

```js
// Run a prompt through a text model. Images wired into a text node are passed as
// content parts so the model can actually see them — that is what lets a text node
// plan work from a picture.
app.post('/api/text', async (req, res) => {
  if (!API_KEY) {
    return res
      .status(400)
      .json({ error: 'No OpenRouter key yet. Add one with the key icon in the top right.' });
  }

  const { prompt, input_references = [], model } = req.body || {};
  if (!prompt || !prompt.trim()) {
    return res
      .status(400)
      .json({ error: 'Prompt is empty. Wire a prompt node into this text node, or type one in.' });
  }

  const content = [{ type: 'text', text: prompt }];
  for (const ref of input_references) {
    const url = ref?.image_url?.url;
    if (url) content.push({ type: 'image_url', image_url: { url } });
  }

  let orRes;
  try {
    orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || TEXT_MODEL,
        messages: [{ role: 'user', content }],
        // Ask for cost in the usage block so the node can show what the call cost.
        usage: { include: true },
      }),
    });
  } catch (err) {
    return res.status(502).json({ error: `Could not reach OpenRouter: ${err.message}` });
  }

  const raw = await orRes.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return res
      .status(502)
      .json({ error: `Unexpected response from OpenRouter: ${raw.slice(0, 300)}` });
  }

  if (!orRes.ok) {
    const msg = data?.error?.message || data?.error || raw.slice(0, 300);
    return res.status(orRes.status).json({ error: `OpenRouter (${orRes.status}): ${msg}` });
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) {
    return res.status(502).json({ error: 'The model returned no text.' });
  }

  const cost = data?.usage?.cost ?? null;
  console.log(`  text →  ${String(text).length} chars${cost != null ? `  ($${Number(cost).toFixed(4)})` : ''}`);
  res.json({ text: String(text), cost });
});
```

- [ ] **Step 4: Verify validation without spending anything**

The dev server runs under `node --watch`, so it has already reloaded. Run:

```bash
curl -s -X POST localhost:8787/api/text -H 'content-type: application/json' -d '{}'
curl -s -X POST localhost:8787/api/text -H 'content-type: application/json' -d '{"prompt":"   "}'
```

Expected: both return `{"error":"Prompt is empty. Wire a prompt node into this text node, or type one in."}` — no upstream call, no spend.

Then confirm the startup banner shows the text model:

```bash
grep -n "text:" server/index.js
```

Expected: the `console.log` line from Step 2.

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "Add POST /api/text for running prompts through a text model

Images wired into a text node are forwarded as image_url content parts, so the
model can see what it is describing. Error branches mirror /api/generate, and
cost comes from usage.cost with usage.include requested."
```

---

### Task 3: `GET /api/models?type=text` — the vision-capable text catalogue

The image catalogue needs `?output_modalities=image` on the upstream call (without it OpenRouter returns the text catalogue). For text models the *default* endpoint is the right one, filtered to vision-capable models.

**Files:**
- Modify: `server/index.js` — the `/api/models` route (around line 40)
- Modify: `client/src/api.js:23-28` (`listModels`)

**Interfaces:**
- Consumes: `TEXT_MODEL` from Task 2
- Produces: `GET /api/models?type=text` → `{models: Array<{id, name}>, default: string}` sorted by `id`; `listModels(type)` on the client where `type` is `'image'` (default) or `'text'`

- [ ] **Step 1: Rewrite the route to branch on type**

Replace the whole `/api/models` route in `server/index.js` with:

```js
// Models for the node pickers. Two catalogues:
//   image — OpenRouter's default listing is the TEXT catalogue, so the
//           output_modalities filter is load-bearing: without it the image models
//           are simply absent from the payload.
//   text  — the default listing, narrowed to vision-capable models, because a text
//           node can always have images wired into it and a text-only model would
//           silently ignore them.
app.get('/api/models', async (req, res) => {
  const wantText = req.query.type === 'text';
  const fallback = wantText ? TEXT_MODEL : MODEL;
  try {
    const url = wantText
      ? 'https://openrouter.ai/api/v1/models'
      : 'https://openrouter.ai/api/v1/models?output_modalities=image';
    const r = await fetch(url);
    const d = await r.json();
    const models = (d.data || [])
      .filter((m) => {
        const out = m.architecture?.output_modalities || [];
        const inp = m.architecture?.input_modalities || [];
        return wantText ? out.includes('text') && inp.includes('image') : out.includes('image');
      })
      .map((m) => ({ id: m.id, name: m.name || m.id }));
    if (!models.some((m) => m.id === fallback)) models.push({ id: fallback, name: fallback });
    // Sorted by slug, which also groups them by provider.
    models.sort((a, b) => a.id.localeCompare(b.id));
    res.json({ models, default: fallback });
  } catch {
    res.json({ models: [{ id: fallback, name: fallback }], default: fallback });
  }
});
```

- [ ] **Step 2: Verify both catalogues**

```bash
curl -s "localhost:8787/api/models" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("image count:",j.models.length,"default:",j.default);})'
curl -s "localhost:8787/api/models?type=text" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const ids=j.models.map(m=>m.id);console.log("text count:",ids.length,"default:",j.default);console.log("sorted:",JSON.stringify(ids)===JSON.stringify([...ids].sort((a,b)=>a.localeCompare(b))));console.log("default present:",ids.includes(j.default));})'
```

Expected: image count `40` (default `openai/gpt-image-2`), text count around `181` (default `google/gemini-3.5-flash-lite`), `sorted: true`, `default present: true`. Exact counts drift as OpenRouter changes; what matters is that image stays ~40 rather than collapsing to ~11, and text is in the hundreds.

- [ ] **Step 3: Make the client cache per-type**

In `client/src/api.js`, replace the `modelsCache` block:

```js
// { models: [{id,name}], default } per catalogue — cached, since the lists rarely
// change within a session. Keyed by type so the two catalogues can't overwrite
// each other.
const modelsCache = new Map();
export const listModels = (type = 'image') => {
  if (!modelsCache.has(type)) {
    modelsCache.set(
      type,
      fetch(`/api/models?type=${encodeURIComponent(type)}`)
        .then((r) => r.json())
        .catch(() => ({ models: [], default: '' })),
    );
  }
  return modelsCache.get(type);
};
```

- [ ] **Step 4: Add the runText API helper**

In `client/src/api.js`, after the `generate` function, add:

```js
export async function runText(body) {
  const res = await fetch('/api/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
```

- [ ] **Step 5: Verify the image picker still works**

The client hot-reloads. In the browser at http://localhost:5173, open an output node's Model dropdown and confirm it still lists 40 slugs alphabetically. (`?type=image` is now sent explicitly; the server treats anything other than `text` as the image catalogue.)

- [ ] **Step 6: Commit**

```bash
git add server/index.js client/src/api.js
git commit -m "Serve a text-model catalogue alongside the image one

/api/models?type=text returns vision-capable text models — a text node can
always have images wired in, and a text-only model would ignore them silently.
The client model cache is keyed by type so the catalogues don't collide."
```

---

### Task 4: Node families — input vs output chrome, and `REFERENCE` → `IMAGE`

**Files:**
- Modify: `client/src/nodes/NodeHeader.jsx`
- Modify: `client/src/styles.css` (after the `.xnode-head` block, around line 146)
- Modify: `client/src/nodes/ImageNode.jsx` (header props)
- Modify: `client/src/nodes/PromptNode.jsx` (header props)
- Modify: `client/src/nodes/OutputNode.jsx` (header props)

**Interfaces:**
- Consumes: nothing
- Produces: `NodeHeader({ kind, family = 'input', copyId, right, rightTone })` — `family` is `'input' | 'output'` and adds `.xnode-head--output`

- [ ] **Step 1: Add the family prop to NodeHeader**

In `client/src/nodes/NodeHeader.jsx`, change the signature and the wrapper's className:

```jsx
// The node title bar. Doubles as the React Flow drag handle (.xnode-head).
// `family` distinguishes inputs (prompt, image — they only feed edges) from outputs
// (output, text — they consume edges), which is the engine's one rule made visible.
// When copyId is set, clicking (without dragging) copies "@<id>" so it can be
// pasted into a prompt as a reference; `right` shows static text instead.
export default function NodeHeader({ kind, family = 'input', copyId, right, rightTone = 'secondary' }) {
```

and:

```jsx
      className={`xnode-head xnode-head--${family}${copyId != null ? ' xnode-head--copy' : ''}`}
```

Also give the kind label the accent colour on outputs:

```jsx
      <Text type="supporting" weight="medium" color={family === 'output' ? 'accent' : undefined}>
        {kind}
      </Text>
```

- [ ] **Step 2: Style the output family**

In `client/src/styles.css`, immediately after the `.xnode-head` rule, add:

```css
/* Output nodes (output, text) consume edges; inputs (prompt, image) only feed them.
   The accent border makes that difference visible at a glance. */
.xnode-head--output {
  border-bottom-color: var(--color-border-accent, var(--color-accent));
}
```

- [ ] **Step 3: Pass family from each node, and relabel the image node**

`client/src/nodes/PromptNode.jsx` — change the header to:

```jsx
      <NodeHeader kind="prompt" family="input" copyId={id} />
```

`client/src/nodes/OutputNode.jsx` — change the header to:

```jsx
      <NodeHeader kind="output" family="output" />
```

`client/src/nodes/ImageNode.jsx` — relabel to `image` and reduce the right badge to the bare ordinal, since `IMAGE … IMAGE 1` would read badly:

```jsx
  const status = num != null ? String(num) : data.dataUrl ? 'not connected' : undefined;

  return (
    <Card width={240} padding={0}>
      <Handle type="source" position={Position.Right} />
      <NodeHeader
        kind="image"
        family="input"
        right={status}
        rightTone={num != null ? 'accent' : 'secondary'}
      />
```

- [ ] **Step 4: Verify in the browser**

At http://localhost:5173 (client hot-reloads):

1. Image nodes read `IMAGE` on the left with a bare `1` / `2` / `NOT CONNECTED` on the right.
2. Output nodes read `OUTPUT` with an accent-tinted header rule and accent label.
3. Prompt nodes are unchanged: `PROMPT` with the `@id` badge.
4. `read_console_messages` reports no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/nodes/NodeHeader.jsx client/src/nodes/ImageNode.jsx client/src/nodes/PromptNode.jsx client/src/nodes/OutputNode.jsx client/src/styles.css
git commit -m "Distinguish input and output nodes, and relabel REFERENCE as IMAGE

Inputs (prompt, image) only feed edges; outputs (output, text) consume them.
NodeHeader takes a family prop that accents the output chrome, making the
engine's one rule visible.

The reference node's label now matches its image type id, so its right-hand
badge drops to the bare ordinal rather than reading IMAGE ... IMAGE 1."
```

---

### Task 5: The `TextNode` component

**Files:**
- Create: `client/src/nodes/TextNode.jsx`
- Modify: `client/src/App.jsx:38` (`nodeTypes`), the icon block (around line 55), `addNode` helpers (around line 245), and the add-node menu (around line 438)
- Modify: `client/src/styles.css` (add `.xnode-text-result`)

**Interfaces:**
- Consumes: `runText(body)` and `listModels('text')` from Task 3; `buildRequest` from Task 1; `NodeHeader({kind, family, copyId})` from Task 4
- Produces: node type `text` with `data: { model?: string, text?: string, result?: string, cost?: number }`

- [ ] **Step 1: Create the component**

Create `client/src/nodes/TextNode.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/Stack';
import NodeHeader from './NodeHeader.jsx';
import { buildRequest } from '../graph/resolve.js';
import { runText, listModels } from '../api.js';

// An output node that emits text instead of an image. It consumes edges exactly like
// the image output node — same buildRequest — and its answer lives in data.result so
// prompts downstream can pull it in with @id.
export default function TextNode({ id, data }) {
  const { getNodes, getEdges, updateNodeData } = useReactFlow();
  const [status, setStatus] = useState('idle'); // idle | running | error
  const [error, setError] = useState(null);
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');

  useEffect(() => {
    listModels('text').then((d) => {
      setModels(d.models || []);
      setDefaultModel(d.default || '');
    });
  }, []);

  const model = data.model || defaultModel;

  async function onRun() {
    setStatus('running');
    setError(null);
    try {
      const { prompt, input_references } = buildRequest(getNodes(), getEdges(), id);
      // The node's own textarea is the last part, after everything wired in.
      const own = (data.text || '').trim();
      const full = [prompt, own].filter(Boolean).join('\n\n');
      if (!full.trim()) {
        throw new Error('Nothing to run. Wire a prompt node in, or type one below.');
      }
      const resp = await runText({ prompt: full, input_references, model });
      updateNodeData(id, { result: resp.text, cost: resp.cost });
      setStatus('idle');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  return (
    <Card width={300} padding={0}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <NodeHeader kind="text" family="output" copyId={id} />

      <VStack gap={3} padding={3}>
        <Selector
          label="Model"
          size="sm"
          hasSearch
          options={models.map((m) => ({ value: m.id, label: m.id }))}
          value={model}
          placeholder="Loading models…"
          onChange={(v) => updateNodeData(id, { model: v })}
        />

        <TextArea
          label="Instructions"
          rows={3}
          hasSpellCheck={false}
          placeholder="Optional — added after anything wired in"
          value={data.text || ''}
          onChange={(v) => updateNodeData(id, { text: v })}
        />

        <Button
          label={status === 'running' ? 'Running…' : 'Run'}
          variant="primary"
          isLoading={status === 'running'}
          onClick={onRun}
        />

        {status === 'error' && <Text type="supporting" color="error">{error}</Text>}

        {data.result && (
          <VStack gap={1}>
            <TextArea
              className="xnode-text-result"
              label="Result"
              rows={6}
              hasSpellCheck={false}
              value={data.result}
              onChange={(v) => updateNodeData(id, { result: v })}
            />
            {data.cost != null && (
              <Text type="supporting" color="accent" hasTabularNumbers>
                ${Number(data.cost).toFixed(4)}
              </Text>
            )}
          </VStack>
        )}
      </VStack>
    </Card>
  );
}
```

The result is a `TextArea`, not static text: the design calls for the plan to be readable **and** editable before it drives generations.

No `nowheel` work is needed — `withDrag` in `App.jsx` applies it to every type except
`image`, so the new `text` type gets it automatically, and scrolling a long result won't
pan the canvas. Verify this in Step 5 rather than assuming it.

- [ ] **Step 2: Let the result box resize like a prompt**

In `client/src/styles.css`, after the `.xnode-prompt .astryx-textarea` block, add:

```css
/* The text node's result is editable and often long, so give it the same two-axis
   resize handle the prompt node has. */
.xnode-text-result {
  resize: both;
  overflow: auto;
  min-width: 160px;
}
```

- [ ] **Step 3: Register the node type and its icon**

In `client/src/App.jsx`:

Add the import beside the other nodes:

```jsx
import TextNode from './nodes/TextNode.jsx';
```

Extend `nodeTypes`:

```jsx
const nodeTypes = { prompt: PromptNode, image: ImageNode, output: OutputNode, text: TextNode };
```

Add an icon next to `OutputIcon`:

```jsx
const TextIcon = svg(<><path d="M4 7V5h16v2M12 5v14M9 19h6" /></>);
```

- [ ] **Step 4: Add it to the add-node menu, grouped by family**

In `client/src/App.jsx`, add the creator beside `addOutput`:

```jsx
  const addText = () => addNode('text', { text: '', result: '' });
```

Group the menu by family. `DropdownMenuItem` has **no** section-label prop (verified:
its only props are `icon`, `label`, `description`, `endContent`, `xstyle`). Sections come
from `DropdownMenu`'s `items` array instead, which accepts
`{type:'section', title, items:[…]}`. So replace the children with an `items` prop and
drop the `DropdownMenuItem` children entirely:

```jsx
          <DropdownMenu
            hasChevron={false}
            placement="start"
            className="add-node-menu"
            menuWidth={152}
            items={[
              {
                type: 'section',
                title: 'Inputs',
                items: [
                  { label: 'Prompt', icon: PromptIcon, onClick: addPrompt },
                  { label: 'Image', icon: ReferenceIcon, onClick: addImage },
                ],
              },
              {
                type: 'section',
                title: 'Outputs',
                items: [
                  { label: 'Output', icon: OutputIcon, onClick: addOutput },
                  { label: 'Text', icon: TextIcon, onClick: addText },
                ],
              },
            ]}
            button={{
              label: 'Add node',
              isIconOnly: true,
              icon: <Icon icon={PlusIcon} />,
              variant: 'primary',
              size: 'lg',
            }}
          />
```

Remove the now-unused `DropdownMenuItem` import from `App.jsx` **only if** the project menu
doesn't use it — check with `grep -n "DropdownMenuItem" client/src/*.jsx` first, since
`ProjectMenu.jsx` may.

If the section titles don't render (the `items` API is documented but unverified here),
fall back to the children form already in the file, ordered Prompt, Image, Output, Text —
the families are already distinguishable by node chrome, so the grouping is a nicety, not
a requirement. Do not spend more than one attempt on it.

The menu is 152px wide with four items now; if any label wraps, raise `menuWidth` to 176.

- [ ] **Step 5: Verify the node works, with the network stubbed**

Do not spend on a real call. In the browser console via `javascript_tool`:

```js
window.__f = window.fetch;
window.fetch = (u, o) => String(u).includes('/api/text')
  ? Promise.resolve(new Response(JSON.stringify({ text: 'layer one\n---\nlayer two', cost: 0.0002 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  : window.__f(u, o);
```

Then, in the app: add a Text node from the menu, type something in Instructions, click Run. Confirm the result box appears with `layer one / --- / layer two`, `$0.0002` beneath it, and the `@id` badge in the header. Reload the page and confirm the result survived (it is in `data.result`, so it is saved to `graph.json`).

Then restore: `window.fetch = window.__f;`

Also confirm the error path with a stub returning `{status: 400, body: {error: 'nope'}}` and check the message renders in red on the node.

**Clean up afterwards:** the test node is saved into the current project. Back up `output/<project>/graph.json` before starting, restore it after, and reload — the same procedure used for the generated-image placement work.

- [ ] **Step 6: Commit**

```bash
git add client/src/nodes/TextNode.jsx client/src/App.jsx client/src/styles.css
git commit -m "Add the text output node

An output node that emits text: it consumes edges through the same buildRequest
as the image node, runs the result through a text model, and stores the answer in
data.result so downstream prompts can pull it in with @id.

The result renders as an editable textarea rather than static text, because a
generated plan is worth correcting before it drives image generations."
```

---

### Task 6: Wire the text node into an image generation, end to end

The point of the node is feeding an image generation. This task proves the whole path and records it in the docs.

**Files:**
- Modify: `CLAUDE.md` (node types line, data flow line)
- Modify: `README.md` (the "How the graph works" section)

**Interfaces:**
- Consumes: everything from Tasks 1–5
- Produces: no code; documentation and a verified integration

- [ ] **Step 1: Verify the integration in the browser**

With `/api/text` stubbed as in Task 5 Step 5 and `/api/generate` stubbed as well:

```js
window.__f = window.fetch;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABLCAYAAAC2Zk4uAAAAJ0lEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAADwbSBAAAHrGGJmAAAAAElFTkSuQmCC';
window.fetch = (u, o) => {
  if (String(u).includes('/api/text')) return Promise.resolve(new Response(JSON.stringify({ text: 'a small red fox', cost: 0.0002 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  if (String(u).includes('/api/generate')) { window.__lastBody = JSON.parse(o.body); return Promise.resolve(new Response(JSON.stringify({ image: PNG, cost: 0.01, savedPath: '/fake/x.png' }), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
  return window.__f(u, o);
};
```

Then build this graph by hand: a Text node (Run it), and a Prompt node reading `draw @<text-node-id> in watercolour` wired into an Output node. Click Generate, then check:

```js
window.__lastBody.prompt
```

Expected: `"draw a small red fox in watercolour"` — the text node's result substituted into the prompt that reached `/api/generate`.

Then wire the Text node *directly* into the Output node instead, Generate again, and confirm `window.__lastBody.prompt` contains `a small red fox` as its own part.

Restore `window.fetch = window.__f;` and clean up the test nodes by restoring the backed-up `graph.json`.

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`, replace the `**Node types**` line with:

```markdown
**Node types** (`client/src/nodes/`), in two families. Inputs only feed edges; outputs consume them — the engine's one rule, made visible by `NodeHeader`'s `family` prop:
- **Inputs:** `PromptNode` (type `prompt`, labelled free text), `ImageNode` (type `image`, a picture you supply; connected ones are numbered so prompts can say "image 1").
- **Outputs:** `OutputNode` (type `output`, image generation — will gain a video format later, which is why it isn't called "image"), `TextNode` (type `text`, runs a prompt through a text model and keeps the answer in `data.result`).

Labels match type ids. Registered in `App.jsx`'s `nodeTypes`; `App.jsx` also holds the starter graph demonstrating the `@p-subject` embed.
```

Add to the **Key design decisions** list:

```markdown
- **`@id` resolves prompts *and* text nodes.** A text node's `data.result` is substituted literally — never re-scanned for `@` tokens, which would let model output pull in arbitrary prompts, and which makes reference cycles terminate with a stale string instead of hanging.
- **Two model catalogues.** `/api/models` returns image models (via the load-bearing `?output_modalities=image` upstream filter); `/api/models?type=text` returns vision-capable text models, because a text node can always have images wired in.
```

- [ ] **Step 3: Update the README**

In `README.md`, add a row to the environment-variable table, after `OPENROUTER_MODEL`:

```markdown
| `OPENROUTER_TEXT_MODEL` | `google/gemini-3.5-flash-lite` | Model for text nodes. Must accept image input. |
```

Then in "How the graph works", replace the three bullets with:

```markdown
Nodes come in two families. **Inputs** feed edges; **outputs** consume them.

- **Prompt** (input) — free text. Embed another prompt or text node's content inline by typing `@` and picking it from the menu; each node shows its own id in its header. Circular references (`A -> B -> A`) are caught and reported instead of looping forever.
- **Image** (input) — a picture handed to the model as image-to-image guidance (GPT Image 2 accepts several). Connect it to an output node and it gets a number; refer to it in a prompt as "image 1".
- **Output** — collects everything wired into it, resolves the prompts top-to-bottom, sends the lot to OpenRouter, then shows the image plus the exact cost OpenRouter reports.
- **Text** (output) — same wiring, but runs the prompt through a *text* model and keeps the answer. Any images wired in are sent along, so it can describe or plan from a picture. The answer is editable, and downstream prompts pull it in with `@id`. Use it to have one model write the prompt for another.
```

- [ ] **Step 4: Run the test suite and confirm the app is clean**

```bash
npm test
```

Expected: `resolve.js: all checks passed`

Then check `read_console_messages` for errors and confirm `output/<project>/graph.json` matches its pre-test backup.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Document the node families and the text output node

Records the input/output split, that labels match type ids, why @id inserts
text results literally, and the two model catalogues."
```

---

## Verification checklist

Before calling this sub-project done:

- [ ] `npm test` passes.
- [ ] The image model picker still lists ~40 slugs alphabetically (the `?output_modalities=image` filter survived the route rewrite).
- [ ] `/api/models?type=text` returns hundreds of vision-capable models, sorted, including the default.
- [ ] `POST /api/text` rejects an empty prompt without calling upstream.
- [ ] A text node's result survives a page reload.
- [ ] Scrolling a long result scrolls the textarea, not the canvas (`nowheel` inherited from `withDrag`).
- [ ] `OPENROUTER_TEXT_MODEL` appears in `.env.example`, the README table, and the startup banner.
- [ ] `@text-id` inside a prompt reaches `/api/generate` substituted.
- [ ] A text node wired straight into an output contributes its result as a prompt part.
- [ ] Image nodes read `IMAGE` with a bare ordinal; output and text nodes carry accent chrome.
- [ ] The project's `graph.json` is byte-identical to its pre-testing backup.
- [ ] No console errors.

## What this sub-project deliberately leaves out

- **Multi-run generation** (`Runs` control, `splitSections`, LLM repair) — sub-project 2.
- **The Library** (registry, insertion, FAB, dialog, Layerize preset) — sub-project 3.
- **Video format selector** on the output node — future, named for it but not built.
- **Streaming** the text result. The call is a single request/response; a long plan appears all at once.
