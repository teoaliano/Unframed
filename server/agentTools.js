// The tools the agent gets, as an in-process MCP server the Agent SDK connects to. Four:
// canvas_read (the graph as the agent should see it), canvas_write (one batch of the
// document's own ops), page_write (a new version of a page asset), page_read (its
// current HTML). The pure half -- what the model is told, what a batch is allowed to
// carry, how a page file is named -- is exported for agentTools.test.js; the tools below
// bind it to callbacks the session supplies (agent.js). Nothing here ever includes
// bytes: media is named by file, and a legacy inline data URL is reported as "inline".
// Design: docs/superpowers/specs/2026-09-04-agent-canvas-slice-2-design.md, section 3.
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { mediaFileName } from './media.js';

const KIND = {
  prompt: 'prompt',
  image: 'image',
  video: 'video',
  imageOutput: 'image output',
  videoOutput: 'video output',
  textOutput: 'text output',
  page: 'page',
};

// Every node type the canvas can show. An agent-added node of any other type would
// render as nothing and be undeletable from the canvas, so it is refused up front.
export const NODE_TYPES = new Set(Object.keys(KIND));
// Node types whose `data.file` names a file the folder must already hold.
const FILE_TYPES = new Set(['image', 'video', 'page']);
// Pointers at live paid runs, the browser's alone (client/src/graph/runMarkers.js).
const RUN_MARKERS = ['job', 'running'];
export const MAX_BATCH_OPS = 200;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
// A placeholder id the agent may use for a node it is adding in this same batch.
const NEW_ID = /^new:/;

const fileName = (url) => decodeURIComponent(String(url || '').split('/').pop() || '');

function describeNode(n) {
  const d = n.data ?? {};
  const out = { id: n.id, kind: KIND[n.type] || n.type, position: n.position };
  if (n.width !== undefined || n.height !== undefined) {
    out.size = {};
    if (n.width !== undefined) out.size.width = n.width;
    if (n.height !== undefined) out.size.height = n.height;
  }
  switch (n.type) {
    case 'prompt':
      out.text = d.text ?? '';
      break;
    case 'image':
    case 'video':
      if (d.file) out.file = d.file;
      else if (typeof d.dataUrl === 'string' && /^https?:/.test(d.dataUrl)) out.url = d.dataUrl;
      else if (typeof d.dataUrl === 'string' && d.dataUrl.startsWith('data:')) out.inline = true;
      if (d.fileName) out.fileName = d.fileName;
      if (d.aspect) out.aspect = d.aspect;
      break;
    case 'page':
      if (d.file) out.file = d.file;
      if (d.title) out.title = d.title;
      break;
    case 'textOutput':
      out.text = d.text ?? '';
      if (d.result !== undefined) out.result = d.result;
      if (d.model) out.model = d.model;
      if (d.running) out.running = true;
      break;
    case 'imageOutput':
    case 'videoOutput': {
      if (d.model) out.model = d.model;
      const { model, results, result, running, job, ...settings } = d;
      out.settings = settings;
      if (Array.isArray(results)) out.results = results.map((r) => fileName(r.url)).filter(Boolean);
      if (result?.url) out.result = fileName(result.url);
      if (running || job) out.running = true;
      break;
    }
    default:
      break;
  }
  return out;
}

// `context` is what the composer sent with the latest message: `target` (a node id, or
// "new") and `with` (the rest of the selection). Absent when the message came from the
// panel, which sends the selection alone.
export function describeCanvas(graph, selection, context = {}) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const out = {
    nodes: graph.nodes.map(describeNode),
    edges: graph.edges.map((e) => ({ from: e.source, to: e.target })),
    selection: (Array.isArray(selection) ? selection : []).filter((id) => ids.has(id)),
  };
  if (context.target) out.target = context.target === 'new' || ids.has(context.target) ? context.target : null;
  if (Array.isArray(context.with) && context.with.length) out.with = context.with.filter((id) => ids.has(id));
  return out;
}

