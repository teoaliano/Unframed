// Where the selection toolbar (and the composer it morphs into) sits: centred above the
// selection's bounding box, clamped to the viewport's sides, flipped below when there is
// no room above. Pure, so the flip and the clamp are pinned in placement.test.js and
// the composer -- a taller box on the same anchor -- lands on the same centre and the
// same bottom edge, which is what makes the morph read as one element changing shape.
// Design: docs/superpowers/specs/2026-09-04-agent-canvas-slice-2-design.md, section 4.
//
// All numbers are pixels in the same frame (the canvas element's). `box` is the
// selection in that frame; `size` the toolbar's own; `viewport` the canvas element's
// size; `gap` the space between the box and the toolbar; `margin` how close to a
// viewport edge the toolbar may get.

export const GAP = 12;
export const MARGIN = 8;

export function place({ box, size, viewport, gap = GAP, margin = MARGIN }) {
  const centre = box.x + box.width / 2;
  const x = clamp(centre - size.width / 2, margin, Math.max(margin, viewport.width - size.width - margin));
  const above = box.y - gap - size.height;
  if (above >= margin) return { x, y: above, below: false };
  const belowY = box.y + box.height + gap;
  // Nowhere above and nowhere below: pin to the top margin rather than off-screen.
  if (belowY + size.height + margin > viewport.height && above < margin) {
    return { x, y: Math.max(margin, Math.min(belowY, viewport.height - size.height - margin)), below: true };
  }
  return { x, y: belowY, below: true };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// The selection's bounding box in flow coordinates from React Flow's node objects: the
// stored size when the user set one, the measured DOM size otherwise, a default when
// neither exists yet (a node added this instant).
export function selectionBox(nodes, fallback = { width: 240, height: 150 }) {
  const picked = nodes.filter((n) => n.selected);
  if (!picked.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of picked) {
    const w = n.width ?? n.measured?.width ?? fallback.width;
    const h = n.height ?? n.measured?.height ?? fallback.height;
    x1 = Math.min(x1, n.position.x);
    y1 = Math.min(y1, n.position.y);
    x2 = Math.max(x2, n.position.x + w);
    y2 = Math.max(y2, n.position.y + h);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

// Flow box -> the canvas element's pixels, given React Flow's transform [tx, ty, zoom].
export function toScreen(box, [tx, ty, zoom]) {
  return { x: box.x * zoom + tx, y: box.y * zoom + ty, width: box.width * zoom, height: box.height * zoom };
}
