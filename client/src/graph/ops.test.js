// node client/src/graph/ops.test.js  (also runs as part of `npm test`)
//
// The browser's half of the document protocol: turn "the graph was X and is now Y" into
// the ops that say so, and apply a journal entry from the server onto React Flow arrays.
import assert from 'node:assert/strict';
import { diffGraphs, applyEntry, persistentNode } from './ops.js';

const node = (id, extra = {}) => ({ id, type: 'prompt', position: { x: 0, y: 0 }, data: { text: id }, ...extra });
const edge = (id, source, target) => ({ id, source, target });
const g = (nodes, edges = []) => ({ nodes, edges });

// ---- nothing changed, nothing to say ----
assert.deepEqual(diffGraphs(g([node('1')]), g([node('1')])), []);
// Transient React Flow state is not a change: selecting, dragging, measuring.
assert.deepEqual(
  diffGraphs(g([node('1')]), g([node('1', { selected: true, dragging: true, measured: { width: 1, height: 1 } })])),
  [],
);
// Same content, new object identity: still nothing.
assert.deepEqual(diffGraphs(g([node('1')]), g([{ ...node('1'), data: { ...node('1').data } }])), []);

// ---- adds and removes ----
{
  const ops = diffGraphs(g([node('1')]), g([node('1'), node('2', { selected: true })]));
  assert.deepEqual(ops, [{ type: 'addNode', node: node('2') }], 'an added node is stripped of transient flags');
  assert.deepEqual(diffGraphs(g([node('1'), node('2')]), g([node('2')])), [{ type: 'removeNode', id: '1' }]);
}

// ---- moves, resizes, data patches ----
{
  const before = g([node('1', { width: 100 })]);
  const moved = g([node('1', { width: 100, position: { x: 5, y: 6 } })]);
  assert.deepEqual(diffGraphs(before, moved), [{ type: 'moveNode', id: '1', position: { x: 5, y: 6 } }]);
  const resized = g([node('1', { width: 200, height: 50 })]);
  assert.deepEqual(diffGraphs(before, resized), [{ type: 'resizeNode', id: '1', width: 200, height: 50 }]);
  const unsized = g([node('1')]);
  assert.deepEqual(diffGraphs(before, unsized), [{ type: 'resizeNode', id: '1', width: null, height: null }]);
  const patched = g([node('1', { width: 100, data: { text: 'new', extra: 1 } })]);
  assert.deepEqual(diffGraphs(before, patched), [{ type: 'updateNode', id: '1', patch: { text: 'new', extra: 1 } }]);
  const keyGone = g([node('1', { width: 100, data: {} })]);
  assert.deepEqual(diffGraphs(before, keyGone), [{ type: 'updateNode', id: '1', patch: { text: null } }], 'a removed key patches to null');
  // A key set to undefined is the same as no key: stripRunMarkers and withDrag write
  // undefined to mean "not set".
  const undef = g([node('1', { width: 100, data: { text: '1', running: undefined } })]);
  assert.deepEqual(diffGraphs(before, undef), []);
  const wasSet = g([node('1', { width: 100, data: { text: '1', running: { startedAt: 1 } } })]);
  assert.deepEqual(diffGraphs(wasSet, undef), [{ type: 'updateNode', id: '1', patch: { running: null } }], 'undefined after a value is a delete');
  // Deep-equal data values are not a change even when the reference differs.
  const sameDeep = g([node('1', { width: 100, data: { text: '1', list: [1, 2] } })]);
  const sameDeep2 = g([node('1', { width: 100, data: { text: '1', list: [1, 2] } })]);
  assert.deepEqual(diffGraphs(sameDeep, sameDeep2), []);
  // Everything at once comes out as one op per kind, in a stable order.
  const all = g([node('1', { width: 300, position: { x: 1, y: 1 }, data: { text: 'x' } })]);
  assert.deepEqual(
    diffGraphs(before, all).map((o) => o.type),
    ['moveNode', 'resizeNode', 'updateNode'],
  );
}

// ---- a type change is a remove + add (there is no retype op, on purpose) ----
assert.deepEqual(
  diffGraphs(g([node('1')]), g([node('1', { type: 'image' })])).map((o) => o.type),
  ['removeNode', 'addNode'],
);

// ---- edges ----
{
  const before = g([node('1'), node('2')], [edge('e1', '1', '2')]);
  assert.deepEqual(diffGraphs(before, g([node('1'), node('2')], [])), [{ type: 'removeEdge', id: 'e1' }]);
  assert.deepEqual(
    diffGraphs(before, g([node('1'), node('2')], [edge('e1', '1', '2'), { ...edge('e2', '2', '1'), selected: true }])),
    [{ type: 'addEdge', edge: edge('e2', '2', '1') }],
  );
  // Removing a node also drops its edges on the server, so the diff must not send those
  // removeEdge ops -- they would be rejected as "no edge" and read as a conflict.
  const dropped = diffGraphs(before, g([node('2')], []));
  assert.deepEqual(dropped, [{ type: 'removeNode', id: '1' }]);
  // Order matters for the server: removals before adds, nodes before edges.
  const churn = diffGraphs(before, g([node('2'), node('3')], [edge('e3', '2', '3')]));
  assert.deepEqual(churn.map((o) => o.type), ['removeNode', 'addNode', 'addEdge']);
}

