// Assert-based self-check. Run with: node client/src/graph/bulkWire.test.js
import assert from 'node:assert/strict';
import { canSource, canTarget, selectedIds, connections, dropInternal } from './bulkWire.js';

const node = (id, type, selected = false) => ({ id, type, selected, position: { x: 0, y: 0 }, data: {} });

// Which end each node type can be. A text output is both, every other output is
// a target only, and every input is a source only.
{
  assert.equal(canSource(node('p', 'prompt')), true);
  assert.equal(canSource(node('i', 'image')), true);
  assert.equal(canSource(node('v', 'video')), true);
  assert.equal(canSource(node('t', 'textOutput')), true);
  assert.equal(canSource(node('o', 'imageOutput')), false);
  assert.equal(canSource(node('w', 'videoOutput')), false);
  // An artifact is neither end: it is a thing on the board, not a step in a chain.
  assert.equal(canSource(node('g', 'page')), false);
  assert.equal(canTarget(node('g', 'page')), false);

  assert.equal(canTarget(node('o', 'imageOutput')), true);
  assert.equal(canTarget(node('w', 'videoOutput')), true);
  assert.equal(canTarget(node('t', 'textOutput')), true);
  assert.equal(canTarget(node('p', 'prompt')), false);

  // A group is a source; the nodes inside it are not, whatever their type. The group
  // holds the one handle and wires for its contents.
  assert.equal(canSource(node('g', 'group')), true);
  assert.equal(canSource({ ...node('i', 'image'), parentId: 'g' }), false);
  assert.equal(canSource({ ...node('p', 'prompt'), parentId: 'g' }), false);
  assert.equal(canTarget(node('g', 'group')), false);
}

// selectedIds filters by BOTH selection and capability -- an unselected prompt
// is not swept in just because it could be a source.
{
  const nodes = [
    node('p1', 'prompt', true),
    node('p2', 'prompt', false),
    node('o1', 'imageOutput', true),
  ];
  assert.deepEqual(selectedIds(nodes, canSource), ['p1']);
  assert.deepEqual(selectedIds(nodes, canTarget), ['o1']);
}

// The menu's Connect: full fan-out, every source to every target.
{
  const fresh = connections({ edges: [], sources: ['p1', 'p2', 'p3'], targets: ['o1', 'o2'] });
  assert.equal(fresh.length, 6);
  assert.deepEqual(fresh[0], { source: 'p1', target: 'o1' });
  assert.deepEqual(fresh[5], { source: 'p3', target: 'o2' });
}

// An edge already on the canvas is not drawn a second time.
{
  const edges = [{ id: 'e1', source: 'p1', target: 'o1' }];
  const fresh = connections({ edges, sources: ['p1', 'p2'], targets: ['o1'] });
  assert.deepEqual(fresh, [{ source: 'p2', target: 'o1' }]);
}

// Nor twice within one batch, when the same pair is reachable two ways.
{
  const fresh = connections({ edges: [], sources: ['p1', 'p1'], targets: ['o1'] });
  assert.deepEqual(fresh, [{ source: 'p1', target: 'o1' }]);
}

// A node never wires into itself, which is reachable here because a text output
// appears in both the sources list and the targets list.
{
  const fresh = connections({ edges: [], sources: ['t1'], targets: ['t1'] });
  assert.deepEqual(fresh, []);
}

// Two text outputs selected together: one direction, never the cycle. Which one
// wins does not matter; that only one does, does.
{
  const fresh = connections({ edges: [], sources: ['t1', 't2'], targets: ['t1', 't2'] });
  assert.equal(fresh.length, 1);
  assert.deepEqual(fresh, [{ source: 't1', target: 't2' }]);
}

// And a reverse edge drawn earlier blocks the forward one just the same -- the
// loop closes whether or not both halves came from the same click.
{
  const edges = [{ id: 'e1', source: 't2', target: 't1' }];
  const fresh = connections({ edges, sources: ['t1'], targets: ['t2'] });
  assert.deepEqual(fresh, []);
}

// Disconnect drops only what is wholly inside the selection: p1->o1 goes, and
// the edge reaching out to an unselected node stays.
{
  const edges = [
    { id: 'e1', source: 'p1', target: 'o1' },
    { id: 'e2', source: 'p9', target: 'o1' },
    { id: 'e3', source: 'p1', target: 'o9' },
  ];
  const kept = dropInternal(edges, ['p1', 'o1']);
  assert.deepEqual(kept.map((e) => e.id), ['e2', 'e3']);
}

// Nothing selected, nothing dropped.
{
  const edges = [{ id: 'e1', source: 'p1', target: 'o1' }];
  assert.deepEqual(dropInternal(edges, []), edges);
}

console.log('bulkWire.test.js ok');
