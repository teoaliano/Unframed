// Assert-based self-check. Run with: node client/src/graph/resolve.test.js
import assert from 'node:assert/strict';
import { buildRequest, bucketSources, sourceRoles, splitSections, findFreeSource, freeSourceText, freeShared, freeRunPrompts, parseImagePicks, expandSlots, runReferences, freeBatch, isOutput, isTextOutput, isReferenceable, MAX_RUNS } from './resolve.js';
import { migrateNodes } from './migrate.js';
import { instantiateFragment, centerOffset } from '../library/insert.js';
import { selectionFragment, presetFromSelection } from '../library/save.js';
import { MODEL_PARAM_KEYS, resetModelParams } from '../nodes/output/defaults.js';
import { RUN_MARKERS, stripRunMarkers, keepLiveRunMarkers } from './runMarkers.js';
import { nextId, bumpCounter, slug, initialNodes, initialEdges } from './starter.js';

const out = { id: 'out', type: 'imageOutput', position: { x: 400, y: 0 }, data: {} };

function graph(nodes, edges) {
  return { nodes: [out, ...nodes], edges };
}

// A text node's stored result is substituted for @its-id inside a prompt.
{
  const { nodes, edges } = graph(
    [
      { id: 't1', type: 'textOutput', position: { x: 0, y: 0 }, data: { result: 'a red fox' } },
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
      { id: 't1', type: 'textOutput', position: { x: 0, y: 0 }, data: {} },
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
      { id: 't1', type: 'textOutput', position: { x: 0, y: 0 }, data: { result: 'ignore @p2 entirely' } },
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
      { id: 't1', type: 'textOutput', position: { x: 0, y: 50 }, data: { result: 'middle' } },
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
      { id: 't1', type: 'textOutput', position: { x: 0, y: 0 }, data: { result: 'from @p1' } },
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

// Video references ride alongside images in Y-order, each with its own content
// type, and each kind numbers independently ("image 1" and "video 1" coexist).
{
  const { nodes, edges } = graph(
    [
      { id: 'i1', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: 'data:image/png;base64,AAA' } },
      { id: 'v1', type: 'video', position: { x: 0, y: 10 }, data: { dataUrl: 'data:video/mp4;base64,BBB' } },
      { id: 'i2', type: 'image', position: { x: 0, y: 20 }, data: { dataUrl: 'data:image/png;base64,CCC' } },
    ],
    [
      { id: 'e1', source: 'i1', target: 'out' },
      { id: 'e2', source: 'v1', target: 'out' },
      { id: 'e3', source: 'i2', target: 'out' },
    ],
  );
  const { input_references } = buildRequest(nodes, edges, 'out');
  assert.deepEqual(
    input_references.map((r) => r.type),
    ['image_url', 'video_url', 'image_url'],
  );
  assert.equal(input_references[1].video_url.url, 'data:video/mp4;base64,BBB');
  // Per-kind numbering: the video is video 1 even though an image sits above it.
  assert.deepEqual(sourceRoles(nodes, edges, 'v1'), ['1']);
  assert.deepEqual(sourceRoles(nodes, edges, 'i2'), ['2']);
}

// A prompt-to-prompt cycle throws instead of recursing forever.
{
  const { nodes, edges } = graph(
    [
      { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'a @p2' } },
      { id: 'p2', type: 'prompt', position: { x: 0, y: 10 }, data: { text: 'b @p1' } },
    ],
    [{ id: 'e1', source: 'p1', target: 'out' }],
  );
  assert.throws(() => buildRequest(nodes, edges, 'out'), /Circular reference/);
}

// --- splitSections ---

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

// Several text nodes wired in -> the lowest-Y one wins.
{
  const { nodes, edges } = graph(
    [
      { id: 't-lo', type: 'textOutput', position: { x: 0, y: 50 }, data: { result: 'a\n---\nb' } },
      { id: 't-hi', type: 'textOutput', position: { x: 0, y: 10 }, data: { result: 'c\n---\nd' } },
    ],
    [
      { id: 'e1', source: 't-lo', target: 'out' },
      { id: 'e2', source: 't-hi', target: 'out' },
    ],
  );
  assert.equal(findFreeSource(nodes, edges, 'out').id, 't-hi');
}

// freeSourceText: a text output's answer verbatim, even when it contains a token
// (@p2) that WOULD resolve to something else if re-scanned -- proving the "never
// re-scanned for @tokens" rule actually holds, rather than merely being untestable
// because the token happened to be unknown. A prompt node's @ids, by contrast, DO
// expand first so no literal token reaches the splitter.
{
  const t = { id: 't1', type: 'textOutput', position: { x: 0, y: 0 }, data: { result: 'raw @p2 answer' } };
  const other = { id: 'p2', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'golden hour' } };
  const p = { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'in @p2 light' } };
  const nodes = [out, t, other, p];
  assert.equal(freeSourceText(t, nodes), 'raw @p2 answer', "a text output's answer is taken verbatim, not re-scanned");
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

