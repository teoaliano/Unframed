// The tools the agent gets, as an in-process MCP server the Agent SDK connects to. Six:
// canvas_read (the graph as the agent should see it), canvas_write (one batch of the
// document's own ops), page_write and motion_write (a new version of an artifact), page_read and motion_read (its
// current HTML). The pure half -- what the model is told, what a batch is allowed to
// carry, how a page file is named -- is exported for agentTools.test.js; the tools below
// bind it to callbacks the session supplies (agent.js). Nothing here ever includes
// bytes: media is named by file, and a legacy inline data URL is reported as "inline".
// Design: docs/superpowers/specs/2026-09-04-agent-canvas-slice-2-design.md, section 3.
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { mediaFileName } from './media.js';
import { withRuntime, motionFileName } from './motion.js';

const KIND = {
  prompt: 'prompt',
  group: 'group',
  image: 'image',
  video: 'video',
  imageOutput: 'image output',
  videoOutput: 'video output',
  textOutput: 'text output',
  page: 'page',
  motion: 'motion',
};

// Every node type the canvas can show. An agent-added node of any other type would
// render as nothing and be undeletable from the canvas, so it is refused up front.
export const NODE_TYPES = new Set(Object.keys(KIND));
// Node types whose `data.file` names a file the folder must already hold.
const FILE_TYPES = new Set(['image', 'video', 'page', 'motion']);
// Pointers at live paid runs, the browser's alone (client/src/graph/runMarkers.js).
const RUN_MARKERS = ['job', 'running'];
export const MAX_BATCH_OPS = 200;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
// A placeholder id the agent may use for a node it is adding in this same batch.
const NEW_ID = /^new:/;
// The two node types a chat can be tagged with, and the ones a change line can offer to
// open in the editor.
const ARTIFACT_TYPES = new Set(['page', 'motion']);

const fileName = (url) => decodeURIComponent(String(url || '').split('/').pop() || '');

