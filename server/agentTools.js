// The tools the agent gets, as an in-process MCP server the Agent SDK connects to.
// This slice has one, read-only: canvas_read. The write vocabulary (one batch op per
// call) is the next spec. describeCanvas is the pure part -- what the model is told
// about the graph -- and it never includes bytes: media is named by file, and a legacy
// inline data URL is reported as "inline", not dumped.
import { tool } from '@anthropic-ai/claude-agent-sdk';

const KIND = {
  prompt: 'prompt',
  group: 'group',
  image: 'image',
  video: 'video',
  imageOutput: 'image output',
  videoOutput: 'video output',
  textOutput: 'text output',
};

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

export function describeCanvas(graph, selection) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return {
    nodes: graph.nodes.map(describeNode),
    edges: graph.edges.map((e) => ({ from: e.source, to: e.target })),
    selection: (Array.isArray(selection) ? selection : []).filter((id) => ids.has(id)),
  };
}

// `getGraph` reads the server's document (never the browser); `getSelection` is what the
// browser sent with the latest message of this thread.
export function canvasTools({ getGraph, getSelection }) {
  return [
    tool(
      'canvas_read',
      'Read the whole canvas: every node with its id, kind, position, text or file, the edges between them (what feeds what), and which node ids the person currently has selected. A node with inGroup sits inside that group node, positioned relative to it; a wired group sends every node inside it. Call this before answering anything about what is on the canvas.',
      {},
      async () => {
        const description = describeCanvas(await getGraph(), getSelection());
        return { content: [{ type: 'text', text: JSON.stringify(description) }] };
      },
      { annotations: { readOnlyHint: true } },
    ),
  ];
}