// freeRunPrompts: the shared context (everything wired in except the text node) is
// included in every prompt, the raw list and its --- separators never leak in, each
// prompt carries exactly one block, and a sibling prompt's @textNodeId reference
// resolves to empty instead of smuggling the whole list back in.
{
  const textNode = { id: 't1', type: 'textOutput', position: { x: 0, y: 50 }, data: { result: 'one\n---\ntwo' } };
  const shared = { id: 'p-shared', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'a shared subject' } };
  const sibling = { id: 'p-sib', type: 'prompt', position: { x: 0, y: 90 }, data: { text: 'ref: @t1' } };
  const { nodes, edges } = graph(
    [shared, textNode, sibling],
    [
      { id: 'e1', source: 'p-shared', target: 'out' },
      { id: 'e2', source: 't1', target: 'out' },
      { id: 'e3', source: 'p-sib', target: 'out' },
    ],
  );
  const found = findFreeSource(nodes, edges, 'out');
  assert.equal(found.id, 't1');

  const { blocks } = splitSections(textNode.data.result);
  const prompts = freeRunPrompts(nodes, edges, 'out', found.id, blocks);

  assert.equal(prompts.length, 2);
  for (const p of prompts) {
    assert.ok(p.includes('a shared subject'), 'shared context missing');
    assert.ok(!p.includes('---'), 'separator leaked');
    assert.ok(!p.includes('one\n---\ntwo'), 'raw list leaked');
    assert.ok(!p.includes('@t1'), 'unresolved @token leaked');
  }
  assert.ok(prompts[0].includes('one') && !prompts[0].includes('two'), 'block 0 should carry exactly one item');
  assert.ok(prompts[1].includes('two') && !prompts[1].includes('one'), 'block 1 should carry exactly one item');
  // The sibling's own text still comes through — only its @t1 token resolves to empty.
  assert.ok(prompts[0].includes('ref:'), 'sibling prompt should still contribute its own text');
}

// ---- instantiateFragment ----
{
  // Ids that prefix each other on purpose: rewriting @p1 must not eat into @p10.
  const fragment = {
    nodes: [
      { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'a @p1x @p1 and @p10, plus @stranger' } },
      { id: 'p10', type: 'prompt', position: { x: 0, y: 200 }, data: { text: 'subject' } },
      { id: 'o1', type: 'imageOutput', position: { x: 400, y: 0 }, data: { freeRuns: true } },
    ],
    edges: [
      { id: 'e1', source: 'p1', target: 'o1' },
      { id: 'e2', source: 'p10', target: 'o1' },
    ],
  };
  let n = 500;
  const minted = [];
  const { nodes, edges } = instantiateFragment(fragment, () => { const id = String(n++); minted.push(id); return id; });

  assert.deepEqual(nodes.map((x) => x.id), minted, 'every node gets a freshly minted id');
  assert.deepEqual(edges.map((e) => [e.source, e.target]), [['500', '502'], ['501', '502']], 'edges follow the id map');
  assert.equal(new Set(edges.map((e) => e.id)).size, 2, 'edge ids are distinct');
  assert.equal(nodes[0].data.text, 'a @p1x @500 and @501, plus @stranger',
    'tokens rewrite whole ids only; unknown ids pass through untouched');
  assert.equal(fragment.nodes[0].data.text.includes('@p1 '), true, 'the fragment itself is not mutated');
  assert.equal(fragment.edges[0].source, 'p1', 'fragment edges are not mutated');

  // A second insertion mints different ids from the same fragment.
  const again = instantiateFragment(fragment, () => String(n++));
  assert.notEqual(again.nodes[0].id, nodes[0].id, 'insertions never share ids');
}

