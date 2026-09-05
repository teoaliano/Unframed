// Turning a selection into a group, and a group back into loose nodes. Pure: the
// geometry and the edge bookkeeping only, so `node grouping.test.js` runs it with no
// DOM and no React Flow. App.jsx does the state writing.
//
// Split out under CLAUDE.md's earns-its-own-tests rule, and it earns it twice over.
// Wrapping a selection converts every member's ABSOLUTE position into one relative to
// the new box, and getting that backwards puts the contents somewhere off screen the
// first time anyone groups two nodes that are not already near the origin. And the edge
// rule below is a money rule, not a tidiness one.
//
// Design: docs/superpowers/specs/2026-09-05-group-node-design.md.
import { isGroup, isOutput } from './resolve.js';

// A group is a box drawn around its contents, so it needs a margin the contents sit
// inside. TOP is larger than the rest because a node's name tag is docked ABOVE its
// card (NodeHeader) and would otherwise hang outside the box it belongs to, and
// because the group's own name sits in that strip.
const PAD = 28;
const TOP = 56;

// What a node occupies on the canvas. `width`/`height` are the user-set size withDrag
// seeds; `measured` is what the DOM reported. Media deliberately has NO height (its
// aspect ratio derives one, see withDrag), so a fallback is required rather than tidy:
// without it every image would contribute NaN and the whole box would collapse.
const sizeOf = (n) => ({
  w: n.width ?? n.measured?.width ?? 240,
  h: n.height ?? n.measured?.height ?? 160,
});

// A node's position is relative to its parent when it has one, so a node already inside
// a group has to be converted before it can be measured against nodes that are not.
export function absolutePosition(nodes, node) {
  const x = node.position?.x ?? 0;
  const y = node.position?.y ?? 0;
  if (!node.parentId) return { x, y };
  const parent = nodes.find((n) => n.id === node.parentId);
  if (!parent) return { x, y };
  const base = absolutePosition(nodes, parent);
  return { x: base.x + x, y: base.y + y };
}

// Who may be wrapped. Outputs consume edges and a group is a source, so an output in the
// selection is skipped rather than refused -- dragging a box round a whole flow and
// pressing the shortcut should group the inputs, not do nothing. A group is skipped for
// the same reason plus the no-nesting rule.
export const groupable = (n) => Boolean(n) && !isOutput(n) && !isGroup(n);

// The bounding box of some nodes, in absolute coordinates, with the margin applied.
function boxAround(nodes, members) {
  const points = members.map((m) => ({ ...absolutePosition(nodes, m), ...sizeOf(m) }));
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x + p.w));
  const maxY = Math.max(...points.map((p) => p.y + p.h));
  return {
    position: { x: minX - PAD, y: minY - TOP },
    width: maxX - minX + PAD * 2,
    height: maxY - minY + TOP + PAD,
  };
}

const edgeId = (source, target) => `e-${source}-${target}`;

// Wrap `ids` in a new group. Returns null when there is nothing groupable, which is what
// the menu item and the shortcut gate on, so neither can be a click that does nothing.
//
// The edge rule: every target any member fed gets ONE edge from the box, and the members'
// own edges go. The box then sends what the members sent, drawn as one wire instead of
// several. Dropping them instead -- the rule for dragging ONE node into a group that
// already exists, which may already be wired to something else -- would silently sever
// work the user never touched, since wrapping moves nothing.
//
// It is not a pure rename of the wires: if only some members were wired, the box now
// sends the unwired ones too, because a group sends everything in it. That is visible
// the instant it happens -- badges and the request both read bucketSources -- which is
// why it is allowed to be the default rather than a prompt.
export function groupSelection(nodes, edges, ids, groupId, name = '') {
  const wanted = new Set(ids);
  const members = nodes.filter((n) => wanted.has(n.id) && groupable(n));
  if (!members.length) return null;

  const box = boxAround(nodes, members);
  const node = {
    id: groupId,
    type: 'group',
    position: box.position,
    width: box.width,
    height: box.height,
    data: { name },
  };

  const memberIds = new Set(members.map((m) => m.id));
  // Positions become relative to the box. Computed from the ABSOLUTE position, so a node
  // moving out of one group and into another lands where it looked like it was.
  const placed = members.map((m) => {
    const abs = absolutePosition(nodes, m);
    return {
      ...m,
      parentId: groupId,
      extent: 'parent',
      position: { x: abs.x - box.position.x, y: abs.y - box.position.y },
    };
  });

  // Distinct targets, in the order the edges were drawn, so the new wires are stable
  // rather than dependent on Set iteration of ids.
  const targets = [];
  for (const e of edges) {
    if (memberIds.has(e.source) && !targets.includes(e.target)) targets.push(e.target);
  }
  const kept = edges.filter((e) => !memberIds.has(e.source) && !memberIds.has(e.target));
  const fresh = targets
    .filter((t) => !kept.some((e) => e.source === groupId && e.target === t))
    .map((t) => ({ id: edgeId(groupId, t), source: groupId, target: t }));

  return { node, members: placed, edges: [...kept, ...fresh] };
}

// The inverse. Members become loose nodes at the absolute positions they appeared at,
// and the box's wires are handed to each of them, so what the graph sends is unchanged
// by ungrouping -- the one property that makes Group reversible rather than a decision.
export function ungroup(nodes, edges, groupId) {
  const group = nodes.find((n) => n.id === groupId);
  if (!isGroup(group)) return null;
  const members = nodes.filter((n) => n.parentId === groupId);

  const freed = members.map((m) => {
    const abs = absolutePosition(nodes, m);
    const { parentId, extent, ...rest } = m;
    return { ...rest, position: abs };
  });

  const targets = edges.filter((e) => e.source === groupId).map((e) => e.target);
  const kept = edges.filter((e) => e.source !== groupId && e.target !== groupId);
  const fresh = [];
  for (const m of freed) {
    for (const t of targets) {
      if (kept.some((e) => e.source === m.id && e.target === t)) continue;
      if (fresh.some((e) => e.source === m.id && e.target === t)) continue;
      fresh.push({ id: edgeId(m.id, t), source: m.id, target: t });
    }
  }
  return { members: freed, edges: [...kept, ...fresh] };
}
