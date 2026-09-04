// node server/graph.test.js  (also runs as part of `npm test`)
//
// The pure core of the document: every op applies, every op's inverse restores the
// exact prior graph, a batch is all-or-nothing, and structural nonsense is rejected
// rather than half-applied. Nothing here touches disk; the journal is graph.test.js's
// second half (see below) and the routes are host.test.js's business.
import assert from 'node:assert/strict';
import { applyOp, emptyGraph } from './graph.js';

const node = (id, extra = {}) => ({
  id,
  type: 'prompt',
  position: { x: 0, y: 0 },
  data: { text: `p${id}` },
  ...extra,
});
const edge = (id, source, target) => ({ id, source, target });

// Applying an op and then its inverse must land on a graph deep-equal to the start.
// Every op below goes through this; a new op type that skips it is the bug.
function roundTrips(graph, op) {
  const a = applyOp(graph, op);
  assert.equal(a.rejected, undefined, `expected ${op.type} to apply: ${a.rejected}`);
  const b = applyOp(a.graph, a.inverse);
  assert.equal(b.rejected, undefined, `inverse of ${op.type} rejected: ${b.rejected}`);
  assert.deepEqual(b.graph, graph, `${op.type} did not round-trip through its inverse`);
  return a;
}

// ---- addNode ----
{
  const g = emptyGraph();
  const a = roundTrips(g, { type: 'addNode', node: node('1') });
  assert.deepEqual(a.graph.nodes, [node('1')]);
  assert.deepEqual(a.inverse, { type: 'removeNode', id: '1' });
  // Immutable: the input graph is untouched.
  assert.deepEqual(g, emptyGraph());
  // Transient React Flow flags never reach the document.
  const b = applyOp(g, { type: 'addNode', node: node('2', { selected: true, dragging: true }) });
  assert.deepEqual(b.graph.nodes, [node('2')]);
  // Duplicate id is structural, not a merge.
  const dup = applyOp(a.graph, { type: 'addNode', node: node('1') });
  assert.match(dup.rejected, /already exists/);
}

// ---- updateNode ----
{
  const g = applyOp(emptyGraph(), { type: 'addNode', node: node('1', { data: { text: 'a', keep: 1, gone: 'x' } }) }).graph;
  const a = roundTrips(g, { type: 'updateNode', id: '1', patch: { text: 'b', added: true, gone: null } });
  assert.deepEqual(a.graph.nodes[0].data, { text: 'b', keep: 1, added: true });
  // The inverse names exactly what changed: prior values, and null for keys that were added.
  assert.deepEqual(a.inverse, { type: 'updateNode', id: '1', patch: { text: 'a', added: null, gone: 'x' } });
  assert.match(applyOp(g, { type: 'updateNode', id: 'nope', patch: {} }).rejected, /no node/);
  // A node with no data yet still takes a patch.
  const bare = applyOp(emptyGraph(), { type: 'addNode', node: { id: 'b', type: 'prompt', position: { x: 0, y: 0 } } }).graph;
  assert.deepEqual(applyOp(bare, { type: 'updateNode', id: 'b', patch: { text: 't' } }).graph.nodes[0].data, { text: 't' });
}

// ---- moveNode / resizeNode ----
{
  const g = applyOp(emptyGraph(), { type: 'addNode', node: node('1') }).graph;
  const m = roundTrips(g, { type: 'moveNode', id: '1', position: { x: 10, y: 20 } });
  assert.deepEqual(m.graph.nodes[0].position, { x: 10, y: 20 });
  assert.deepEqual(m.inverse, { type: 'moveNode', id: '1', position: { x: 0, y: 0 } });
  const r = roundTrips(g, { type: 'resizeNode', id: '1', width: 300, height: 200 });
  assert.equal(r.graph.nodes[0].width, 300);
  assert.equal(r.graph.nodes[0].height, 200);
  // A node that had no size: the inverse clears it rather than inventing one.
  assert.deepEqual(r.inverse, { type: 'resizeNode', id: '1', width: null, height: null });
  assert.equal(applyOp(r.graph, r.inverse).graph.nodes[0].width, undefined);
  assert.match(applyOp(g, { type: 'moveNode', id: 'x', position: { x: 0, y: 0 } }).rejected, /no node/);
}