{
  const fragment = { nodes: [
    { id: 'a', position: { x: 0, y: 0 } },
    { id: 'b', position: { x: 700, y: 100 } },
  ] };
  // Box spans x 0..1000, y 0..250 with the default 300x150 node size.
  const { dx, dy } = centerOffset(fragment, { x: 500, y: 125 });
  assert.equal(dx, 0, 'a box already centred needs no x shift');
  assert.equal(dy, 0, 'a box already centred needs no y shift');
  const off = centerOffset(fragment, { x: 0, y: 0 });
  assert.equal(off.dx, -500, 'centres the box, not its origin');
}

// ---- library/save.js: selection -> preset ----
{
  const graphNodes = [
    { id: 'a', type: 'prompt', selected: true, data: {} },
    // videoModel survives; job and running must not -- see selectionFragment's
    // comment for why either marker baked into a never-rewritten preset (or a
    // copy-pasted node) is permanent.
    { id: 'b', type: 'videoOutput', selected: true, data: { videoModel: 'seedance', job: { id: 'j1', startedAt: 1, params: {} }, running: { startedAt: 1, session: 's1' } } },
    { id: 'c', type: 'prompt', data: {} },
  ];
  const graphEdges = [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'c', target: 'b' }, // half outside the selection
  ];

  const frag = selectionFragment(graphNodes, graphEdges);
  assert.deepEqual(frag.nodes.map((n) => n.id), ['a', 'b'], 'takes the selected nodes');
  assert.deepEqual(frag.edges.map((e) => e.id), ['e1'], 'drops edges with an end outside the selection');
  assert.equal('selected' in frag.nodes[0] && frag.nodes[0].selected, undefined, 'selection state is not saved');
  assert.equal(frag.nodes[1].data.job, undefined, 'a pending job is stripped from a saved/copied node');
  assert.equal(frag.nodes[1].data.running, undefined, 'an in-flight run marker is stripped too');
  assert.equal(frag.nodes[1].data.videoModel, 'seedance', 'other data survives the strip');

  // The inbound half of the same strip, and the only one that can help a preset
  // ALREADY on disk: presets.json is never rewritten, so a fragment saved before
  // selectionFragment stripped these still carries them, forever. Left in, the
  // pasted node polls a job id OpenRouter has forgotten -- and a 404 reads to
  // pollVideo as "could not reach our own server", so it never resolves on its own.
  {
    const stale = {
      nodes: [{ id: 'v', type: 'videoOutput', position: { x: 0, y: 0 },
        data: { videoModel: 'seedance', job: { id: 'j-gone', startedAt: 1, params: {} }, running: { startedAt: 1, session: 's1' } } }],
      edges: [],
    };
    let k = 700;
    const fresh = instantiateFragment(stale, () => String(k++));
    assert.equal(fresh.nodes[0].data.job, undefined, 'a stale job never reaches the canvas');
    assert.equal(fresh.nodes[0].data.running, undefined, 'nor does a stale run marker');
    assert.equal(fresh.nodes[0].data.videoModel, 'seedance', 'the rest of the node is untouched');
    assert.equal(stale.nodes[0].data.job.id, 'j-gone', 'the fragment on disk is not mutated');
  }

  // Right-clicking does not select, so the clicked node stands in for a selection.
  const one = selectionFragment(graphNodes.map((n) => ({ ...n, selected: false })), graphEdges, 'c');
  assert.deepEqual(one.nodes.map((n) => n.id), ['c'], 'falls back to the right-clicked node');
  assert.equal(one.edges.length, 0, 'a single node brings no edges');
  assert.equal(selectionFragment(graphNodes.map((n) => ({ ...n, selected: false })), graphEdges), null,
    'nothing selected and nothing clicked means no fragment');

  const preset = presetFromSelection(frag, { name: '  Hero shot ', summary: ' two nodes ' });
  assert.equal(preset.type, 'flow', 'several nodes make a flow');
  assert.equal(preset.kind, 'video', 'kind comes from the output node\'s type');
  assert.equal(preset.source, 'user', 'saved presets are marked as yours');
  assert.equal(preset.name, 'Hero shot', 'name is trimmed');
  assert.equal(preset.summary, 'two nodes', 'summary is trimmed');
  assert.equal(preset.fragment, frag, 'the fragment travels as-is');
  assert.equal(Number.isFinite(Date.parse(preset.savedAt)), true, 'savedAt is a parseable date');

  assert.equal(presetFromSelection(one, { name: 'x', summary: '' }).type, 'block', 'one node is a block');
  assert.equal(presetFromSelection(one, { name: 'x', summary: '' }).kind, 'image',
    'no consumer node falls back to image');
  const textOnly = { nodes: [{ id: 't', type: 'textOutput', data: {} }], edges: [] };
  assert.equal(presetFromSelection(textOnly, { name: 'x', summary: '' }).kind, 'text',
    'a text output makes text');
  const imageOut = { nodes: [{ id: 'o', type: 'imageOutput', data: {} }], edges: [] };
  assert.equal(presetFromSelection(imageOut, { name: 'x', summary: '' }).kind, 'image',
    'an image output makes an image');

  // A legacy fragment still on disk goes through migrateNodes on its way to the
  // canvas, so a preset saved before the split inserts as the right node types.
  const legacyFrag = {
    nodes: [
      { id: 'p', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'x' } },
      { id: 'o', type: 'output', position: { x: 0, y: 40 }, data: { kind: 'video' } },
    ],
    edges: [{ id: 'e', source: 'p', target: 'o' }],
  };
  let m = 800;
  const migrated = instantiateFragment(
    { ...legacyFrag, nodes: migrateNodes(legacyFrag.nodes) },
    () => String(m++),
  );
  assert.deepEqual(migrated.nodes.map((n) => n.type), ['prompt', 'videoOutput'],
    'a pre-split preset fragment inserts as the new node types');

  // The whole point: a saved fragment inserts through the same path as a bundled one.
  let n = 900;
  const back = instantiateFragment(preset.fragment, () => String(n++));
  assert.deepEqual(back.edges.map((e) => [e.source, e.target]), [['900', '901']],
    'a saved preset re-inserts with fresh ids and its wiring intact');
}

