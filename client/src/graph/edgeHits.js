// Which connectors a selection rectangle crosses.
//
// React Flow already selects any edge with an endpoint on a selected node, so this
// covers exactly one gap: a box drawn across a connector in empty canvas, touching
// neither of its nodes. Both halves live here, but only the geometry is pure and
// tested -- reading the drawn paths needs the DOM.

// Enough to catch a rectangle drawn across any bend a bezier between two nodes can
// make, and cheap: a canvas has tens of edges, not thousands.
const SAMPLES = 24;

/**
 * @param {{x: number, y: number, width: number, height: number}} rect - flow coordinates
 * @param {Array<{id: string, points: Array<{x: number, y: number}>}>} paths
 * @returns {Set<string>} ids of the paths with at least one point inside the rectangle
 */
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

/**
 * Samples every edge currently drawn on the canvas.
 *
 * The points come back in FLOW coordinates with no conversion, because the SVG the
 * paths live in sits inside React Flow's viewport transform -- its user space IS flow
 * space. Sampling the path rather than taking its bounding box is the whole point: a
 * long diagonal connector's bounding box covers a large empty region, so a box drawn
 * nowhere near the curve would select it.
 *
 * @param {number} [count] - points per path
 * @returns {Array<{id: string, points: Array<{x: number, y: number}>}>}
 */
export function samplePaths(count = SAMPLES) {
  const out = [];
  for (const g of document.querySelectorAll('.react-flow__edge[data-id]')) {
    const path = g.querySelector('path.react-flow__edge-path');
    if (!path) continue;
    const total = path.getTotalLength();
    const points = [];
    for (let i = 0; i <= count; i++) {
      const { x, y } = path.getPointAtLength((total * i) / count);
      points.push({ x, y });
    }
    out.push({ id: g.dataset.id, points });
  }
  return out;
}
