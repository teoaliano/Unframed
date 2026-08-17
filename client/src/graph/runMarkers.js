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
//
// Verified complete for THIS list: every updateNodeData call under
// client/src/nodes/ was enumerated and none writes a fifth marker. That is
// deliberately a narrower claim than "the one place a preset can go stale."
// `data.result` / `data.results` (an image or video output's produced content
// -- data.results is the image output's array of entries, data.result is the
// video output's single object) are NOT run markers and are NOT stripped by
// selectionFragment -- and they hold machine-local `/api/file/<project>/...`
// URLs, plus a savedPath, an absolute local filesystem path that is even more
// machine-specific than the URL, so a preset saved from a node that has
// already produced output bakes in a path that only exists on the machine
// that made it. Inserted elsewhere, or even just reopened after the file
// moved, it points at nothing. (A text output's data.result is a plain answer
// string with no URL in it at all -- its staleness is a different, milder
// problem than the machine-local-path one described here.) That is the same
// class of bug this module exists to end, one severity band down (a broken
// image, not a frozen button) -- considered here and deliberately left alone,
// because stripping it needs its own decision about what a preset should
// carry (the produced output, or just the recipe that makes it) that hasn't
// been made yet.
export const RUN_MARKERS = ['job', 'running'];

// For any path that copies a node out of the live graph.
export function stripRunMarkers(data) {
  const copy = { ...data };
  for (const k of RUN_MARKERS) copy[k] = undefined;
  return copy;
}

export function keepLiveRunMarkers(restored, live) {
  const byId = new Map(live.map((n) => [n.id, n.data]));
  return restored.map((n) => {
    const liveData = byId.get(n.id);
    // Still on the canvas: the live value wins for every marker, in both
    // directions -- undoing past a Generate must not strand a render, and
    // redoing past a finish must not resurrect a dead one.
    if (liveData) {
      if (RUN_MARKERS.every((k) => liveData[k] === n.data?.[k])) return n;
      const data = { ...n.data };
      for (const k of RUN_MARKERS) data[k] = liveData[k];
      return { ...n, data };
    }
    // Absent from the live graph: undo is bringing this node back from a
    // delete, and there is no live value to prefer. The two markers part
    // company here, which is the whole reason this branch is not just "keep
    // the snapshot".
    //
    // `job` is kept: a video render is durable on the server, so the restored
    // node's resume effect picks it up and the clip still lands.
    //
    // `running` is dropped: it belongs to a single HTTP request owned by a
    // component instance that no longer exists. Its result can never arrive,
    // and the mount-only self-clear cannot save the node either -- that only
    // clears a marker from a DIFFERENT session, and this one carries the
    // session that is still open. Kept, it disables Run forever: the same bug
    // this module was written to end, reached through the delete door.
    //
    // The trade this accepts, deliberately: a request in flight when the node
    // was deleted CAN still land afterwards, since updateNodeData addresses by
    // id. So there is a brief window where Run is enabled while a request is
    // still coming. A rare double-run beats a certain permanent freeze.
    if (n.data?.running === undefined) return n;
    return { ...n, data: { ...n.data, running: undefined } };
  });
}