// ---- graph/runMarkers.js: the one home for in-flight markers ----
{
  const data = { videoModel: 'seedance', job: { id: 'j1' }, running: { session: 's1' }, text: 'keep me' };
  const stripped = stripRunMarkers(data);
  assert.equal(stripped.job, undefined, 'job is stripped');
  assert.equal(stripped.running, undefined, 'running is stripped');
  assert.equal(stripped.text, 'keep me', 'ordinary data survives');
  assert.equal(data.job.id, 'j1', 'the input object is not mutated');

  // Undo restoring a snapshot from BEFORE Generate: the live job must survive.
  const live = [{ id: 'v', data: { job: { id: 'j-live' } } }];
  const restoredWithout = [{ id: 'v', data: { videoModel: 'seedance' } }];
  const kept = keepLiveRunMarkers(restoredWithout, live);
  assert.equal(kept[0].data.job.id, 'j-live', 'a live job survives an undo to before it started');
  assert.equal(kept[0].data.videoModel, 'seedance', 'the snapshot keeps its own content');
  // A changed marker means a rebuilt node, and the snapshot that fed it must come
  // out exactly as it went in -- keepLiveRunMarkers reads straight from the undo
  // stack's own history, and mutating an entry in place would corrupt whatever
  // step undo/redo lands on next.
  assert.notEqual(kept[0], restoredWithout[0], 'a changed marker produces a new object, not the input returned as-is');
  assert.equal(restoredWithout[0].data.job, undefined, 'the snapshot itself is not mutated by computing what the canvas should show');

  // Undo restoring a snapshot from DURING a run that has since finished: the
  // stale marker must NOT come back -- this is the bug where a text node's Run
  // button froze until reload, because the mount-only session-id self-clear
  // never fires on an undo (no remount, same session).
  const liveDone = [{ id: 't', data: { result: 'answer' } }];
  const restoredMidRun = [{ id: 't', data: { running: { session: 's1' }, result: undefined } }];
  const cleared = keepLiveRunMarkers(restoredMidRun, liveDone);
  assert.equal(cleared[0].data.running, undefined, 'a finished run is not resurrected by undo');
  assert.notEqual(cleared[0], restoredMidRun[0], 'a changed marker produces a new object, not the input returned as-is');
  assert.deepEqual(restoredMidRun[0].data.running, { session: 's1' },
    'the snapshot itself is not mutated -- a later redo back to this step must still see its own running marker, not one erased as a side effect of computing what the canvas shows now');

  // The fast path this module's own doc comment promises: when nothing about a
  // node's markers actually changes, keepLiveRunMarkers must hand back the SAME
  // object rather than a rebuilt copy. Task 5 feeds the result straight into React
  // Flow's setNodes on every undo -- an implementation that always rebuilds would
  // pass every value-only assertion above while still churning referential
  // equality for the whole canvas on each undo, which is exactly the re-render
  // this path exists to avoid.
  const untouchedLive = [{ id: 'u', data: { text: 'plain' } }];
  const untouchedRestored = [{ id: 'u', data: { text: 'plain' } }];
  const untouchedKept = keepLiveRunMarkers(untouchedRestored, untouchedLive);
  assert.equal(untouchedKept[0], untouchedRestored[0],
    'a node with no markers on either side comes back as the identical object, not a rebuild');

  const sharedJob = { id: 'j-same' };
  const matchingLive = [{ id: 'm', data: { job: sharedJob } }];
  const matchingRestored = [{ id: 'm', data: { job: sharedJob } }];
  const matchingKept = keepLiveRunMarkers(matchingRestored, matchingLive);
  assert.equal(matchingKept[0], matchingRestored[0],
    'a marker already equal to the live value (same reference) comes back unchanged, not rebuilt');

  // A node undo is bringing back from a delete has no live counterpart, and the
  // two markers part company there. `job` is durable server-side, so a restored
  // video node should resume watching its render. `running` is not: it belongs to
  // one HTTP request owned by a component instance that no longer exists, so a
  // restored image or text node would show a permanently disabled Run button --
  // the mount-only self-clear cannot help, because the marker's session id still
  // matches this tab.
  const ghostVideo = keepLiveRunMarkers([{ id: 'gone-v', data: { job: { id: 'j-old' } } }], []);
  assert.equal(ghostVideo[0].data.job.id, 'j-old',
    'a restored video node keeps its job, so it resumes watching a render that is still running');

  const staleRun = { startedAt: 1, session: 's1' };
  const ghostRun = keepLiveRunMarkers([{ id: 'gone-t', data: { running: staleRun, text: 'keep me' } }], []);
  assert.equal(ghostRun[0].data.running, undefined,
    'a restored image or text node drops its run marker, or Run stays disabled until a reload');
  assert.equal(ghostRun[0].data.text, 'keep me', 'the rest of a restored node is untouched');

  // The undo stack holds the snapshot itself; computing what the canvas should
  // show must not rewrite it, or stepping forward again reads the amended copy.
  const snapshot = [{ id: 'gone-t2', data: { running: staleRun } }];
  const amended = keepLiveRunMarkers(snapshot, []);
  assert.notEqual(amended[0], snapshot[0], 'a cleared marker produces a new node object');
  assert.equal(snapshot[0].data.running, staleRun, 'the snapshot in the undo stack is not mutated');

  // The same-object fast path applies on this branch too: a restored node with
  // nothing to clear must not be rebuilt, or every undo churns identity for the
  // whole canvas.
  const cleanGhost = [{ id: 'gone-p', data: { text: 'a prompt' } }];
  assert.equal(keepLiveRunMarkers(cleanGhost, [])[0], cleanGhost[0],
    'a restored node with no run marker comes back as the identical object');

  assert.deepEqual(RUN_MARKERS, ['job', 'running'], 'the list itself is the contract');
}

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
  assert.equal(isOutput({ type: 'output' }), false, 'the pre-migration id is not an output either');

  // Exactly the two kinds resolveRef can answer with. The @ menu offers candidates
  // from this and the right-click item copies from it, so a type drifting in or out
  // of the set has to move both at once or one of them starts lying.
  assert.equal(isReferenceable({ type: 'prompt' }), true);
  assert.equal(isReferenceable({ type: 'textOutput' }), true);
  assert.equal(isReferenceable({ type: 'image' }), false, 'images are named positionally, not by @id');
  assert.equal(isReferenceable({ type: 'video' }), false);
  assert.equal(isReferenceable({ type: 'imageOutput' }), false, 'an image output has no text to substitute');
  assert.equal(isReferenceable({ type: 'videoOutput' }), false);
  assert.equal(isReferenceable({ type: 'text' }), false, 'the pre-migration id is not referenceable');
  assert.equal(isReferenceable({}), false);
}

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

