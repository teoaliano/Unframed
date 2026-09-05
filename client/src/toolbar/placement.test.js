// Assert-based self-check. Run with: node client/src/toolbar/placement.test.js
import assert from 'node:assert/strict';
import { place, selectionBox, toScreen, GAP, MARGIN } from './placement.js';

const viewport = { width: 1000, height: 700 };
const size = { width: 200, height: 40 };

// Centred above, with the gap.
{
  const p = place({ box: { x: 400, y: 300, width: 100, height: 100 }, size, viewport });
  assert.deepEqual(p, { x: 450 - 100, y: 300 - GAP - 40, below: false });
}

// The composer is taller but lands on the same centre and the same bottom edge.
{
  const box = { x: 400, y: 300, width: 100, height: 100 };
  const bar = place({ box, size, viewport });
  const composer = place({ box, size: { width: 360, height: 160 }, viewport });
  assert.equal(bar.x + size.width / 2, composer.x + 360 / 2, 'same centre');
  assert.equal(bar.y + size.height, composer.y + 160, 'same bottom edge');
}

// Clamped to the sides, never off-screen.
assert.equal(place({ box: { x: -50, y: 300, width: 20, height: 20 }, size, viewport }).x, MARGIN);
assert.equal(place({ box: { x: 990, y: 300, width: 20, height: 20 }, size, viewport }).x, 1000 - 200 - MARGIN);

// No room above: flips below the box.
{
  const p = place({ box: { x: 400, y: 20, width: 100, height: 100 }, size, viewport });
  assert.deepEqual(p, { x: 350, y: 120 + GAP, below: true });
}
// Exactly enough room above stays above.
assert.equal(place({ box: { x: 0, y: MARGIN + GAP + 40, width: 10, height: 10 }, size, viewport }).below, false);
// No room either way: pinned inside the viewport.
{
  const p = place({ box: { x: 0, y: 10, width: 10, height: 690 }, size, viewport });
  assert.ok(p.y >= MARGIN && p.y + size.height <= viewport.height - MARGIN);
  assert.equal(p.below, true);
}
// A viewport narrower than the toolbar: sits at the margin rather than at a negative x.
assert.equal(place({ box: { x: 0, y: 300, width: 10, height: 10 }, size, viewport: { width: 100, height: 700 } }).x, MARGIN);

// The selection's box: stored size, then measured, then a default.
{
  const nodes = [
    { id: 'a', selected: true, position: { x: 10, y: 20 }, width: 100, height: 50 },
    { id: 'b', selected: true, position: { x: 200, y: 0 }, measured: { width: 80, height: 300 } },
    { id: 'c', selected: false, position: { x: -500, y: -500 }, width: 10, height: 10 },
    { id: 'd', selected: true, position: { x: 50, y: 100 } },
  ];
  assert.deepEqual(selectionBox(nodes), { x: 10, y: 0, width: 290 - 10, height: 300 }, 'd is 240 wide by default, so it reaches 290');
  assert.deepEqual(selectionBox(nodes, { width: 1000, height: 1000 }), { x: 10, y: 0, width: 1050 - 10, height: 1100 });
  assert.equal(selectionBox([{ id: 'x', selected: false, position: { x: 0, y: 0 } }]), null);
  assert.equal(selectionBox([]), null);
}

// Flow -> screen through React Flow's transform.
assert.deepEqual(toScreen({ x: 100, y: 50, width: 200, height: 100 }, [10, 20, 0.5]), { x: 60, y: 45, width: 100, height: 50 });

console.log('placement.test.js: ok');
