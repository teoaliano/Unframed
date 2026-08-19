// Assert-based self-check. Run with: node client/src/graph/edgeHits.test.js
import assert from 'node:assert/strict';
import { hitEdges } from './edgeHits.js';

// A path running diagonally from (0,0) to (100,100), sampled every 10 units.
const diagonal = {
  id: 'e1',
  points: Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: i * 10 })),
};

// A rectangle the path passes through.
{
  const rect = { x: 40, y: 40, width: 20, height: 20 };
  assert.deepEqual([...hitEdges(rect, [diagonal])], ['e1']);
}

// The case that fails if anyone swaps sampling for a bounding box: this rectangle sits
// well inside the path's bounding box and nowhere near the path itself.
{
  const rect = { x: 5, y: 80, width: 20, height: 15 };
  assert.equal(hitEdges(rect, [diagonal]).size, 0);
}

// A rectangle nowhere near it at all.
{
  const rect = { x: 500, y: 500, width: 10, height: 10 };
  assert.equal(hitEdges(rect, [diagonal]).size, 0);
}

// The rectangle's own edges count as inside, so a box that just grazes the path hits.
{
  const rect = { x: 50, y: 50, width: 10, height: 10 };
  assert.deepEqual([...hitEdges(rect, [diagonal])], ['e1']);
}

// Several paths, only the crossed one comes back.
{
  const far = { id: 'e2', points: [{ x: 900, y: 900 }, { x: 950, y: 950 }] };
  const rect = { x: 40, y: 40, width: 20, height: 20 };
  assert.deepEqual([...hitEdges(rect, [diagonal, far])], ['e1']);
}

// A path with no samples cannot be hit, and must not throw.
{
  const rect = { x: 0, y: 0, width: 1000, height: 1000 };
  assert.equal(hitEdges(rect, [{ id: 'e3', points: [] }]).size, 0);
}

console.log('edgeHits.test.js ok');