// first_last with only one image wired: the slot that has no image is simply absent,
// rather than a null entry or a frame pointing at nothing. Nothing becomes excess --
// the mode wanted two and got one, which is short, not over-supplied.
{
  const { nodes, edges } = videoGraph('first_last', 1);
  const { frame_images } = buildRequest(nodes, edges, 'v1');
  assert.deepEqual(frame_images.map((f) => [f.frame_type, f.image_url.url]), [
    ['first_frame', 'data:,1'],
  ]);
  assert.deepEqual(bucketSources(nodes, edges, 'v1').excess, []);
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

// Modes are a video-output concern; an image output ignores the field entirely.
{
  // A copy, not a mutation of `out`: `out` is shared by reference with every block
  // below this one, and setting inputMode on it directly would silently change
  // their meaning too.
  const nodeWithMode = { ...out, data: { ...out.data, inputMode: 'first_frame' } };
  const { nodes, edges } = graph(
    [{ id: 'i1', type: 'image', position: { x: 0, y: 10 }, data: { dataUrl: 'data:,a' } }],
    [{ id: 'e1', source: 'i1', target: 'out' }],
  );
  nodes[0] = nodeWithMode; // `out` is an imageOutput
  const { input_references, frame_images } = buildRequest(nodes, edges, 'out');
  assert.equal(input_references.length, 1);
  assert.deepEqual(frame_images, []);
}

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

// Badge order follows canvas position, not the order outputs were created. This needs
// a node that gets a DIFFERENT role from each of two outputs -- if both gave it the
// same role, Set dedup would hide an order bug no matter which output ran first.
{
  const w = { id: 'w', type: 'image', position: { x: 0, y: -100 }, data: { dataUrl: 'data:,w' } };
  const x = { id: 'x', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: 'data:,x' } };
  const solo = { id: 'o-solo', type: 'imageOutput', position: { x: 400, y: 0 }, data: {} };
  const paired = { id: 'o-paired', type: 'imageOutput', position: { x: 400, y: 300 }, data: {} };
  const edges = [
    { id: 'e1', source: 'x', target: 'o-solo' },
    { id: 'e2', source: 'w', target: 'o-paired' },
    { id: 'e3', source: 'x', target: 'o-paired' },
  ];
  // x is the only image at o-solo (rank 1) and sits below w at o-paired (rank 2).
  // o-solo sits above o-paired on the canvas, so rank 1 must lead regardless of which
  // node array order the caller happens to pass.
  const forwards = sourceRoles([solo, paired, w, x], edges, 'x');
  const backwards = sourceRoles([paired, solo, w, x], edges, 'x');
  assert.deepEqual(forwards, backwards, 'badge order must not depend on node array order');
  assert.deepEqual(forwards, ['1', '2']);
}

