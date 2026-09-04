// Wiring several nodes at once: the fan-out behind a drag off a handle while a
// group is selected, and the Connect/Disconnect items in the right-click menu.
//
// Pure on purpose, and returning plain {source, target} pairs rather than edges:
// edge ids are React Flow's format to own, so App.jsx folds these through its
// addEdge. That leaves this file with no dependency heavier than resolve.js, so
// `node bulkWire.test.js` runs it with no DOM and no bundler.
import { isOutput, isTextOutput } from './resolve.js';

// Which end of an edge a node can BE, derived from the same two predicates the
// resolver uses rather than a list of type strings -- the list is the thing that
// gets forgotten when a fourth output type arrives. Handles mirror this exactly:
// inputs render a source, image/video outputs a target, and a text output both,
// since its answer feeds the next node by edge. A node inside a group is the one
// input that is NOT a source: the group holds the handle and wires for everything
// in it, so a member with its own handle would be two ways to send one image.
export const canSource = (n) => (!isOutput(n) || isTextOutput(n)) && !n?.parentId;
export const canTarget = (n) => isOutput(n);

export const selectedIds = (nodes, can) =>
  nodes.filter((n) => n.selected && can(n)).map((n) => n.id);

// The new connections implied by wiring every id in `sources` to every id in
// `targets`, skipping the ones that would be nonsense or a duplicate. Callers
// pass ids, not nodes, because two of the three call sites have a bare id for
// one side (the node the drag landed on) and a filtered selection for the other.
export function connections({ edges = [], sources = [], targets = [] }) {
  const drawn = new Set(edges.map((e) => `${e.source}>${e.target}`));
  const fresh = [];
  for (const source of sources) {
    for (const target of targets) {
      // A text output has both handles, so without this it would wire into
      // itself and silently amplify its own prompt on every run -- the same
      // guard onConnect has carried since it was written.
      if (source === target) continue;
      if (drawn.has(`${source}>${target}`)) continue;
      // ...and two selected text outputs would take A->B and B->A from ONE
      // click, a cycle resolve.js throws on only later, at generate time. The
      // reverse is checked against everything already drawn, not just this
      // batch: an edge added a minute ago closes the loop just as well.
      if (drawn.has(`${target}>${source}`)) continue;
      drawn.add(`${source}>${target}`);
      fresh.push({ source, target });
    }
  }
  return fresh;
}

// Edges with BOTH ends inside the selection, dropped. Deliberately not "every
// edge touching a selected node": unwiring a cluster must not also sever it from
// the graph around it, which is the one thing that cannot be eyeballed before
// clicking and is tedious to redraw.
export function dropInternal(edges, ids) {
  const inside = new Set(ids);
  return edges.filter((e) => !(inside.has(e.source) && inside.has(e.target)));
}
