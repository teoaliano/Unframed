// The tab's side of the server-owned document. One hook owns everything that used to
// be autosave, the history stack and the load/switch plumbing in App.jsx:
//
//   open(name) / create(name, graph)  fetch the graph, seed React Flow, subscribe.
//   a 400ms-settled diff of the arrays becomes ops and is POSTed (graph/ops.js);
//   entries from other origins (an agent, another tab, an undo) land via SSE;
//   Cmd-Z / Shift-Cmd-Z ask the server, and the resulting entry arrives like any other.
//
// Two copies of the graph live here, on purpose. `baseline` is what the server has, as
// far as this tab knows: it advances only by server entries (the response to our own
// ops, or the stream). The React Flow arrays are the optimistic local copy. The diff
// between them is exactly this tab's unsent edits, whatever else has happened, which is
// what lets a remote entry land mid-typing without either side losing anything.
//
// Design: docs/superpowers/specs/2026-09-04-agent-canvas-slice-1-design.md, section 1.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { migrateNodes } from './migrate.js';
import { withDrag, bumpCounter } from './starter.js';
import { diffGraphs, applyEntry, persistentNode } from './ops.js';
import { keepLiveRunMarkers } from './runMarkers.js';
import {
  openProject,
  createProject,
  sendOps,
  subscribeProject,
  undoProject,
  redoProject,
  SESSION_ID,
} from '../api.js';

// The same pause the old undo stack used as its unit of work: one drag, one word.
const SETTLE_MS = 400;

// How a node deep in the tree reaches `send` below. Only composed ops need it; everything
// else on the canvas is written by editing React Flow state and letting the diff find it.
export const DocumentContext = createContext({ send: async () => {} });
export const useDoc = () => useContext(DocumentContext);

const settle = (nodes, edges) => ({ nodes: nodes.map(persistentNode), edges: edges.map(persistentNode) });