// ---- resetModelParams ----

// Critical regression guard: a naive "clear the model keys, then spread the WHOLE
// defaults object over them" also resets text output's `text`/`result`, wiping the
// user's instructions and the model's answer -- and every @id reference to it -- on a
// mere model switch. textOutput has no model-dependent keys, so the reset must be a
// true no-op.
{
  assert.deepEqual(resetModelParams('textOutput'), {});
}

// videoOutput has no fresh-node defaults of its own (OUTPUT_DEFAULTS.videoOutput is
// {}), so every model-dependent key comes back cleared rather than repopulated.
{
  const reset = resetModelParams('videoOutput');
  assert.deepEqual(Object.keys(reset).sort(), [...MODEL_PARAM_KEYS.videoOutput].sort());
  for (const key of MODEL_PARAM_KEYS.videoOutput) assert.equal(reset[key], undefined);
}

// imageOutput DOES have fresh-node defaults: resolution/quality/aspect_ratio land back
// on them, while size/background -- keys the type has no default for -- clear to
// undefined instead of surviving the switch.
{
  const reset = resetModelParams('imageOutput');
  assert.equal(reset.resolution, '1K');
  assert.equal(reset.quality, 'low');
  assert.equal(reset.aspect_ratio, '1:1');
  assert.equal(reset.size, undefined);
  assert.equal(reset.background, undefined);
}

// A model switch must never reset what a node keeps across switches on purpose -- a
// batch size, consent about a wired clip, or the node's own content/identity. An
// overlap here is the Critical-1 bug recurring in a different key.
{
  const mustSurvive = ['runs', 'freeRuns', 'previewPrompt', 'shareLocalVideos', 'text', 'result', 'model', 'videoModel'];
  for (const type of Object.keys(MODEL_PARAM_KEYS)) {
    for (const key of MODEL_PARAM_KEYS[type]) {
      assert.ok(!mustSurvive.includes(key), `${type}'s MODEL_PARAM_KEYS must not include "${key}"`);
    }
  }
}