// ---- edges ----
{
  let g = emptyGraph();
  g = applyOp(g, { type: 'addNode', node: node('1') }).graph;
  g = applyOp(g, { type: 'addNode', node: node('2') }).graph;
  const a = roundTrips(g, { type: 'addEdge', edge: edge('e1', '1', '2') });
  assert.deepEqual(a.inverse, { type: 'removeEdge', id: 'e1' });
  assert.match(applyOp(g, { type: 'addEdge', edge: edge('e2', '1', 'ghost') }).rejected, /no node/);
  assert.match(applyOp(a.graph, { type: 'addEdge', edge: edge('e1', '1', '2') }).rejected, /already exists/);
  roundTrips(a.graph, { type: 'removeEdge', id: 'e1' });
  assert.match(applyOp(g, { type: 'removeEdge', id: 'e9' }).rejected, /no edge/);
}

// ---- removeNode takes its edges with it, and the inverse brings them back ----
{
  let g = emptyGraph();
  for (const id of ['1', '2', '3']) g = applyOp(g, { type: 'addNode', node: node(id) }).graph;
  g = applyOp(g, { type: 'addEdge', edge: edge('e12', '1', '2') }).graph;
  g = applyOp(g, { type: 'addEdge', edge: edge('e23', '2', '3') }).graph;
  g = applyOp(g, { type: 'addEdge', edge: edge('e13', '1', '3') }).graph;
  const a = roundTrips(g, { type: 'removeNode', id: '2' });
  assert.deepEqual(a.graph.nodes.map((n) => n.id), ['1', '3']);
  assert.deepEqual(a.graph.edges.map((e) => e.id), ['e13']);
  assert.equal(a.inverse.type, 'batch');
  assert.match(applyOp(g, { type: 'removeNode', id: 'x' }).rejected, /no node/);
  // Order is z-order: a removed edge or node goes back where it was, not on top. The
  // round-trip above already proves it for a node in the middle; this pins it for an edge.
  const e = roundTrips(g, { type: 'removeEdge', id: 'e12' });
  assert.deepEqual(e.inverse, { type: 'addEdge', edge: edge('e12', '1', '2'), index: 0 });
  // An explicit index inserts there; an index past the end appends.
  const mid = applyOp(g, { type: 'addNode', node: node('1.5'), index: 1 }).graph;
  assert.deepEqual(mid.nodes.map((n) => n.id), ['1', '1.5', '2', '3']);
  const far = applyOp(g, { type: 'addNode', node: node('9'), index: 99 }).graph;
  assert.deepEqual(far.nodes.map((n) => n.id), ['1', '2', '3', '9']);
}

// ---- batch is all-or-nothing ----
{
  const g = applyOp(emptyGraph(), { type: 'addNode', node: node('1') }).graph;
  const ok = roundTrips(g, {
    type: 'batch',
    ops: [
      { type: 'addNode', node: node('2') },
      { type: 'addEdge', edge: edge('e', '1', '2') },
      { type: 'moveNode', id: '1', position: { x: 5, y: 5 } },
    ],
  });
  assert.equal(ok.graph.nodes.length, 2);
  assert.equal(ok.graph.edges.length, 1);
  // Inverse is the reversed list of inverses, itself a batch.
  assert.deepEqual(ok.inverse.ops.map((o) => o.type), ['moveNode', 'removeEdge', 'removeNode']);
  const bad = applyOp(g, {
    type: 'batch',
    ops: [
      { type: 'addNode', node: node('2') },
      { type: 'addEdge', edge: edge('e', '1', 'ghost') },
    ],
  });
  assert.match(bad.rejected, /no node/);
  assert.equal(bad.graph, undefined, 'a rejected batch must not hand back a partial graph');
}

// ---- unknown op ----
assert.match(applyOp(emptyGraph(), { type: 'teleport' }).rejected, /unknown op/);

console.log('graph.test.js: ok');