function describeNode(n) {
  const d = n.data ?? {};
  const out = { id: n.id, kind: KIND[n.type] || n.type, position: n.position };
  if (n.width !== undefined || n.height !== undefined) {
    out.size = {};
    if (n.width !== undefined) out.size.width = n.width;
    if (n.height !== undefined) out.size.height = n.height;
  }
  // A member's position is relative to its group's top-left corner, not the canvas --
  // said here rather than converted, so what the model reads is what the document holds.
  if (n.parentId) out.inGroup = n.parentId;
  switch (n.type) {
    case 'prompt':
      out.text = d.text ?? '';
      break;
    case 'group':
      out.name = d.name ?? '';
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
    case 'motion':
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

// The selection is the only thing the browser sends with a message. It is CONTEXT, not
// an instruction: the agent decides what the sentence means about it (the same edit to
// all of them, one of them, a new asset from them, a question). There is deliberately no
// `target` -- a mode picker was rejected, so nothing here may re-invent one.
export function describeCanvas(graph, selection) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return {
    nodes: graph.nodes.map(describeNode),
    edges: graph.edges.map((e) => ({ from: e.source, to: e.target })),
    selection: (Array.isArray(selection) ? selection : []).filter((id) => ids.has(id)),
  };
}

const nodeName = (graph, id) => {
  const n = graph?.nodes.find((x) => x.id === id);
  if (!n) return id;
  const d = n.data ?? {};
  const label = d.title || d.fileName || (typeof d.text === 'string' && d.text ? d.text.slice(0, 40) : '');
  return `${KIND[n.type] || n.type} ${id}${label ? ` ("${label}")` : ''}`;
};

// What happened to the document since this chat's last turn ended, counted from the
// journal. `since` is the thread's `lastVersion`; entries at or below it are what the
// agent already knows about. `system` entries (media extraction, project creation) are
// bookkeeping, not somebody's edit, so they are not counted -- telling the agent the
// canvas "changed" because a data URL was rewritten would send it re-reading for nothing.
export function summarizeChanges(entries, { since = 0, threadId = null } = {}) {
  const byVersion = new Map((entries ?? []).map((e) => [e.version, e]));
  let person = 0;
  let otherChats = 0;
  let undoneFromThisChat = 0;
  for (const e of entries ?? []) {
    if (e.version <= since) continue;
    const kind = e.origin?.kind;
    if (kind === 'system') continue;
    // A thread entry is another chat's agent; an undo or redo is whoever pressed it,
    // which is the person -- the agent has no undo tool.
    if (kind === 'thread') {
      if (e.origin.id === threadId) continue;
      otherChats += 1;
    } else {
      person += 1;
    }
    if (e.undoes !== undefined) {
      const target = byVersion.get(e.undoes);
      if (target?.origin?.kind === 'thread' && target.origin.id === threadId) undoneFromThisChat += 1;
    }
  }
  return { person, otherChats, undoneFromThisChat, total: person + otherChats };
}

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// The sentence that tells the agent the board moved under it. Its job is to make the
// agent re-read: an answer built on a canvas the person has since edited is wrong in a
// way neither of them can see.
export function changeSentence({ person = 0, otherChats = 0, undoneFromThisChat = 0, total = 0 } = {}) {
  if (!total) return '';
  const parts = [];
  if (person) parts.push(`${count(person, 'change')} by the person`);
  if (otherChats) parts.push(`${count(otherChats, 'change')} by another chat`);
  const undone = undoneFromThisChat
    ? `, including ${undoneFromThisChat === 1 ? 'an undo of a change' : `${undoneFromThisChat} undos of changes`} from this chat`
    : '';
  return `Since your last turn the canvas changed: ${parts.join(', ')}${undone}. Read it again before acting.`;
}

// The preamble on the model's copy of a message: what the person had selected when they
// sent it, and whether the canvas moved since the last turn. It goes in the transcript
// the agent reads rather than only in a tool result it might never ask for.
export function contextPreamble({ selection = [], changes = null } = {}, graph) {
  const ids = new Set(graph?.nodes.map((n) => n.id) ?? []);
  const picked = (Array.isArray(selection) ? selection : []).filter((id) => ids.has(id));
  const lines = [];
  if (picked.length) lines.push(`Selected: ${picked.map((id) => nodeName(graph, id)).join(', ')}.`);
  const sentence = changes ? changeSentence(changes) : '';
  if (sentence) lines.push(sentence);
  return lines.join(' ');
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

// Which artifacts a prepared batch touched, so the panel's change line can expand to
// them ("2 changes" -> the two motions, each with Open and Locate). Read from the ops
// rather than from the graph after the fact, because a removeNode's node is gone by
// then. `addNode` is included: a batch that adds a page node is a change to that page.
export function batchArtifacts(ops, graph) {
  const added = new Map(ops.filter((o) => o.type === 'addNode').map((o) => [o.node.id, o.node.type]));
  const typeOf = (id) => added.get(id) ?? graph.nodes.find((n) => n.id === id)?.type;
  const out = [];
  for (const op of ops) {
    const id = op.type === 'addNode' ? op.node.id : op.id;
    if (typeof id !== 'string' || out.includes(id)) continue;
    if (ARTIFACT_TYPES.has(typeOf(id))) out.push(id);
  }
  return out;
}

// A page's file name: the same `<timestamp>-<slug>.html` shape every other file in the
// folder has (media.js), so the preview origin's name rule admits it.
export const pageFileName = (now, title, n) => mediaFileName(now, `${title || 'page'}.html`, 'html', n);

export function pageSidecar({ threadId, turn, nodeId, title, bytes, now = Date.now(), kind = 'page' }) {
  return { source: 'agent', kind, threadId, turn, nodeId, title: title || '', bytes, at: new Date(now).toISOString() };
}
export { motionFileName };

// Where a new page goes: to the right of the selection's bounding box, or at a fixed
// spot on an empty board.
export function placeBeside(graph, ids, size = { width: 480, height: 320 }) {
  const picked = graph.nodes.filter((n) => ids.includes(n.id));
  if (!picked.length) return { x: 80, y: 80 };
  const right = Math.max(...picked.map((n) => (n.position?.x ?? 0) + (n.width ?? 240)));
  const top = Math.min(...picked.map((n) => n.position?.y ?? 0));
  return { x: right + 60, y: top };
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
const failure = (message) => ({ content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true });


// What the two artifact kinds are, and how they differ. Everything not listed here -- a
// new file on every write, placement beside the selection, the node it becomes, the
// event the panel shows -- is shared by construction below, because the two used to be
// one hand-written tool and a second copy is exactly how they would drift apart.
const ARTIFACTS = {
  page: {
    describeWrite:
      "Create a page asset or write a new version of one. `html` is the complete, self-contained HTML document: inline its style and script; reference the project's images and clips by the exact file names canvas_read reports (they sit beside the page, so a plain relative name works); nothing external loads. Files are never overwritten -- every write is a new version the person can undo. Omit nodeId to create a page beside the current selection; pass it to update that page.",
    describeRead: 'Read the current HTML of a page asset, so an edit starts from what is there.',
    size: { width: 480, height: 320 },
    prepare: (html) => html,
    write: (files, bytes, meta) => files.writePage(bytes, meta),
    read: (files, file) => files.readPage(file),
  },
  motion: {
    describeWrite: [
      'Create a motion asset -- a HyperFrames composition, an HTML video -- or write a new version of one. `html` is a complete HTML document that follows the HyperFrames contract:',
      'the root is <div id="root" data-composition-id="main" data-start="0" data-duration="SECONDS" data-width="PX" data-height="PX"> (data-duration is the render length; size #root to those pixels with overflow hidden);',
      'every timed element inside it has an id, class="clip", data-start and data-duration in seconds (.clip is position:absolute; inset:0 -- a full-frame box you lay out inside);',
      "<video>, <audio> and <img> clips reference the project's files by the exact names canvas_read reports (they sit beside the composition); a <video> gets muted playsinline, and data-has-audio=\"true\" when its sound should be heard;",
      'animation is ONE paused GSAP timeline, registered synchronously: window.__timelines = window.__timelines || {}; window.__timelines.main = gsap.timeline({ paused: true }); give tweens explicit positions and prefer fromTo();',
      'load GSAP with <script src="gsap.js"></script> -- it sits beside the composition -- and nothing else external: no CDNs, fonts or remote images. Never call play(), pause() or set currentTime on media; no wall-clock time, no unseeded randomness, no infinite repeats.',
      'The HyperFrames runtime is added to the file for you. Files are never overwritten -- every write is a new version the person can undo. Omit nodeId to create a motion beside the current selection; pass it to update that motion. The person renders it to an MP4 from the node.',
    ].join(' '),
    describeRead: 'Read the current HTML of a motion asset (its HyperFrames composition), so an edit starts from what is there.',
    size: { width: 480, height: 300 },
    prepare: withRuntime,
    write: (files, bytes, meta) => files.writeMotion(bytes, meta),
    read: (files, file) => files.readMotion(file),
  },
};

// The write and read tools for one artifact kind. `kind` is both the node type and the
// noun in every message.
function artifactTools(kind, { getGraph, getSelection, commit, files, previewUrl, onWrite }) {
  const A = ARTIFACTS[kind];
  const notA = (node) => `node ${node.id} is a ${KIND[node.type] || node.type}, not a ${kind}`;
  return [
    tool(
      `${kind}_write`,
      A.describeWrite,
      {
        html: z.string().describe('The whole HTML document.'),
        nodeId: z.string().optional().describe(`The ${kind} node to update. Omit to create a new ${kind}.`),
        title: z.string().max(120).optional().describe(`A short name for the ${kind}, shown on the canvas.`),
      },
      async ({ html, nodeId, title }) => {
        if (typeof html !== 'string' || !html.trim()) return failure('html must be a non-empty string');
        const bytes = Buffer.from(A.prepare(html), 'utf8');
        if (bytes.length > MAX_PAGE_BYTES) return failure(`the ${kind} is too large (${bytes.length} bytes; the limit is ${MAX_PAGE_BYTES})`);
        const graph = await getGraph();
        const existing = nodeId ? graph.nodes.find((n) => n.id === nodeId) : null;
        if (nodeId && !existing) return failure(`no node ${nodeId}`);
        if (existing && existing.type !== kind) return failure(notA(existing));
        const name = (title ?? existing?.data?.title ?? '').trim();
        const file = await A.write(files, bytes, { title: name, nodeId: existing?.id ?? null });
        let batch;
        let id;
        if (existing) {
          id = existing.id;
          const patch = { file };
          if (title !== undefined && name !== (existing.data?.title ?? '')) patch.title = name;
          batch = { type: 'batch', ops: [{ type: 'updateNode', id, patch }] };
        } else {
          id = `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          const node = { id, type: kind, position: placeBeside(graph, getSelection()), ...A.size, data: { file, title: name, fileName: '' } };
          batch = { type: 'batch', ops: [{ type: 'addNode', node }] };
        }
        const entry = await commit(batch);
        if (!entry || entry.rejected) return failure(entry?.rejected || 'the change could not be applied');
        // `page` is the event's name for "the artifact this wrote", whichever kind: the
        // panel and the anchored reply read it to bind a thread and point at the node.
        await onWrite(entry, {
          summary: `${existing ? 'Updated' : 'Created'} ${kind}${name ? ` · ${name}` : ''}`,
          opCount: 1,
          page: { nodeId: id, file, title: name, kind, created: !existing },
        });
        return text({ ok: true, nodeId: id, file, title: name, previewUrl: previewUrl(file, kind), version: entry.version });
      },
    ),
    tool(
      `${kind}_read`,
      A.describeRead,
      { nodeId: z.string().describe(`The ${kind} node.`) },
      async ({ nodeId }) => {
        const graph = await getGraph();
        const node = graph.nodes.find((n) => n.id === nodeId);
        if (!node) return failure(`no node ${nodeId}`);
        if (node.type !== kind) return failure(notA(node));
        if (!node.data?.file) return failure(`${kind} ${nodeId} has no file yet`);
        try {
          return text(await A.read(files, node.data.file));
        } catch {
          return failure(`the file ${node.data.file} could not be read`);
        }
      },
    ),
  ];
}

// `getGraph` reads the server's document (never the browser); `getSelection` is what the
// browser sent with the latest message of this thread;
// `commit(batch)` applies one batch under the thread's origin and resolves to the journal
// entry or { rejected }; `files` are the folder helpers, scoped to the project;
// `onWrite(entry, summary)` lets the session record an ops_applied event.
export function canvasTools({ getGraph, getSelection, commit, files, previewUrl, onWrite = () => {} }) {
  const fileSet = async () => new Set(await files.list());
  return [
    tool(
      'canvas_read',
      'Read the whole canvas: every node with its id, kind, position, text or file, the edges between them (what feeds what), and which node ids the person currently has selected. A node with inGroup sits inside that group node, positioned relative to it; a wired group sends every node inside it. Call this before answering anything about what is on the canvas, and before any change.',
      {},
      async () => text(describeCanvas(await getGraph(), getSelection())),
    ),
    tool(
      'canvas_write',
      [
        'Change the canvas with one batch of operations, applied all or nothing and undoable as one step. Ops:',
        '{type:"addNode", node:{id, type, position:{x,y}, data, width?, height?}} -- use an id like "new:hero" and the result tells you the real id;',
        '{type:"updateNode", id, patch} -- a shallow patch onto node.data, null deletes a key;',
        '{type:"moveNode", id, position} ; {type:"resizeNode", id, width, height} ; {type:"removeNode", id} ;',
        '{type:"addEdge", edge:{source, target}} ; {type:"removeEdge", id}.',
        'Node types: prompt (data.text), image and video (data.file names an existing project file), imageOutput, videoOutput, textOutput (data.text is the instruction), page and motion (data.file, data.title; make these with page_write and motion_write, not here). Never put bytes or data: URLs in node data.',
      ].join(' '),
      // looseObject, not z.record: the SDK converts these to JSON Schema for the CLI, and a
      // record made that conversion throw -- which registered NO tools at all, silently,
      // and the model went looking elsewhere (2026-09-05). agentTools.test.js lists the
      // tools through a real MCP client so this cannot regress unseen.
      { ops: z.array(z.looseObject({ type: z.string() })).describe('The operations, in order.') },
      async ({ ops }) => {
        const graph = await getGraph();
        const prepared = prepareBatch(ops, { graph, files: await fileSet() });
        if (prepared.error) return failure(prepared.error);
        const entry = await commit(prepared.batch);
        if (!entry || entry.rejected) return failure(entry?.rejected || 'the change could not be applied');
        const summary = `${prepared.batch.ops.length} change${prepared.batch.ops.length === 1 ? '' : 's'}`;
        const artifacts = batchArtifacts(prepared.batch.ops, graph);
        await onWrite(entry, { summary, opCount: prepared.batch.ops.length, ...(artifacts.length ? { artifacts } : {}) });
        return text({ ok: true, version: entry.version, ids: prepared.idMap });
      },
    ),
    ...artifactTools('page', { getGraph, getSelection, commit, files, previewUrl, onWrite }),
    ...artifactTools('motion', { getGraph, getSelection, commit, files, previewUrl, onWrite }),
  ];
}