export function useDocument({ nodes, edges, setNodes, setEdges, onError }) {
  const s = useRef({
    project: null,
    version: 0,
    baseline: { nodes: [], edges: [] },
    // Mirror of the latest rendered arrays, so the stream handler can apply an entry
    // against both at once without waiting for a render.
    live: { nodes: [], edges: [] },
    ready: false,
    inflight: false,
    dirty: false,
    close: null,
  }).current;

  const isOwn = (entry) => entry.origin?.kind === 'session' && entry.origin?.id === SESSION_ID;

  // A server entry from anyone but this tab's own ops (those already advanced the
  // baseline via the send response). Applied to the baseline and, through functional
  // updaters so a just-made local change is never overwritten, to the arrays.
  const receive = useCallback(
    (project, entry) => {
      if (s.project !== project) return;
      if (entry.version <= s.version) return; // replayed after a reconnect, or already seen
      s.version = entry.version;
      if (isOwn(entry)) return;
      s.baseline = applyEntry(s.baseline, entry);
      const before = s.live;
      const next = applyEntry(before, entry);
      s.live = next;
      // Undo and redo restore old node data, and the in-flight run markers must not
      // come along for the ride -- graph/runMarkers.js owns why.
      const restoring = entry.origin?.kind === 'undo' || entry.origin?.kind === 'redo';
      setNodes((liveNodes) => {
        const r = applyEntry({ nodes: liveNodes, edges: before.edges }, entry);
        const out = restoring ? keepLiveRunMarkers(r.nodes, liveNodes) : r.nodes;
        return out.map(withDrag);
      });
      setEdges((liveEdges) => applyEntry({ nodes: next.nodes, edges: liveEdges }, entry).edges);
    },
    [s, setNodes, setEdges],
  );

  const load = useCallback(
    (name, graph) => {
      s.close?.();
      s.close = null;
      s.ready = false;
      const shown = migrateNodes(graph.nodes || []).map(withDrag);
      const shownEdges = graph.edges || [];
      s.project = name;
      s.version = graph.version || 0;
      // The baseline is the graph as SHOWN, withDrag included: the seeded defaults it
      // adds (a 240 width on an input node) are derived every load, not edits to send.
      s.baseline = settle(shown, shownEdges);
      s.live = { nodes: shown, edges: shownEdges };
      setNodes(shown);
      setEdges(shownEdges);
      bumpCounter(shown);
      s.close = subscribeProject(name, s.version, {
        onEntry: (entry) => receive(name, entry),
      });
      // The two set calls above will fire the settle effect; ready flips after they have
      // rendered so that first pass diffs to nothing. A timeout rather than rAF: rAF never
      // fires in a hidden tab, and a switch made while backgrounded used to leave saving
      // off for the rest of the session.
      setTimeout(() => {
        if (s.project === name) s.ready = true;
      }, 0);
      return { nodes: shown, edges: shownEdges };
    },
    [s, setNodes, setEdges, receive],
  );

  const open = useCallback(async (name) => load(name, await openProject(name)), [load]);
  const create = useCallback(async (name, graph) => load(name, await createProject(name, graph)), [load]);

  // Something did not apply, or the stream and the baseline disagree: the cheap, safe
  // answer is to re-read the server's copy and start over from it.
  const reopen = useCallback(async () => {
    if (!s.project) return;
    try {
      await open(s.project);
    } catch (err) {
      onError?.(err);
    }
  }, [s, open, onError]);

  // After the server accepts our ops it may have rewritten one: an addNode or patch that
  // carried a data: URL comes back naming a file instead (server/media.js). The local
  // node still holds the bytes, so the next diff would send them again, forever. Copy
  // just that rewrite onto the local node; everything else it did is already local.
  const reconcileMedia = useCallback(
    (applied) => {
      const files = new Map();
      const visit = (op) => {
        if (op.type === 'batch') return op.ops.forEach(visit);
        if (op.type === 'addNode' && op.node?.data?.file) files.set(op.node.id, op.node.data.file);
        if (op.type === 'updateNode' && op.patch?.file) files.set(op.id, op.patch.file);
      };
      applied.forEach((e) => visit(e.op));
      if (!files.size) return;
      setNodes((live) =>
        live.map((n) => {
          const file = files.get(n.id);
          if (!file || (n.data?.file === file && n.data?.dataUrl === undefined)) return n;
          return { ...n, data: { ...n.data, file, dataUrl: undefined } };
        }),
      );
    },
    [setNodes],
  );

  const flush = useCallback(async () => {
    if (!s.ready) return;
    if (s.inflight) {
      s.dirty = true;
      return;
    }
    const ops = diffGraphs(s.baseline, settle(s.live.nodes, s.live.edges));
    if (!ops.length) return;
    const project = s.project;
    s.inflight = true;
    try {
      // One settled pause is ONE undo step, which is what the 400ms means -- a unit of
      // work, the same one the old undo stack used. The route commits each op it is
      // given as its own journal entry, so a pause that produced two ops (typing into a
      // prompt writes the text AND the size it hugs to; dragging a selection moves
      // several nodes) would take two presses of Cmd-Z to take back, the second of them
      // undoing something nobody did on purpose.
      const res = await sendOps(project, ops.length > 1 ? [{ type: 'batch', ops }] : ops);
      if (s.project !== project) return;
      let base = s.baseline;
      for (const entry of res.applied) base = applyEntry(base, entry);
      s.baseline = base;
      s.version = Math.max(s.version, res.version);
      reconcileMedia(res.applied);
      if (res.rejected.length) await reopen();
    } catch (err) {
      // This is the SAVE path: the canvas keeps editing whether or not the change
      // reached disk, so the failure has to be said out loud.
      onError?.(err);
    } finally {
      s.inflight = false;
      if (s.dirty) {
        s.dirty = false;
        flush();
      }
    }
  }, [s, reconcileMedia, reopen, onError]);

  // An op this tab COMPOSES, rather than one the diff discovers. The diff works by
  // comparing two settled graphs, and there are changes it cannot see for what they are:
  // a renamed node id reads as a delete and an add, and the server's removeNode cascades
  // to a group's members -- so a rename left to the diff would take the box's contents
  // with it. Such an op goes straight to the server and is landed here from the response,
  // exactly as a remote entry is landed by receive().
  const send = useCallback(
    async (op) => {
      if (!s.project || !s.ready) return;
      // Unsent edits first, or the op is written against a graph the server has not seen
      // yet and the ops arrive in the wrong order.
      await flush();
      const project = s.project;
      try {
        const res = await sendOps(project, [op]);
        if (s.project !== project) return;
        // It did not apply -- a name taken in another tab since we looked, say. Re-read
        // rather than guess, the same answer flush() gives a rejection.
        if (res.rejected.length) return reopen();
        s.version = Math.max(s.version, res.version);
        for (const entry of res.applied) {
          s.baseline = applyEntry(s.baseline, entry);
          const before = s.live;
          s.live = applyEntry(before, entry);
          setNodes((live) => applyEntry({ nodes: live, edges: before.edges }, entry).nodes.map(withDrag));
          setEdges((live) => applyEntry({ nodes: s.live.nodes, edges: live }, entry).edges);
        }
      } catch (err) {
        onError?.(err);
      }
      return undefined;
    },
    [s, flush, reopen, setNodes, setEdges, onError],
  );


  // Mirror every render; diff after a pause.
  useEffect(() => {
    s.live = { nodes, edges };
    if (!s.ready) return undefined;
    const t = setTimeout(flush, SETTLE_MS);
    return () => clearTimeout(t);
  }, [nodes, edges, s, flush]);

  // A tab going away mid-pause must not lose its last edit.
  useEffect(() => {
    const now = () => {
      if (s.ready) flush();
    };
    window.addEventListener('pagehide', now);
    window.addEventListener('blur', now);
    return () => {
      window.removeEventListener('pagehide', now);
      window.removeEventListener('blur', now);
    };
  }, [s, flush]);

  // Undo/redo are the server's: the resulting entry comes back on the stream and lands
  // through receive() like anything else, so one timeline covers this tab, other tabs
  // and the agent. Inside a text field the browser's own undo is the right one -- it
  // steps through what you typed, and stealing it would rewind the whole canvas
  // mid-sentence.
  useEffect(() => {
    function onKeyDown(e) {
      const undo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z';
      const redoY = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y';
      if (!undo && !redoY) return;
      const el = e.target;
      const typing =
        el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing || !s.project) return;
      e.preventDefault();
      // Unsent edits go first, or the undo would revert the change before this one.
      const forward = redoY || e.shiftKey;
      flush().then(() => (forward ? redoProject(s.project) : undoProject(s.project))).catch((err) => onError?.(err));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [s, flush, onError]);

  useEffect(() => () => s.close?.(), [s]);

  // One stable object, so an effect that lists `doc` as a dependency runs once.
  return useMemo(() => ({ open, create, flush, reopen, send }), [open, create, flush, reopen, send]);
}
