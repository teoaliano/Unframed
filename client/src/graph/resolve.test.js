// Assert-based self-check. Run with: node client/src/graph/resolve.test.js
import assert from 'node:assert/strict';
import { buildRequest, imageRefNumber, splitSections } from './resolve.js';

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

// imageRefNumber: an image wired only into a text node (not the image output)
// still counts as connected, since text nodes consume edges too. An unwired
// image is null.
{
  const { nodes, edges } = graph(
    [
      { id: 't1', type: 'text', position: { x: 0, y: 0 }, data: {} },
      { id: 'i1', type: 'image', position: { x: 0, y: 10 }, data: { dataUrl: 'data:image/png;base64,AAA' } },
      { id: 'i2', type: 'image', position: { x: 0, y: 20 }, data: { dataUrl: 'data:image/png;base64,BBB' } },
    ],
    [{ id: 'e1', source: 'i1', target: 't1' }],
  );
  assert.equal(imageRefNumber(nodes, edges, 'i1'), 1);
  assert.equal(imageRefNumber(nodes, edges, 'i2'), null);
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

console.log('resolve.js: all checks passed');
