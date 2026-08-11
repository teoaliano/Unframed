// Assert-based self-check. Run with: node client/src/graph/resolve.test.js
import assert from 'node:assert/strict';
import { buildRequest, imageRefNumbers, splitSections, findWiredTextNode, freeRunPrompts } from './resolve.js';
import { instantiateFragment, centerOffset } from '../library/insert.js';

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
  assert.deepEqual(imageRefNumbers(nodes, edges, 'v1', 'video'), [1]);
  assert.deepEqual(imageRefNumbers(nodes, edges, 'i2'), [2]);
  // Kind mismatch returns nothing rather than a wrong rank.
  assert.deepEqual(imageRefNumbers(nodes, edges, 'v1'), []);
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
      { id: 't-lo', type: 'text', position: { x: 0, y: 50 }, data: { result: 'a\n---\nb' } },
      { id: 't-hi', type: 'text', position: { x: 0, y: 10 }, data: { result: 'c\n---\nd' } },
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
  const textNode = { id: 't1', type: 'text', position: { x: 0, y: 50 }, data: { result: 'one\n---\ntwo' } };
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
      { id: 'o1', type: 'output', position: { x: 400, y: 0 }, data: { freeRuns: true } },
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

console.log('resolve.js: all checks passed');