// One line prefixed to the model's copy of a message, so the composer's intent is in the
// transcript the agent reads and not only in a tool result it might not ask for.
export function messagePreamble({ target, with: withIds } = {}, graph) {
  if (!target) return '';
  const name = (id) => {
    const n = graph?.nodes.find((x) => x.id === id);
    if (!n) return id;
    const d = n.data ?? {};
    const label = d.title || d.fileName || (typeof d.text === 'string' && d.text ? d.text.slice(0, 40) : '');
    return `${KIND[n.type] || n.type} ${id}${label ? ` ("${label}")` : ''}`;
  };
  const to = target === 'new' ? 'a new asset' : name(target);
  const rest = Array.isArray(withIds) && withIds.length ? ` With: ${withIds.map(name).join(', ')}.` : '';
  return `To: ${to}.${rest}`;
}

const hasDataUrl = (v) => typeof v === 'string' && /^data:/i.test(v);

// Node data as the agent may write it: no bytes, no run markers.
function cleanData(data, where) {
  if (data === undefined || data === null) return { data: {} };
  if (typeof data !== 'object' || Array.isArray(data)) return { error: `${where}: data must be an object` };
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (hasDataUrl(v)) return { error: `${where}: bytes cannot travel in node data; name a file in the project folder instead` };
    if (RUN_MARKERS.includes(k)) continue;
    out[k] = v;
  }
  return { data: out };
}

// A batch as the agent proposed it, made safe for the document: known node types only,
// no bytes, no run markers, files that exist, placeholder ids rewritten to fresh server
// ids everywhere they are named. Returns { batch, idMap } or { error }. Structural
// rejections (an edge to a missing node) are the document's own and come back from
// commit; this is what the document cannot know.
export function prepareBatch(ops, { graph, files, now = Date.now, random = () => Math.random().toString(36).slice(2, 8) } = {}) {
  if (!Array.isArray(ops) || !ops.length) return { error: 'ops must be a non-empty array' };
  if (ops.length > MAX_BATCH_OPS) return { error: `at most ${MAX_BATCH_OPS} ops per call` };
  const idMap = {};
  const fresh = (placeholder) => {
    if (!idMap[placeholder]) idMap[placeholder] = `a-${now().toString(36)}-${random()}`;
    return idMap[placeholder];
  };
  const mapId = (id) => (typeof id === 'string' && NEW_ID.test(id) ? fresh(id) : id);
  const known = new Set(graph.nodes.map((n) => n.id));
  const out = [];
  for (const raw of ops) {
    if (!raw || typeof raw !== 'object') return { error: 'every op must be an object' };
    const op = { ...raw };
    switch (op.type) {
      case 'addNode': {
        const node = op.node;
        if (!node || typeof node !== 'object') return { error: 'addNode: node is required' };
        if (typeof node.id !== 'string' || !node.id) return { error: 'addNode: node.id must be a string (use "new:<name>" for a fresh id)' };
        if (!NODE_TYPES.has(node.type)) return { error: `addNode: unknown node type "${node.type}"` };
        if (!NEW_ID.test(node.id) && known.has(node.id)) return { error: `addNode: node ${node.id} already exists` };
        const c = cleanData(node.data, 'addNode');
        if (c.error) return { error: c.error };
        if (FILE_TYPES.has(node.type) && c.data.file !== undefined && !files.has(c.data.file)) {
          return { error: `addNode: no file named "${c.data.file}" in the project folder` };
        }
        if (!node.position || typeof node.position.x !== 'number' || typeof node.position.y !== 'number') {
          return { error: 'addNode: node.position needs numeric x and y' };
        }
        const { selected, dragging, measured, ...rest } = node;
        const id = mapId(node.id);
        known.add(id);
        op.node = { ...rest, id, data: c.data };
        delete op.index;
        break;
      }
      case 'updateNode': {
        const c = cleanData(op.patch, 'updateNode');
        if (c.error) return { error: c.error };
        op.id = mapId(op.id);
        const target = graph.nodes.find((n) => n.id === op.id);
        const type = target?.type ?? [...out].reverse().find((o) => o.type === 'addNode' && o.node.id === op.id)?.node.type;
        if (FILE_TYPES.has(type) && typeof c.data.file === 'string' && !files.has(c.data.file)) {
          return { error: `updateNode: no file named "${c.data.file}" in the project folder` };
        }
        op.patch = c.data;
        break;
      }
      case 'moveNode':
      case 'resizeNode':
      case 'removeNode':
        op.id = mapId(op.id);
        break;
      case 'addEdge': {
        const edge = op.edge;
        if (!edge || typeof edge !== 'object') return { error: 'addEdge: edge is required' };
        const source = mapId(edge.source);
        const target = mapId(edge.target);
        op.edge = { ...edge, id: typeof edge.id === 'string' && edge.id ? mapId(edge.id) : `e-${source}-${target}`, source, target };
        delete op.index;
        break;
      }
      case 'removeEdge':
        op.id = mapId(op.id);
        break;
      case 'batch':
        return { error: 'a call is already one batch; pass the ops flat' };
      default:
        return { error: `unknown op type "${op.type}"` };
    }
    out.push(op);
  }
  return { batch: { type: 'batch', ops: out }, idMap };
}

