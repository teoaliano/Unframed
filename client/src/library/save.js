// The other half of insert.js: turning a canvas selection into a library preset.
// Pure, so the derivation rules are asserted in resolve.test.js instead of being
// clicked through — a saved preset goes back through instantiateFragment exactly
// like a bundled one, so it has to come out the same shape.
import { stripRunMarkers } from '../graph/runMarkers.js';

// The chosen nodes plus the edges wholly inside them — half an edge is not a
// thing. `fallbackId` is the right-clicked node: right-clicking does not select in
// React Flow, so without it a menu opened on a node would act on nothing.
// Returns null when there is nothing to take, which is what callers gate on.
export function selectionFragment(nodes, edges, fallbackId) {
  let chosen = nodes.filter((n) => n.selected);
  if (!chosen.length && fallbackId != null) chosen = nodes.filter((n) => n.id === fallbackId);
  if (!chosen.length) return null;
  const ids = new Set(chosen.map((n) => n.id));
  return {
    // `selected` is stripped because it's UI state, not graph shape. The
    // in-flight run markers are stripped for a sharper reason: presets.json is
    // deliberately never migrated or rewritten (see CLAUDE.md and
    // docs/library.md), so a marker captured mid-run sits in that JSON forever
    // -- every later instantiation would arrive pre-stuck tracking a run that
    // ended long ago. WHICH fields count as markers, and how each copy path
    // must treat them, lives in graph/runMarkers.js -- one home, not five call
    // sites. This same function backs the node clipboard (App.jsx's
    // copySelection/pasteNodeClipboard), so the strip covers a mid-render
    // copy-paste too, not just a saved preset.
    nodes: chosen.map((n) => ({ ...n, selected: undefined, data: stripRunMarkers(n.data) })),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}

// The dialog asks for a name and a description; the two chips are derived. Several
// nodes is a flow, one node is a block, and what a preset makes is whatever its
// consumer node produces. Two more dropdowns would only let you contradict the
// graph you just selected.
//
// Positions are stored as they are: centerOffset measures the bounding box rather
// than assuming it starts at (0,0), so there is nothing to normalise.
const OUTPUT_KINDS = { imageOutput: 'image', videoOutput: 'video', textOutput: 'text' };

export function presetFromSelection(fragment, { name, summary }) {
  // What a preset makes is whatever its consumer node produces, which since the
  // output split is simply the consumer's type — no data.kind to sniff, and no
  // fallback chain for an output node that never said which medium it was.
  const out = fragment.nodes.find((n) => OUTPUT_KINDS[n.type]);
  const kind = out ? OUTPUT_KINDS[out.type] : 'image';
  return {
    // ponytail: a timestamp, not a uuid — one dialog, one click, so two presets
    // cannot be born in the same millisecond. `user-` keeps it clear of the
    // bundled presets' hand-written ids.
    id: `user-${Date.now().toString(36)}`,
    source: 'user',
    // Stored explicitly rather than decoded back out of the id: the Library sorts on
    // it, and "parse the base36 tail of the id" is a puzzle at 3am.
    savedAt: new Date().toISOString(),
    name: name.trim(),
    summary: summary.trim(),
    type: fragment.nodes.length > 1 ? 'flow' : 'block',
    kind,
    fragment,
  };
}