// ---- starter.js ----
// These two were unreachable by any test while they lived in App.jsx: it is JSX,
// so plain `node` cannot import it. Moving them out is what makes them testable,
// and both have a rule worth pinning.

// bumpCounter must clear every numeric id in a loaded graph. Ids are reference
// keys (@id in a prompt), so a counter that reissues one lets a newly added node
// silently capture a reference meant for an existing node.
// No counter reset is exported on purpose -- a test-only setter would be API
// nobody else wants. These assertions hold from whatever value the counter is
// already at, since bumpCounter only ever moves it forward.
{
  bumpCounter([{ id: '500' }, { id: 'not-a-number' }, { id: '7' }]);
  assert.equal(nextId(), '501', 'bumpCounter clears the highest numeric id in the graph');
  assert.equal(nextId(), '502', 'and keeps counting from there');
  // The property that actually matters: a graph whose ids are all non-numeric
  // must never drag the counter BACKWARDS onto an id already in use. (It does
  // advance by one here -- Math.max(counter) + 1 with nothing to compare -- so
  // one id is skipped. Harmless: ids only have to be unique, never dense.)
  bumpCounter([{ id: 'a' }, { id: 'b' }]);
  assert.ok(Number(nextId()) > 502, 'a graph with no numeric ids never reissues a used id');
}

// slug is a hand-kept copy of the server's slugify (server/index.js): the client
// tracks the project name, the server writes the folder, and they have to agree.
// Same three rules, same 40-char cap.
{
  assert.equal(slug('Golden Hour!! At the CLIFF'), 'golden-hour-at-the-cliff');
  assert.equal(slug('--x--'), 'x');
  assert.equal(slug('A'.repeat(60)).length, 40, 'slug caps at 40 chars');
}

// The starter graph has to be a graph the resolver can actually build from, and
// its scene prompt references the subject prompt by @id -- the one feature a
// first-run canvas exists to demonstrate. A typo'd id here ships a broken
// reference to every new user, and nothing else would catch it.
{
  assert.equal(initialNodes.length, 3, 'three starter nodes');
  const [scene, subject, output] = initialNodes;
  assert.ok(
    scene.data.text.includes(`@${subject.id}`),
    "the starter scene prompt references the subject prompt by its real id",
  );
  const { prompt } = buildRequest(initialNodes, initialEdges, output.id);
  assert.ok(prompt.includes('lone red fox'), 'the @id reference resolves in the starter graph');
  assert.ok(!prompt.includes('@'), 'and leaves no unresolved token behind');
}

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

// Only a pure list of positive integers is a directive. "images: none of them" is prose,
// and deleting it would hand the model a prompt nobody wrote.
{
  const { text, picks } = parseImagePicks('images: none of them\nprose');
  assert.equal(picks, null);
  assert.equal(text, 'images: none of them\nprose', 'a line that is not a directive stays put');
}

// "Image:" as a section caption is ordinary text-model formatting, and the repair prompt
// teaches the model this very keyword -- so the collision is invited, not remote. Each of
// these once became an empty prompt plus a paid image.
{
  for (const prose of [
    'Image: 3 women standing in a row, studio light',
    'images: 2 hands holding a cup',
    'Image: a red fox in snow, watercolour',
  ]) {
    const { text, picks } = parseImagePicks(prose);
    assert.equal(picks, null, `"${prose}" is prose, not a directive`);
    assert.equal(text, prose, 'and reaches the model exactly as written');
  }
}

// Keyword case and number are both free; the numbers are what makes it a directive.
{
  assert.deepEqual(parseImagePicks('Image: 2\nfox').picks, [2], 'capitalised singular parses');
  assert.equal(parseImagePicks('Image: 2\nfox').text, 'fox');
  assert.deepEqual(parseImagePicks('IMAGES: 2, 1\nfox').picks, [2, 1]);
}

