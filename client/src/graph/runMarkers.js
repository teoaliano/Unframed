// The in-flight run markers that live inside node data: `job` (a video render
// the node is tracking -- see VideoOutputNode) and `running` (an image or text
// request in flight -- see ImageOutputNode/TextOutputNode). They are state
// owned by a LIVE run, not by graph editing, so every mechanism that copies
// nodes has to treat them specially:
//
//   - autosave PERSISTS them: a reload must be able to resume the run. That is
//     the default, so no code here does it.
//   - copy paths STRIP them (presets, the node clipboard): a copy of a node is
//     not a copy of its network traffic -- and presets.json is never rewritten
//     (docs/library.md), so a marker that leaks into one is permanent.
//   - undo/redo PREFERS THE LIVE VALUE: a snapshot from before a run started
//     must not strand it (spinner forever, no escape button), and one from
//     while it ran must not resurrect it after it finished (button frozen until
//     reload -- the session-stamp self-clear only runs on mount, and undo does
//     not remount).
//
// One home so the next marker, or the next mechanism that copies nodes, changes
// one file. Receipts: job-in-preset, job-lost-to-undo and running-in-preset
// were three separate bugs fixed at three separate call sites in two days
// before this module existed.
export const RUN_MARKERS = ['job', 'running'];

// For any path that copies a node out of the live graph.
export function stripRunMarkers(data) {
  const copy = { ...data };
  for (const k of RUN_MARKERS) copy[k] = undefined;
  return copy;
}

// For undo/redo. Restored nodes take the live graph's marker values; a node
// absent from the live graph (undo bringing it back from a delete) keeps what
// its snapshot held -- there is no live run to prefer. Untouched nodes are
// returned as the same object, so an undo does not churn React Flow's
// referential equality for the whole canvas.
export function keepLiveRunMarkers(restored, live) {
  const byId = new Map(live.map((n) => [n.id, n.data]));
  return restored.map((n) => {
    const liveData = byId.get(n.id);
    if (!liveData) return n;
    if (RUN_MARKERS.every((k) => liveData[k] === n.data?.[k])) return n;
    const data = { ...n.data };
    for (const k of RUN_MARKERS) data[k] = liveData[k];
    return { ...n, data };
  });
}