// ---- applyEntry: a server entry lands on React Flow arrays, keeping local-only flags ----
{
  const nodes = [node('1', { selected: true }), node('2')];
  const edges = [edge('e1', '1', '2')];
  const moved = applyEntry({ nodes, edges }, { version: 3, op: { type: 'moveNode', id: '1', position: { x: 9, y: 9 } } });
  assert.deepEqual(moved.nodes[0].position, { x: 9, y: 9 });
  assert.equal(moved.nodes[0].selected, true, 'selection is this tab\'s and survives a remote move');
  assert.equal(moved.nodes[1], nodes[1], 'untouched nodes keep their identity, so React Flow does not rerender them');
  const removed = applyEntry({ nodes, edges }, { op: { type: 'removeNode', id: '1' } });
  assert.deepEqual(removed.nodes.map((n) => n.id), ['2']);
  assert.deepEqual(removed.edges, []);
  const batch = applyEntry(
    { nodes, edges },
    { op: { type: 'batch', ops: [{ type: 'addNode', node: node('3') }, { type: 'addEdge', edge: edge('e2', '2', '3') }] } },
  );
  assert.deepEqual(batch.nodes.map((n) => n.id), ['1', '2', '3']);
  assert.equal(batch.edges.length, 2);
  // An entry that no longer applies (stale, or already applied) leaves the arrays alone.
  const stale = applyEntry({ nodes, edges }, { op: { type: 'removeNode', id: 'ghost' } });
  assert.equal(stale.nodes, nodes);
  assert.equal(stale.edges, edges);
}

// ---- persistentNode is what an addNode carries ----
assert.deepEqual(persistentNode(node('1', { selected: true, dragging: false, measured: { width: 2, height: 2 } })), node('1'));

// ---- groups ----
{
  const G = node('G', { type: 'group', data: { name: 'hero' } });
  // Into a group: the parent change stands in for the move, carrying the new (relative)
  // position. Never a moveNode beside it, which would replay absolute coordinates as
  // relative ones.
  const free = g([G, node('1', { position: { x: 100, y: 100 } })]);
  const grouped = g([G, node('1', { parentId: 'G', position: { x: 20, y: 20 } })]);
  assert.deepEqual(diffGraphs(free, grouped), [{ type: 'reparentNode', id: '1', parentId: 'G', position: { x: 20, y: 20 } }]);
  // Out again: parentId null, the absolute position the tab computed.
  assert.deepEqual(diffGraphs(grouped, free), [{ type: 'reparentNode', id: '1', parentId: null, position: { x: 100, y: 100 } }]);
  // A plain drag inside the box is still a move.
  const nudged = g([G, node('1', { parentId: 'G', position: { x: 25, y: 20 } })]);
  assert.deepEqual(diffGraphs(grouped, nudged), [{ type: 'moveNode', id: '1', position: { x: 25, y: 20 } }]);
  // Deleting a group: React Flow drops the members from the tab's array too, but the
  // server cascades, so only the group's removeNode is sent -- a member's would bounce
  // as "no node" and take the whole batch with it.
  const withMembers = g([G, node('1', { parentId: 'G' }), node('2', { parentId: 'G' }), node('free')]);
  assert.deepEqual(diffGraphs(withMembers, g([node('free')])), [{ type: 'removeNode', id: 'G' }]);
  // A member removed on its own is still sent.
  assert.deepEqual(diffGraphs(withMembers, g([G, node('2', { parentId: 'G' }), node('free')])), [{ type: 'removeNode', id: '1' }]);
}

// ---- ungroup: members must escape BEFORE the box is removed ----
// The server's removeNode cascades to a group's members, so op ORDER is the whole of
// this: a removeNode sent first deletes the very nodes the reparent is about. Shipped
// that way and caught in the browser -- ungrouping emptied the box instead of freeing it.
{
  const G = node('G', { type: 'group', data: { name: 'hero' } });
  const before = g([G, node('1', { parentId: 'G', position: { x: 20, y: 20 } }), node('2', { parentId: 'G', position: { x: 20, y: 200 } })]);
  // What ungroup leaves behind: the box gone, the members loose at absolute positions.
  const after = g([node('1', { position: { x: 120, y: 120 } }), node('2', { position: { x: 120, y: 300 } })]);
  const ops = diffGraphs(before, after);

  const removeAt = ops.findIndex((o) => o.type === 'removeNode' && o.id === 'G');
  const reparents = ops.filter((o) => o.type === 'reparentNode');
  assert.equal(reparents.length, 2, 'both members are freed');
  for (const r of reparents) {
    assert.equal(r.parentId, null);
    assert.ok(ops.indexOf(r) < removeAt, `${r.id} must be reparented out before the group is removed`);
  }
  // The reparent carries the new absolute position, so no moveNode travels beside it.
  assert.deepEqual(reparents.find((r) => r.id === '1').position, { x: 120, y: 120 });
  assert.equal(ops.some((o) => o.type === 'moveNode'), false);
  assert.deepEqual(ops.filter((o) => o.type === 'removeNode').map((o) => o.id), ['G']);
}

console.log('ops.test.js: ok');
