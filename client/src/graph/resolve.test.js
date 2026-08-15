// Assert-based self-check. Run with: node client/src/graph/resolve.test.js
import assert from 'node:assert/strict';
import { buildRequest, bucketSources, sourceRoles, splitSections, findWiredTextNode, freeRunPrompts, isOutput, isTextOutput } from './resolve.js';
import { migrateNodes } from './migrate.js';
import { instantiateFragment, centerOffset } from '../library/insert.js';
import { selectionFragment, presetFromSelection } from '../library/save.js';

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

// --- findWiredTextNode / freeRunPrompts ---

// No text node wired in -> undefined.
{
  const { nodes, edges } = graph(
    [{ id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'hello' } }],
    [{ id: 'e1', source: 'p1', target: 'out' }],
  );
  assert.equal(findWiredTextNode(nodes, edges, 'out'), undefined);
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
  assert.equal(findWiredTextNode(nodes, edges, 'out').id, 't-hi');
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
  const found = findWiredTextNode(nodes, edges, 'out');
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
    { id: 'b', type: 'videoOutput', selected: true, data: {} },
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

console.log('resolve.js: all checks passed');
