// The browser's half of the document protocol. The server owns the graph
// (server/document.js); this tab holds a live replica in React Flow state, and:
//
//   diffGraphs(before, after)  says what changed since the last settled state as ops,
//   applyEntry(graph, entry)   lands a server journal entry on the React Flow arrays.
//
// Diffing settled states rather than translating React Flow's change events is
// deliberate: nodes are mutated through half a dozen paths (onNodesChange, setNodes,
// updateNodeData, undo restores, preset instantiation), and only some of them emit
// change events. A diff of the arrays catches all of them the same way, and it runs
// on the same 400ms "unit of work" pause the undo stack always used, so a drag or a
// sentence is one op, not one per pixel or keystroke. The hook that owns the timing
// is graph/useDocument.js.
//
// applyOp comes from the server's own module: the op vocabulary has exactly one
// definition, and a client that disagreed with the server about what `removeNode` does
// would drift silently. Vite bundles it like any other ESM file.
import { applyOp } from '../../../server/graph.js';

// React Flow's per-tab, per-moment state. Never persisted, never diffed.
const TRANSIENT = ['selected', 'dragging', 'measured', 'resizing'];

export function persistentNode(node) {
  const clean = { ...node };
  for (const k of TRANSIENT) delete clean[k];
  return clean;
}

const persistentEdge = persistentNode;

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.hasOwn(b, k) || !deepEqual(a[k], b[k])) return false;
  return true;
}

// Ops come out in the order the server needs: removals first (so an edge to a removed
// node is never sent -- the server drops those edges itself, and a removeEdge for one
// would bounce as "no edge"), then node adds, then node changes, then edge adds.
export function diffGraphs(before, after) {
  const ops = [];
  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));
  const removedNodes = new Set();

  for (const [id, prev] of beforeNodes) {
    const next = afterNodes.get(id);
    if (!next || next.type !== prev.type) removedNodes.add(id);
  }
  // The server's removeNode takes a group's members with it, so a member whose group is
  // going is not sent: in a batch it would bounce as "no node" and take the whole batch
  // down with it.
  for (const id of removedNodes) {
    const prev = beforeNodes.get(id);
    if (prev.parentId && removedNodes.has(prev.parentId)) continue;
    ops.push({ type: 'removeNode', id });
  }
  for (const [id, next] of afterNodes) {
    const prev = beforeNodes.get(id);
    if (!prev || removedNodes.has(id)) ops.push({ type: 'addNode', node: persistentNode(next) });
  }
  for (const [id, next] of afterNodes) {
    const prev = beforeNodes.get(id);
    if (!prev || removedNodes.has(id)) continue;
    // A parent change carries the position with it (relative to the new frame), so it
    // stands in for the move rather than travelling beside one.
    if ((prev.parentId ?? null) !== (next.parentId ?? null)) {
      ops.push({ type: 'reparentNode', id, parentId: next.parentId ?? null, position: next.position });
    } else if (!deepEqual(prev.position, next.position)) {
      ops.push({ type: 'moveNode', id, position: next.position });
    }
    if (prev.width !== next.width || prev.height !== next.height) {
      ops.push({ type: 'resizeNode', id, width: next.width ?? null, height: next.height ?? null });
    }
    const patch = dataPatch(prev.data ?? {}, next.data ?? {});
    if (patch) ops.push({ type: 'updateNode', id, patch });
  }

  const beforeEdges = new Map(before.edges.map((e) => [e.id, e]));
  const afterEdges = new Map(after.edges.map((e) => [e.id, e]));
  for (const [id, prev] of beforeEdges) {
    if (afterEdges.has(id)) continue;
    // Gone because its node went: the server already removed it.
    if (removedNodes.has(prev.source) || removedNodes.has(prev.target)) continue;
    ops.push({ type: 'removeEdge', id });
  }
  for (const [id, next] of afterEdges) {
    if (!beforeEdges.has(id)) ops.push({ type: 'addEdge', edge: persistentEdge(next) });
  }
  return ops;
}

// Shallow patch: changed and added keys carry the new value, removed keys carry null
// (the server's updateNode deletes on null). null when nothing differs. A key holding
// `undefined` counts as absent on both sides -- stripRunMarkers and withDrag write
// undefined to mean "not set", and JSON would drop it anyway.
const present = (obj, k) => Object.hasOwn(obj, k) && obj[k] !== undefined;
function dataPatch(prev, next) {
  const patch = {};
  let changed = false;
  for (const k of Object.keys(next)) {
    if (!present(next, k)) continue;
    if (!present(prev, k) || !deepEqual(prev[k], next[k])) {
      patch[k] = next[k];
      changed = true;
    }
  }
  for (const k of Object.keys(prev)) {
    if (present(prev, k) && !present(next, k)) {
      patch[k] = null;
      changed = true;
    }
  }
  return changed ? patch : null;
}

// Applies one server entry to the tab's arrays. Local-only flags on a node this tab has
// selected survive: the server's copy never had them, so a naive replace would drop the
// selection every time anyone else touched that node. Nodes the entry does not touch keep
// their identity so React Flow skips rerendering them. An entry that no longer applies
// (already applied, or stale after a reconnect) is a no-op, not an error.
export function applyEntry(graph, entry) {
  const r = applyOp({ nodes: graph.nodes, edges: graph.edges }, entry.op);
  if (r.rejected) return graph;
  const localNodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = r.graph.nodes.map((n) => {
    const local = localNodes.get(n.id);
    if (!local) return n;
    if (local === n) return local;
    const merged = { ...n };
    for (const k of TRANSIENT) if (k in local) merged[k] = local[k];
    return merged;
  });
  const localEdges = new Map(graph.edges.map((e) => [e.id, e]));
  const edges = r.graph.edges.map((e) => {
    const local = localEdges.get(e.id);
    if (!local || local === e) return local ?? e;
    const merged = { ...e };
    for (const k of TRANSIENT) if (k in local) merged[k] = local[k];
    return merged;
  });
  return { nodes, edges };
}