// A page's file name: the same `<timestamp>-<slug>.html` shape every other file in the
// folder has (media.js), so the preview origin's name rule admits it.
export const pageFileName = (now, title, n) => mediaFileName(now, `${title || 'page'}.html`, 'html', n);

export function pageSidecar({ threadId, turn, nodeId, title, bytes, now = Date.now() }) {
  return { source: 'agent', kind: 'page', threadId, turn, nodeId, title: title || '', bytes, at: new Date(now).toISOString() };
}

// Where a new page goes: to the right of the selection's bounding box, or at a fixed
// spot on an empty board. The composer's `with` ids are the selection that mattered.
export function placeBeside(graph, ids, size = { width: 480, height: 320 }) {
  const picked = graph.nodes.filter((n) => ids.includes(n.id));
  if (!picked.length) return { x: 80, y: 80 };
  const right = Math.max(...picked.map((n) => (n.position?.x ?? 0) + (n.width ?? 240)));
  const top = Math.min(...picked.map((n) => n.position?.y ?? 0));
  return { x: right + 60, y: top };
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
const failure = (message) => ({ content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true });

// `getGraph` reads the server's document (never the browser); `getSelection` and
// `getContext` are what the browser sent with the latest message of this thread;
// `commit(batch)` applies one batch under the thread's origin and resolves to the journal
// entry or { rejected }; `files` are the folder helpers, scoped to the project;
// `onWrite(entry, summary)` lets the session record an ops_applied event.
export function canvasTools({ getGraph, getSelection, getContext = () => ({}), commit, files, previewUrl, onWrite = () => {} }) {
  const fileSet = async () => new Set(await files.list());
  return [
    tool(
      'canvas_read',
      'Read the whole canvas: every node with its id, kind, position, text or file, the edges between them (what feeds what), which node ids the person currently has selected, and -- when the message came from the composer -- the target the message is about and the nodes it came with. Call this before answering anything about what is on the canvas, and before any change.',
      {},
      async () => text(describeCanvas(await getGraph(), getSelection(), getContext())),
    ),
    tool(
      'canvas_write',
      [
        'Change the canvas with one batch of operations, applied all or nothing and undoable as one step. Ops:',
        '{type:"addNode", node:{id, type, position:{x,y}, data, width?, height?}} -- use an id like "new:hero" and the result tells you the real id;',
        '{type:"updateNode", id, patch} -- a shallow patch onto node.data, null deletes a key;',
        '{type:"moveNode", id, position} ; {type:"resizeNode", id, width, height} ; {type:"removeNode", id} ;',
        '{type:"addEdge", edge:{source, target}} ; {type:"removeEdge", id}.',
        'Node types: prompt (data.text), image and video (data.file names an existing project file), imageOutput, videoOutput, textOutput (data.text is the instruction), page (data.file, data.title). Never put bytes or data: URLs in node data.',
      ].join(' '),
      { ops: z.array(z.record(z.string(), z.unknown())).describe('The operations, in order.') },
      async ({ ops }) => {
        const graph = await getGraph();
        const prepared = prepareBatch(ops, { graph, files: await fileSet() });
        if (prepared.error) return failure(prepared.error);
        const entry = await commit(prepared.batch);
        if (!entry || entry.rejected) return failure(entry?.rejected || 'the change could not be applied');
        const summary = `${prepared.batch.ops.length} change${prepared.batch.ops.length === 1 ? '' : 's'}`;
        await onWrite(entry, { summary, opCount: prepared.batch.ops.length });
        return text({ ok: true, version: entry.version, ids: prepared.idMap });
      },
    ),
    tool(
      'page_write',
      'Create a page asset or write a new version of one. `html` is the complete, self-contained HTML document: inline its style and script; reference the project\'s images and clips by the exact file names canvas_read reports (they sit beside the page, so a plain relative name works); nothing external loads. Files are never overwritten -- every write is a new version the person can undo. Omit nodeId to create a page beside the current selection; pass it to update that page.',
      {
        html: z.string().describe('The whole HTML document.'),
        nodeId: z.string().optional().describe('The page node to update. Omit to create a new page.'),
        title: z.string().max(120).optional().describe('A short name for the page, shown on the canvas.'),
      },
      async ({ html, nodeId, title }) => {
        if (typeof html !== 'string' || !html.trim()) return failure('html must be a non-empty string');
        const bytes = Buffer.from(html, 'utf8');
        if (bytes.length > MAX_PAGE_BYTES) return failure(`the page is too large (${bytes.length} bytes; the limit is ${MAX_PAGE_BYTES})`);
        const graph = await getGraph();
        const existing = nodeId ? graph.nodes.find((n) => n.id === nodeId) : null;
        if (nodeId && !existing) return failure(`no node ${nodeId}`);
        if (existing && existing.type !== 'page') return failure(`node ${nodeId} is a ${KIND[existing.type] || existing.type}, not a page`);
        const name = (title ?? existing?.data?.title ?? '').trim();
        const file = await files.writePage(bytes, { title: name, nodeId: existing?.id ?? null });
        let batch;
        let id;
        if (existing) {
          id = existing.id;
          const patch = { file };
          if (title !== undefined && name !== (existing.data?.title ?? '')) patch.title = name;
          batch = { type: 'batch', ops: [{ type: 'updateNode', id, patch }] };
        } else {
          const ctx = getContext();
          const beside = Array.isArray(ctx.with) && ctx.with.length ? ctx.with : getSelection();
          id = `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          const node = { id, type: 'page', position: placeBeside(graph, beside), width: 480, height: 320, data: { file, title: name, fileName: '' } };
          batch = { type: 'batch', ops: [{ type: 'addNode', node }] };
        }
        const entry = await commit(batch);
        if (!entry || entry.rejected) return failure(entry?.rejected || 'the change could not be applied');
        await onWrite(entry, {
          summary: `${existing ? 'Updated' : 'Created'} page${name ? ` · ${name}` : ''}`,
          opCount: 1,
          page: { nodeId: id, file, title: name, created: !existing },
        });
        return text({ ok: true, nodeId: id, file, title: name, previewUrl: previewUrl(file), version: entry.version });
      },
    ),
    tool(
      'page_read',
      'Read the current HTML of a page asset, so an edit starts from what is there.',
      { nodeId: z.string().describe('The page node.') },
      async ({ nodeId }) => {
        const graph = await getGraph();
        const node = graph.nodes.find((n) => n.id === nodeId);
        if (!node) return failure(`no node ${nodeId}`);
        if (node.type !== 'page') return failure(`node ${nodeId} is a ${KIND[node.type] || node.type}, not a page`);
        if (!node.data?.file) return failure(`page ${nodeId} has no file yet`);
        try {
          return text(await files.readPage(node.data.file));
        } catch {
          return failure(`the file ${node.data.file} could not be read`);
        }
      },
    ),
  ];
}
