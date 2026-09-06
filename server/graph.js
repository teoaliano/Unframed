// The document: the server's copy of a project's graph, and the operations that change
// it. Pure in this half -- applyOp takes a graph and an op and returns a new graph plus
// the inverse op, or a rejection -- so the whole vocabulary is testable under bare node
// (graph.test.js). The journal, snapshot and per-project serialisation are the second
// half, further down. Routes live in index.js; the browser's mirror of this vocabulary is
// client/src/graph/ops.js.
//
// Why ops and not snapshots: the browser used to PUT the whole graph after every change,
// which meant an agent's write landing between two autosaves was silently overwritten by
// the next one, and a nudge of one node rewrote every byte of the file. An op names
// exactly what changed, so two writers can interleave safely and a drag costs a few
// hundred bytes. Design: docs/superpowers/specs/2026-09-04-agent-canvas-slice-1-design.md.
//
// Ops: { type: 'addNode', node } | { type: 'updateNode', id, patch } |
//      { type: 'moveNode', id, position } | { type: 'resizeNode', id, width, height } |
//      { type: 'reparentNode', id, parentId, position } | { type: 'renameNode', id, to } |
//      { type: 'removeNode', id } |
//      { type: 'addEdge', edge } | { type: 'removeEdge', id } | { type: 'batch', ops }
//
// Every op has an inverse that restores the exact prior graph, and the test pins that
// for each one. That is what makes undo a journal walk instead of a stack of snapshots.

export const emptyGraph = () => ({ nodes: [], edges: [] });

// React Flow marks nodes with per-session state -- selected, being dragged, the DOM's
// measured size -- that is true for one tab for one moment. None of it belongs in the
// document; an addNode arriving with them set is a tab describing itself, not the node.
const TRANSIENT = ['selected', 'dragging', 'measured'];
function persistent(node) {
  const clean = { ...node };
  for (const k of TRANSIENT) delete clean[k];
  return clean;
}

const reject = (reason) => ({ rejected: reason });
const findNode = (graph, id) => graph.nodes.find((n) => n.id === id);

// A group is a container: its members carry `parentId` and a position RELATIVE to it,
// which React Flow resolves -- the document stores what it is given and never adds the
// two. Three rules keep that cheap. Only inputs can be members, so wiring stays
// "sources -> output" with the group standing in for what it holds (resolve.js expands
// it). A group cannot be a member, so there is exactly one level to resolve. And a
// parent precedes its members in the array, because React Flow resolves a child against
// the parents it has already seen and renders an orphan at its relative position
// otherwise -- so the ops maintain that order rather than trusting callers to.
// Design: docs/superpowers/specs/2026-09-05-group-node-design.md.
export const isGroup = (n) => n?.type === 'group';
const isOutput = (n) => Boolean(n?.type?.endsWith('Output'));
const canBeMember = (n) => Boolean(n) && !isOutput(n) && !isGroup(n);

// null when the node may take `parentId`, else the reason it may not.
function parentProblem(graph, node, parentId) {
  if (parentId === undefined || parentId === null) return null;
  const parent = findNode(graph, parentId);
  if (!parent) return `no group ${parentId}`;
  if (!isGroup(parent)) return `${parentId} is not a group`;
  if (!canBeMember(node)) return `a ${node?.type} cannot be a member of a group`;
  return null;
}

// Array order is z-order on the canvas and the order edges are drawn, so an inverse that
// re-appended a removed node would put it back on top of everything. `index` is where it
// goes; absent means append, which is every ordinary add.
const insertAt = (list, item, index) => {
  if (index === undefined || index === null || index >= list.length) return [...list, item];
  return [...list.slice(0, index), item, ...list.slice(index)];
};

function addNode(graph, { node, index }) {
  if (!node || typeof node.id !== 'string') return reject('addNode: node needs a string id');
  if (findNode(graph, node.id)) return reject(`addNode: node ${node.id} already exists`);
  const problem = parentProblem(graph, node, node.parentId);
  if (problem) return reject(`addNode: ${problem}`);
  // Wherever the caller wanted it, but never ahead of its own group.
  const parentAt = node.parentId ? graph.nodes.findIndex((n) => n.id === node.parentId) : -1;
  const at = index !== undefined && index !== null && index <= parentAt ? parentAt + 1 : index;
  return {
    graph: { ...graph, nodes: insertAt(graph.nodes, persistent(node), at) },
    inverse: { type: 'removeNode', id: node.id },
  };
}

