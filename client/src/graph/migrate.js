// Old graphs and old presets name one `output` node that chose its medium with a
// `data.kind` tab, plus a `text` node. Both became their own node types. This is
// applied on the way IN — when a project's graph.json loads, and when a preset
// fragment is instantiated — so nothing on disk has to be rewritten to keep working.
// presets.json in particular is deliberately never rewritten: that PUT replaces the
// whole array, and a stale or failed read there erases presets still on disk.
//
// Permanent, not transitional: it is a handful of lines, and removing it later would
// silently break any graph or preset that had not been opened since.
export function migrateNodes(nodes) {
  return nodes.map((n) => {
    if (n.type === 'output') {
      // kind is consumed, not carried: after the split the type IS the medium, and a
      // leftover kind:'video' is exactly the stale field someone later mistakes for
      // load-bearing. Absent means image, which is what the node already defaulted to.
      const { kind, ...data } = n.data ?? {};
      return { ...n, type: kind === 'video' ? 'videoOutput' : 'imageOutput', data };
    }
    if (n.type === 'text') return { ...n, type: 'textOutput', data: n.data ?? {} };
    return n;
  });
}
