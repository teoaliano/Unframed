// node client/src/graph/grouping.test.js  (also runs as part of `npm test`)
//
// Wrapping a selection into a group and unwrapping it again: the geometry (absolute
// positions become relative to the box, and back) and the edge rule (a member's wires
// collapse onto the box, and are handed back on ungroup).
import assert from 'node:assert/strict';
import { groupSelection, ungroup, groupable, absolutePosition } from './grouping.js';

const at = (id, x, y, extra = {}) => ({ id, type: 'image', position: { x, y }, data: {}, width: 100, height: 100, ...extra });
const out = { id: 'out', type: 'imageOutput', position: { x: 900, y: 0 }, data: {} };

// ---- who can be wrapped ----
{
  assert.equal(groupable(at('i', 0, 0)), true);
  assert.equal(groupable({ id: 'p', type: 'prompt', position: { x: 0, y: 0 } }), true);
  assert.equal(groupable(out), false, 'an output consumes edges; a group is a source');
  assert.equal(groupable({ id: 'g', type: 'group', position: { x: 0, y: 0 } }), false, 'no nesting');
  assert.equal(groupable(undefined), false);
}

// ---- the box wraps its contents, and positions become relative ----
{
  const nodes = [at('a', 200, 200), at('b', 400, 500), out];
  const r = groupSelection(nodes, [], ['a', 'b'], 'G');
  // The box starts above and left of the topmost, leftmost member...
  assert.ok(r.node.position.x < 200 && r.node.position.y < 200);
  // ...and is big enough to contain both, which is the property that matters rather
  // than the exact padding.
  const right = r.node.position.x + r.node.width;
  const bottom = r.node.position.y + r.node.height;
  assert.ok(right >= 500 && bottom >= 600, `box ${r.node.width}x${r.node.height} must contain both nodes`);
  assert.equal(r.node.type, 'group');
  // Every member is now positioned INSIDE the box, and kept there while dragged.
  for (const m of r.members) {
    assert.equal(m.parentId, 'G');
    assert.equal(m.extent, 'parent');
    assert.ok(m.position.x >= 0 && m.position.y >= 0, 'relative, not absolute');
  }
  // The conversion is exact: relative + box origin is where the node actually was.
  const a = r.members.find((m) => m.id === 'a');
  assert.deepEqual(
    { x: a.position.x + r.node.position.x, y: a.position.y + r.node.position.y },
    { x: 200, y: 200 },
  );
  // Nothing groupable in the selection is not an empty group, it is nothing -- which is
  // what the menu item and the shortcut gate on.
  assert.equal(groupSelection(nodes, [], ['out'], 'G'), null);
  assert.equal(groupSelection(nodes, [], [], 'G'), null);
}

// ---- media has no height of its own, and must not collapse the box ----
{
  // withDrag deliberately leaves an image's height undefined so its aspect ratio derives
  // one. Measured is what the DOM reported; with neither, a fallback keeps the box real.
  const nodes = [
    { id: 'm', type: 'image', position: { x: 0, y: 0 }, data: {}, width: 240, measured: { width: 240, height: 180 } },
    { id: 'n', type: 'image', position: { x: 0, y: 400 }, data: {} },
  ];
  const r = groupSelection(nodes, [], ['m', 'n'], 'G');
  assert.ok(Number.isFinite(r.node.width) && Number.isFinite(r.node.height));
  assert.ok(r.node.height > 400);
}

// ---- the edge rule: member wires collapse onto the box ----
{
  const nodes = [at('a', 0, 0), at('b', 0, 200), at('c', 0, 400), out];
  const edges = [
    { id: 'ea', source: 'a', target: 'out' },
    { id: 'eb', source: 'b', target: 'out' },
  ];
  // a and b both fed out; grouping all three gives ONE wire from the box.
  const r = groupSelection(nodes, edges, ['a', 'b', 'c'], 'G');
  assert.deepEqual(r.edges.map((e) => [e.source, e.target]), [['G', 'out']]);
  // c was not wired, and now travels too -- a group sends everything in it. Visible
  // immediately, since badges and the request both read bucketSources.
  assert.equal(r.members.length, 3);

  // Two distinct targets: one wire each, in the order the edges were drawn.
  const out2 = { id: 'out2', type: 'videoOutput', position: { x: 900, y: 400 }, data: {} };
  const many = groupSelection(
    [...nodes, out2],
    [...edges, { id: 'ec', source: 'c', target: 'out2' }],
    ['a', 'b', 'c'],
    'G',
  );
  assert.deepEqual(many.edges.map((e) => e.target), ['out', 'out2']);

  // Edges that touch nothing in the selection are left exactly alone.
  const other = at('z', 0, 900);
  const untouched = groupSelection([...nodes, other], [...edges, { id: 'ez', source: 'z', target: 'out' }], ['a'], 'G');
  assert.ok(untouched.edges.some((e) => e.id === 'ez'), "another node's wire is not this action's business");
}

// ---- ungroup: contents come back where they look, and send what they were sending ----
{
  const nodes = [at('a', 0, 0), at('b', 0, 200), out];
  const edges = [{ id: 'ea', source: 'a', target: 'out' }];
  const g = groupSelection(nodes, edges, ['a', 'b'], 'G');
  const after = [g.node, ...g.members, out];

  const u = ungroup(after, g.edges, 'G');
  // Absolute positions restored exactly: group then ungroup leaves the canvas as it was.
  assert.deepEqual(u.members.find((m) => m.id === 'a').position, { x: 0, y: 0 });
  assert.deepEqual(u.members.find((m) => m.id === 'b').position, { x: 0, y: 200 });
  for (const m of u.members) {
    assert.equal('parentId' in m, false, 'no dangling parentId key');
    assert.equal('extent' in m, false);
  }
  // The box's wire is handed to every member, so what reaches the model is unchanged by
  // ungrouping -- which is what makes Group reversible rather than a decision.
  assert.deepEqual(u.edges.map((e) => [e.source, e.target]).sort(), [['a', 'out'], ['b', 'out']]);
  assert.equal(ungroup(after, g.edges, 'nope'), null);
  assert.equal(ungroup([out], [], 'out'), null, 'only a group can be ungrouped');
}

// ---- a node already inside a group is measured, and re-homed, by where it LOOKS ----
{
  const nodes = [
    { id: 'G', type: 'group', position: { x: 100, y: 100 }, data: {}, width: 400, height: 400 },
    at('m', 50, 50, { parentId: 'G', extent: 'parent' }),
    at('free', 600, 600),
  ];
  assert.deepEqual(absolutePosition(nodes, nodes[1]), { x: 150, y: 150 });
  const r = groupSelection(nodes, [], ['m', 'free'], 'H');
  const m = r.members.find((x) => x.id === 'm');
  assert.equal(m.parentId, 'H');
  assert.deepEqual(
    { x: m.position.x + r.node.position.x, y: m.position.y + r.node.position.y },
    { x: 150, y: 150 },
    'it lands where it appeared, not where its old relative coordinates would put it',
  );
}

console.log('grouping.test.js ok');