// A shallow patch onto node.data. `null` deletes a key, so the browser has a way to
// unset something without the server having to know which keys are optional. The
// inverse holds the prior value of every touched key -- and null for a key that did not
// exist -- so it is exactly as wide as the change, never the whole data object.
function updateNode(graph, { id, patch }) {
  const node = findNode(graph, id);
  if (!node) return reject(`updateNode: no node ${id}`);
  const before = node.data ?? {};
  const after = { ...before };
  const inversePatch = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    inversePatch[k] = k in before ? before[k] : null;
    if (v === null) delete after[k];
    else after[k] = v;
  }
  return {
    graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, data: after } : n)) },
    inverse: { type: 'updateNode', id, patch: inversePatch },
  };
}

function moveNode(graph, { id, position }) {
  const node = findNode(graph, id);
  if (!node) return reject(`moveNode: no node ${id}`);
  return {
    graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position } : n)) },
    inverse: { type: 'moveNode', id, position: node.position },
  };
}

// width/height live on the node itself (React Flow's user-set size), not in data. null
// clears a dimension -- the inverse of sizing a node that had no size must not invent
// one, because for media an undefined height is what lets the aspect ratio compute it
// (nodes/MediaResize.jsx).
function resizeNode(graph, { id, width, height }) {
  const node = findNode(graph, id);
  if (!node) return reject(`resizeNode: no node ${id}`);
  const sized = { ...node };
  if (width === null || width === undefined) delete sized.width;
  else sized.width = width;
  if (height === null || height === undefined) delete sized.height;
  else sized.height = height;
  return {
    graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? sized : n)) },
    inverse: { type: 'resizeNode', id, width: node.width ?? null, height: node.height ?? null },
  };
}

// Into a group, out of one (parentId null), or between two. Position travels with it
// because its meaning changes -- relative to the new parent, absolute when there is none
// -- and a node that changed frame without changing coordinates would jump on screen.
// Its edges go: a member has no handle (bulkWire.js canSource), the group wires for it,
// and re-pointing them to the group would be the one thing on the canvas that happened
// without being drawn. The node may move in the array to land after its group; `index`
// says where, so the inverse can put it back exactly, and is otherwise for the inverse
// alone to write.
function reparentNode(graph, { id, parentId, position, index }) {
  const from = graph.nodes.findIndex((n) => n.id === id);
  if (from === -1) return reject(`reparentNode: no node ${id}`);
  const node = graph.nodes[from];
  const parent = parentId ?? null;
  if (parent === id) return reject('reparentNode: a node cannot contain itself');
  const problem = parentProblem(graph, node, parent);
  if (problem) return reject(`reparentNode: ${problem}`);
  if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
    return reject('reparentNode: position is required');
  }

  const moved = { ...node, position };
  if (parent === null) delete moved.parentId;
  else moved.parentId = parent;

  const without = graph.nodes.filter((n) => n.id !== id);
  const parentAt = parent === null ? -1 : without.findIndex((n) => n.id === parent);
  let at = index !== undefined && index !== null ? index : from;
  if (at <= parentAt) at = parentAt + 1;

  const gone = graph.edges
    .map((edge, i) => ({ edge, index: i }))
    .filter(({ edge }) => parent !== null && (edge.source === id || edge.target === id));
  const edges = gone.length ? graph.edges.filter((e) => e.source !== id && e.target !== id) : graph.edges;

  const back = { type: 'reparentNode', id, parentId: node.parentId ?? null, position: node.position, index: from };
  return {
    graph: { ...graph, nodes: insertAt(without, moved, at), edges },
    inverse: gone.length
      ? { type: 'batch', ops: [back, ...gone.map(({ edge, index: i }) => ({ type: 'addEdge', edge, index: i }))] }
      : back,
  };
}

// A node id is not private plumbing: it is the token a prompt writes to reference the
// node (@id), which is what lets a GROUP be renamed at all -- its name IS its id, so
// renaming it is renaming the thing every reference points at. One op rewrites every
// STRUCTURAL mention: the node itself, the parentId of its members, and both ends of
// every edge. Two things it deliberately does not touch:
//
//   The @tokens sitting in prompt TEXT. What a reference looks like is resolve.js's
//   business, not the document's, so the caller composes those updateNodes into the same
//   batch and the whole rename stays one undo step (nodes/GroupNode.jsx).
//
//   Edge IDS, which embed the endpoints they were minted from ("xy-edge__104-out").
//   Rewriting them would be cosmetic -- nothing reads an edge id but the edge -- and it
//   could collide with an id already in the graph, which is a real failure traded for an
//   imaginary one.
//
// The name is held to the same character set a reference can address, so a rename can
// never produce a node no prompt is able to mention.
const RENAMEABLE = /^[\w-]+$/;
function renameNode(graph, { id, to }) {
  if (!findNode(graph, id)) return reject(`renameNode: no node ${id}`);
  if (typeof to !== 'string' || !RENAMEABLE.test(to)) {
    return reject('renameNode: a name may only hold letters, digits, - and _');
  }
  if (to === id) return reject('renameNode: the name is unchanged');
  if (findNode(graph, to)) return reject(`renameNode: ${to} is taken`);
  return {
    graph: {
      ...graph,
      nodes: graph.nodes.map((n) => {
        if (n.id === id) return { ...n, id: to };
        if (n.parentId === id) return { ...n, parentId: to };
        return n;
      }),
      edges: graph.edges.map((e) =>
        e.source === id || e.target === id
          ? { ...e, source: e.source === id ? to : e.source, target: e.target === id ? to : e.target }
          : e,
      ),
    },
    inverse: { type: 'renameNode', id: to, to: id },
  };
}

