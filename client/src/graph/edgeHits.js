// Which connectors a selection rectangle crosses.
//
// React Flow already selects any edge with an endpoint on a selected node, so this
// covers exactly one gap: a box drawn across a connector in empty canvas, touching
// neither of its nodes. Both halves live here, but only the geometry is pure and
// tested -- reading the drawn paths needs the DOM.

// A cheap fixed count, not one that scales with path length: a canvas has tens of
// edges, not thousands, but a long cross-canvas connector gets wide sample spacing,
// so a small selection box drawn precisely across it can still slip between samples.
const SAMPLES = 24;

export function hitEdges(rect, paths) {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const hits = new Set();
  for (const { id, points } of paths) {
    for (const p of points) {
      if (p.x >= rect.x && p.x <= right && p.y >= rect.y && p.y <= bottom) {
        hits.add(id);
        break;
      }
    }
  }
  return hits;
}

// Samples every edge currently drawn on the canvas.
//
// The points come back in FLOW coordinates with no conversion, because the SVG the
// paths live in sits inside React Flow's viewport transform -- its user space IS flow
// space.
export function samplePaths() {
  const out = [];
  for (const g of document.querySelectorAll('.react-flow__edge[data-id]')) {
    const path = g.querySelector('path.react-flow__edge-path');
    if (!path) continue;
    const total = path.getTotalLength();
    const points = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const { x, y } = path.getPointAtLength((total * i) / SAMPLES);
      points.push({ x, y });
    }
    out.push({ id: g.dataset.id, points });
  }
  return out;
}
