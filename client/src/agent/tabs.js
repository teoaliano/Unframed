// The panel's tab strip: which threads show for a selection, and which one is active
// after the strip changes. Pure, pinned in tabs.test.js. Design:
// docs/superpowers/specs/2026-09-05-agent-canvas-slice-3-design.md, section 1.
//
// The selection filters the strip: no artifact selected shows every thread; one or more
// selected shows only their threads. A thread bound to a node that is not on the canvas
// is hidden in every state -- its record stays on disk, and it comes back the moment
// undo or redo brings the node back, since the binding is by node id.
import { isArtifact } from '../graph/resolve.js';

export function visibleThreads(threads, selectedIds, nodes) {
  const onCanvas = new Set(nodes.map((n) => n.id));
  const live = threads.filter((t) => t.kind !== 'artifact' || !t.artifactId || onCanvas.has(t.artifactId));
  const artifacts = nodes.filter((n) => selectedIds.includes(n.id) && isArtifact(n)).map((n) => n.id);
  if (artifacts.length === 0) return live;
  return live.filter((t) => t.kind === 'artifact' && artifacts.includes(t.artifactId));
}

// The active tab must be visible, so the composer always sends to what is highlighted:
// the previous one when it survived the re-filter, else the newest visible (the list is
// newest first), else none -- and none means the next send creates a thread.
export function nextActive(activeId, visible) {
  if (activeId && visible.some((t) => t.id === activeId)) return activeId;
  return visible[0]?.id ?? null;
}

// What a tab reads: an artifact thread is named after its node, a canvas thread is
// "Canvas". A running thread's tab carries the dot; that is the component's business.
export function tabLabel(thread, nodes) {
  if (thread.kind !== 'artifact') return 'Canvas';
  const n = nodes.find((x) => x.id === thread.artifactId);
  if (!n) return thread.artifactId || 'Artifact';
  return n.data?.title || n.data?.fileName?.replace(/\.html?$/i, '') || n.id;
}