// Removing a node removes every edge touching it, and the inverse is a batch that puts
// the node back first and then each edge -- in that order, because addEdge refuses an
// edge to a node that is not there yet. Removing a GROUP removes its members with it:
// a member's position means nothing without the box it is relative to, and a delete
// that left the contents behind at their relative coordinates would scatter them over
// the top-left of the canvas. One undo step brings the whole box back, which is what
// makes cascade the safe default rather than the destructive one. Nodes go back in
// ascending index order -- a group always precedes its members, so each member finds
// its parent already restored.
function removeNode(graph, { id }) {
  const index = graph.nodes.findIndex((n) => n.id === id);
  if (index === -1) return reject(`removeNode: no node ${id}`);
  const node = graph.nodes[index];
  const ids = new Set([id]);
  if (isGroup(node)) for (const n of graph.nodes) if (n.parentId === id) ids.add(n.id);
  const nodesGone = graph.nodes.map((n, i) => ({ node: n, index: i })).filter(({ node: n }) => ids.has(n.id));
  const gone = graph.edges
    .map((edge, i) => ({ edge, index: i }))
    .filter(({ edge }) => ids.has(edge.source) || ids.has(edge.target));
  return {
    graph: {
      ...graph,
      nodes: graph.nodes.filter((n) => !ids.has(n.id)),
      edges: graph.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
    },
    // Edges go back in ascending index order so each lands where it was relative to the
    // ones already restored -- inserting them out of order would shift the later ones.
    inverse: {
      type: 'batch',
      ops: [
        ...nodesGone.map(({ node: n, index: i }) => ({ type: 'addNode', node: n, index: i })),
        ...gone.map(({ edge, index: i }) => ({ type: 'addEdge', edge, index: i })),
      ],
    },
  };
}

function addEdge(graph, { edge, index }) {
  if (!edge || typeof edge.id !== 'string') return reject('addEdge: edge needs a string id');
  if (graph.edges.some((e) => e.id === edge.id)) return reject(`addEdge: edge ${edge.id} already exists`);
  for (const end of [edge.source, edge.target]) {
    if (!findNode(graph, end)) return reject(`addEdge: no node ${end}`);
  }
  return {
    graph: { ...graph, edges: insertAt(graph.edges, persistent(edge), index) },
    inverse: { type: 'removeEdge', id: edge.id },
  };
}

function removeEdge(graph, { id }) {
  const index = graph.edges.findIndex((e) => e.id === id);
  if (index === -1) return reject(`removeEdge: no edge ${id}`);
  return {
    graph: { ...graph, edges: graph.edges.filter((e) => e.id !== id) },
    inverse: { type: 'addEdge', edge: graph.edges[index], index },
  };
}

// All or nothing: the ops run against a working copy, and one rejection throws the whole
// copy away. The caller never sees a graph with half a batch applied, which is what lets
// an agent tool call be one batch and one undo step.
function batch(graph, { ops }) {
  if (!Array.isArray(ops)) return reject('batch: ops must be an array');
  let working = graph;
  const inverses = [];
  for (const op of ops) {
    const r = applyOp(working, op);
    if (r.rejected) return reject(r.rejected);
    working = r.graph;
    inverses.push(r.inverse);
  }
  return { graph: working, inverse: { type: 'batch', ops: inverses.reverse() } };
}

const HANDLERS = { addNode, updateNode, moveNode, resizeNode, reparentNode, renameNode, removeNode, addEdge, removeEdge, batch };

export function applyOp(graph, op) {
  const handler = op && HANDLERS[op.type];
  if (!handler) return reject(`unknown op ${op?.type}`);
  return handler(graph, op);
}