// A directive that names nothing usable is left in place, not deleted: a line is only ever
// stripped once it has been confirmed to be a directive that did something.
{
  for (const src of ['images: 0', 'images: 0, -2\nprose']) {
    const { text, picks } = parseImagePicks(src);
    assert.equal(picks, null, `"${src}" yields no usable pick`);
    assert.equal(text, src, 'and the line survives');
  }
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

// Truncation and dropped directive-only sections can land in the same list. The cap acts
// on the RAW section count first, so a directive-only section counts toward the 10 kept
// just like any other -- the fix this pins down is what the caller does with the counts
// afterward: `truncated` is only ever the sections beyond the cap, never inflated by ones
// the cap kept but freeBatch itself dropped for having no prompt text.
{
  const src = { id: 'p-list', type: 'prompt', position: { x: 0, y: 0 }, data: { text: '' } };
  const { nodes, edges } = graph([src], [{ id: 'e1', source: 'p-list', target: 'out' }]);
  // 12 sections; the first 10 survive the cap (2 truncated); of those 10, 3 are nothing
  // but an `images: 1` directive and are dropped as empty, leaving 7 runs.
  const sections = Array.from({ length: 12 }, (_, i) => (i === 2 || i === 5 || i === 8 ? 'images: 1' : `item ${i}`));
  const { runs, truncated, empty } = freeBatch(nodes, edges, 'out', 'p-list', sections.join('\n---\n'));
  assert.equal(runs.length, 7);
  assert.equal(truncated, 2);
  assert.equal(empty, 3);
}

// A section that is only a directive is not a run: with its line stripped it would send
// the shared context alone -- exactly the paid generation of nobody's prompt that the
// node's NO_SECTIONS guard exists to prevent. Dropped, and counted so the caller can say.
{
  const src = { id: 'p-list', type: 'prompt', position: { x: 0, y: 50 }, data: { text: '' } };
  const ctx = { id: 'p-ctx', type: 'prompt', position: { x: 0, y: 5 }, data: { text: 'shared style' } };
  const { nodes, edges } = graph([ctx, src, img(1, 0)], [
    { id: 'e0', source: 'p-ctx', target: 'out' },
    { id: 'e1', source: 'p-list', target: 'out' },
    { id: 'e2', source: 'i1', target: 'out' },
  ]);
  const one = freeBatch(nodes, edges, 'out', 'p-list', 'images: 1\n---\nA fox');
  assert.equal(one.runs.length, 1, 'the directive-only section is not a run');
  assert.equal(one.runs[0].prompt, 'shared style\n\nA fox');
  assert.equal(one.empty, 1);

  // Every section directive-only -> no runs at all, and the caller's NO_SECTIONS error.
  const none = freeBatch(nodes, edges, 'out', 'p-list', 'images: 1\n---\nimages: 1');
  assert.equal(none.runs.length, 0);
  assert.equal(none.empty, 2);
}

// The cap has one home. The dialog interpolates MAX_RUNS while truncation is computed from
// these defaults, so a raised constant that did not reach them would state a cap nothing
// enforces.
{
  const src = { id: 'p-list', type: 'prompt', position: { x: 0, y: 0 }, data: { text: '' } };
  const { nodes, edges } = graph([src], [{ id: 'e1', source: 'p-list', target: 'out' }]);
  const many = Array.from({ length: MAX_RUNS + 3 }, (_, i) => `item ${i}`).join('\n---\n');
  assert.equal(splitSections(many).blocks.length, MAX_RUNS, 'splitSections defaults to the cap');
  assert.equal(splitSections(many).truncated, 3);
  assert.equal(freeBatch(nodes, edges, 'out', 'p-list', many).runs.length, MAX_RUNS, 'and so does freeBatch');
}

// --- expandSlots ---

// The repair prompt asks for [2] rather than "image 2" so the model cannot echo the
// source's own numbering by reflex. The provider never sees a bracket.
{
  assert.equal(expandSlots('Apply the style of [1] to the composition of [2].'),
    'Apply the style of image 1 to the composition of image 2.');
  assert.equal(expandSlots('no slots here'), 'no slots here');
  assert.equal(expandSlots(''), '');
  assert.equal(expandSlots(undefined), '');
  // Runs through parseImagePicks, which is where the substitution actually happens --
  // so what freeBatch assembles is already the phrasing an image model expects.
  const { text, picks } = parseImagePicks('images: 1, 3\nBlend [1] into [2].');
  assert.deepEqual(picks, [1, 3]);
  assert.equal(text, 'Blend image 1 into image 2.');
}

console.log('resolve.js: all checks passed');
