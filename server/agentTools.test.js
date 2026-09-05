// node server/agentTools.test.js  (also runs as part of `npm test`)
//
// What the agent sees when it reads the canvas -- a compact, honest description of the
// graph and the selection, never bytes -- and what it is allowed to write: a batch of
// the document's own ops with no bytes, no run markers, known types, files that exist,
// and placeholder ids rewritten; a page as a new file that is never overwritten.
import assert from 'node:assert/strict';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  describeCanvas,
  canvasTools,
  prepareBatch,
  messagePreamble,
  pageFileName,
  pageSidecar,
  placeBeside,
  MAX_BATCH_OPS,
  MAX_PAGE_BYTES,
} from './agentTools.js';

const graph = {
  nodes: [
    { id: '100', type: 'prompt', position: { x: 40, y: 60 }, data: { text: 'A @101 on a cliff' }, width: 240, height: 160 },
    { id: '101', type: 'prompt', position: { x: 40, y: 320 }, data: { text: 'lone red fox' } },
    { id: '102', type: 'imageOutput', position: { x: 460, y: 120 }, data: { model: 'openai/gpt-image-2', quality: 'low', aspect_ratio: '1:1', runs: 1, results: [{ url: '/api/file/p/1-a.png', runIndex: 0 }] } },
    { id: '103', type: 'image', position: { x: 0, y: 0 }, data: { file: '2-hero.png', fileName: 'hero.png', aspect: 1.5 }, width: 300 },
    { id: '104', type: 'video', position: { x: 0, y: 200 }, data: { dataUrl: 'https://cdn.example/clip.mp4', fileName: 'clip.mp4' } },
    { id: '105', type: 'video', position: { x: 0, y: 400 }, data: { dataUrl: 'data:video/mp4;base64,AAAA', fileName: 'old.mp4' } },
    { id: '106', type: 'textOutput', position: { x: 500, y: 400 }, data: { text: 'Summarise', result: 'A fox.', model: 'anthropic/claude-sonnet-5', running: { startedAt: 1 } } },
    { id: '107', type: 'page', position: { x: 900, y: 0 }, data: { file: '3-launch.html', title: 'Launch page', fileName: '' }, width: 480, height: 320 },
    { id: '108', type: 'group', position: { x: 600, y: 0 }, data: { name: 'hero' }, width: 420, height: 280 },
    { id: '109', type: 'image', parentId: '108', position: { x: 10, y: 10 }, data: { file: '4-face.png' } },
  ],
  edges: [
    { id: 'e1', source: '100', target: '102' },
    { id: 'e2', source: '103', target: '102' },
  ],
};

// ---- describeCanvas ----

const d = describeCanvas(graph, ['101', '103']);
assert.deepEqual(Object.keys(d).sort(), ['edges', 'nodes', 'selection']);
assert.equal(d.nodes.length, 10);
const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
assert.deepEqual(byId['100'], { id: '100', kind: 'prompt', position: { x: 40, y: 60 }, size: { width: 240, height: 160 }, text: 'A @101 on a cliff' });
assert.equal(byId['102'].kind, 'image output');
assert.deepEqual(byId['102'].settings, { quality: 'low', aspect_ratio: '1:1', runs: 1 });
assert.deepEqual(byId['102'].results, ['1-a.png']);
assert.deepEqual(byId['103'], { id: '103', kind: 'image', position: { x: 0, y: 0 }, size: { width: 300 }, file: '2-hero.png', fileName: 'hero.png', aspect: 1.5 });
assert.equal(byId['104'].url, 'https://cdn.example/clip.mp4');
assert.equal(byId['105'].inline, true);
assert.equal(JSON.stringify(d).includes('base64'), false, 'no bytes reach the model');
assert.equal(byId['106'].kind, 'text output');
assert.equal(byId['106'].running, true);
// A page: its file and its title.
assert.deepEqual(byId['107'], { id: '107', kind: 'page', position: { x: 900, y: 0 }, size: { width: 480, height: 320 }, file: '3-launch.html', title: 'Launch page' });
// A group is named; a member says which group it is in, and its position is left
// relative to that group rather than converted -- what the model reads is what the
// document holds, and converting it would make every position the agent reads back
// disagree with every position it must write.
assert.deepEqual(byId['108'], { id: '108', kind: 'group', position: { x: 600, y: 0 }, size: { width: 420, height: 280 }, name: 'hero' });
assert.equal(byId['109'].inGroup, '108');
assert.deepEqual(byId['109'].position, { x: 10, y: 10 });
assert.equal(byId['103'].inGroup, undefined, 'a free node has no inGroup key at all');
assert.deepEqual(d.edges, [{ from: '100', to: '102' }, { from: '103', to: '102' }]);
assert.deepEqual(d.selection, ['101', '103']);
assert.deepEqual(describeCanvas(graph, ['101', 'ghost']).selection, ['101']);
assert.deepEqual(describeCanvas({ nodes: [], edges: [] }, []), { nodes: [], edges: [], selection: [] });
// The composer's context rides along: a target that exists, "new", or nothing.
assert.equal(describeCanvas(graph, [], { target: '107', with: ['103', 'ghost'] }).target, '107');
assert.deepEqual(describeCanvas(graph, [], { target: '107', with: ['103', 'ghost'] }).with, ['103']);
assert.equal(describeCanvas(graph, [], { target: 'new' }).target, 'new');
assert.equal(describeCanvas(graph, [], { target: 'ghost' }).target, null, 'a target that is gone is said to be gone');
assert.equal('target' in describeCanvas(graph, [], {}), false, 'the panel sends none, so none is reported');

// ---- messagePreamble ----

assert.equal(messagePreamble({}, graph), '');
assert.equal(messagePreamble({ target: 'new' }, graph), 'To: a new asset.');
assert.equal(messagePreamble({ target: '107', with: ['103', '101'] }, graph), 'To: page 107 ("Launch page"). With: image 103 ("hero.png"), prompt 101 ("lone red fox").');
assert.equal(messagePreamble({ target: 'ghost' }, graph), 'To: ghost.');

// ---- prepareBatch ----

const files = new Set(['2-hero.png', '3-launch.html', '4-clip.mp4']);
const opts = { graph, files, now: () => 1000, random: () => 'abcd' };

{
  // Placeholder ids are rewritten everywhere they appear, and the map comes back.
  const r = prepareBatch(
    [
      { type: 'addNode', node: { id: 'new:p', type: 'prompt', position: { x: 1, y: 2 }, data: { text: 'hi' }, selected: true } },
      { type: 'addNode', node: { id: 'new:o', type: 'imageOutput', position: { x: 300, y: 2 }, data: {} } },
      { type: 'addEdge', edge: { source: 'new:p', target: 'new:o' } },
      { type: 'addEdge', edge: { id: 'new:e2', source: '103', target: 'new:o' } },
      { type: 'moveNode', id: 'new:p', position: { x: 5, y: 5 } },
      { type: 'updateNode', id: 'new:p', patch: { text: 'hello' } },
    ],
    opts,
  );
  assert.equal(r.error, undefined);
  assert.equal(r.batch.type, 'batch');
  const [p, o, e1, e2, mv, up] = r.batch.ops;
  assert.equal(p.node.id, 'a-rs-abcd');
  assert.equal(r.idMap['new:p'], p.node.id);
  assert.equal(p.node.selected, undefined, 'a tab describing itself is dropped');
  assert.equal(e1.edge.source, p.node.id);
  assert.equal(e1.edge.target, o.node.id);
  assert.equal(e1.edge.id, `e-${p.node.id}-${o.node.id}`, 'an edge gets an id if none was given');
  assert.equal(e2.edge.id, r.idMap['new:e2']);
  assert.equal(e2.edge.source, '103');
  assert.equal(mv.id, p.node.id);
  assert.equal(up.id, p.node.id);
  // Two placeholders in one batch get two ids, even with a fixed clock.
  let n = 0;
  const two = prepareBatch(
    [
      { type: 'addNode', node: { id: 'new:a', type: 'prompt', position: { x: 0, y: 0 } } },
      { type: 'addNode', node: { id: 'new:b', type: 'prompt', position: { x: 0, y: 0 } } },
    ],
    { ...opts, random: () => String(n++) },
  );
  assert.notEqual(two.batch.ops[0].node.id, two.batch.ops[1].node.id);
}

// Ids the agent chose itself pass through, so it can address existing nodes.
assert.equal(prepareBatch([{ type: 'removeNode', id: '101' }], opts).batch.ops[0].id, '101');
// But it cannot add a node with an id that is taken, or a bare one that a tab's counter would collide with is still its problem to avoid -- the document rejects duplicates.
assert.match(prepareBatch([{ type: 'addNode', node: { id: '101', type: 'prompt', position: { x: 0, y: 0 } } }], opts).error, /already exists/);

// Refusals: what the document cannot know.
assert.match(prepareBatch([], opts).error, /non-empty/);
assert.match(prepareBatch('nope', opts).error, /non-empty/);
assert.match(prepareBatch(Array.from({ length: MAX_BATCH_OPS + 1 }, () => ({ type: 'removeNode', id: 'x' })), opts).error, /at most/);
assert.match(prepareBatch([{ type: 'addNode', node: { id: 'new:x', type: 'sticker', position: { x: 0, y: 0 } } }], opts).error, /unknown node type/);
assert.match(prepareBatch([{ type: 'addNode', node: { id: 'new:x', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: 'data:image/png;base64,AAAA' } } }], opts).error, /bytes/);
assert.match(prepareBatch([{ type: 'updateNode', id: '103', patch: { dataUrl: 'data:image/png;base64,AAAA' } }], opts).error, /bytes/);
assert.match(prepareBatch([{ type: 'addNode', node: { id: 'new:x', type: 'image', position: { x: 0, y: 0 }, data: { file: 'nope.png' } } }], opts).error, /no file named "nope.png"/);
assert.match(prepareBatch([{ type: 'updateNode', id: '107', patch: { file: 'nope.html' } }], opts).error, /no file named/);
assert.match(prepareBatch([{ type: 'addNode', node: { id: 'new:x', type: 'prompt' } }], opts).error, /position/);
assert.match(prepareBatch([{ type: 'batch', ops: [] }], opts).error, /already one batch/);
assert.match(prepareBatch([{ type: 'teleport', id: '1' }], opts).error, /unknown op type/);
assert.match(prepareBatch([{ type: 'addEdge' }], opts).error, /edge is required/);
// A file that exists is fine, on an add and on a patch, including a page's.
assert.equal(prepareBatch([{ type: 'addNode', node: { id: 'new:v', type: 'video', position: { x: 0, y: 0 }, data: { file: '4-clip.mp4' } } }], opts).error, undefined);
assert.equal(prepareBatch([{ type: 'updateNode', id: '107', patch: { file: '3-launch.html', title: 'Launch' } }], opts).error, undefined);
// A prompt's data is not checked for files.
assert.equal(prepareBatch([{ type: 'updateNode', id: '100', patch: { file: 'whatever' } }], opts).error, undefined);

// Run markers are the browser's alone and are stripped, not refused.
{
  const r = prepareBatch(
    [
      { type: 'addNode', node: { id: 'new:t', type: 'textOutput', position: { x: 0, y: 0 }, data: { text: 'x', running: { startedAt: 1 }, job: 'j' } } },
      { type: 'updateNode', id: '106', patch: { running: null, text: 'y' } },
    ],
    opts,
  );
  assert.deepEqual(r.batch.ops[0].node.data, { text: 'x' });
  assert.deepEqual(r.batch.ops[1].patch, { text: 'y' });
}

// ---- pages ----

assert.equal(pageFileName(1756800000000, 'Launch page'), '1756800000000-launch-page.html');
assert.equal(pageFileName(1756800000000, ''), '1756800000000-page.html');
assert.equal(pageFileName(1756800000000, 'Launch page', 2), '1756800000000-launch-page-2.html');
assert.match(pageFileName(5, 'a b/c..d'), /^5-a-b-c-d\.html$/, 'only the alphabet the preview origin serves');
const sc = pageSidecar({ threadId: 't1', turn: 3, nodeId: 'a-1', title: 'Launch', bytes: 120, now: 0 });
assert.deepEqual(sc, { source: 'agent', kind: 'page', threadId: 't1', turn: 3, nodeId: 'a-1', title: 'Launch', bytes: 120, at: '1970-01-01T00:00:00.000Z' });
assert.equal('cost' in sc, false);

// A new page lands to the right of what it was made from, level with the top.
assert.deepEqual(placeBeside(graph, ['103', '104']), { x: 300 + 60, y: 0 });
assert.deepEqual(placeBeside(graph, ['101']), { x: 40 + 240 + 60, y: 320 }, 'an unsized node is taken as the default width');
assert.deepEqual(placeBeside(graph, []), { x: 80, y: 80 });

// ---- the tools, wired to fakes ----

{
  const committed = [];
  const written = [];
  const events = [];
  let version = 10;
  const state = { graph: JSON.parse(JSON.stringify(graph)), selection: ['103'], context: { target: 'new', with: ['103', '101'] } };
  const tools = canvasTools({
    getGraph: async () => state.graph,
    getSelection: () => state.selection,
    getContext: () => state.context,
    commit: async (batch) => {
      committed.push(batch);
      if (batch.ops.some((o) => o.type === 'removeNode' && o.id === 'ghost')) return { rejected: 'removeNode: no node ghost' };
      version += 1;
      return { version, op: batch };
    },
    files: {
      list: async () => [...files],
      writePage: async (bytes, meta) => {
        const file = `${9000 + written.length}-${(meta.title || 'page').toLowerCase().replace(/\s+/g, '-')}.html`;
        written.push({ file, html: bytes.toString('utf8'), meta });
        files.add(file);
        return file;
      },
      readPage: async (file) => (file === '3-launch.html' ? '<h1>launch</h1>' : Promise.reject(new Error('nope'))),
    },
    previewUrl: (file) => `http://127.0.0.1:5/p/coast/${file}`,
    onWrite: async (entry, summary) => events.push({ version: entry.version, ...summary }),
  });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName).sort(), ['canvas_read', 'canvas_write', 'page_read', 'page_write']);
  const call = async (name, input) => {
    const out = await byName[name].handler(input, {});
    return { ...JSON.parse(out.content[0].text), isError: Boolean(out.isError) };
  };

  // canvas_read carries the composer's context.
  const read = await call('canvas_read', {});
  assert.equal(read.target, 'new');
  assert.deepEqual(read.with, ['103', '101']);
  assert.deepEqual(read.selection, ['103']);

  // canvas_write: prepared, committed as one batch, reported.
  const w = await call('canvas_write', { ops: [{ type: 'addNode', node: { id: 'new:p', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'hi' } } }] });
  assert.equal(w.ok, true);
  assert.equal(w.version, 11);
  assert.ok(w.ids['new:p'].startsWith('a-'));
  assert.equal(committed.length, 1);
  assert.equal(committed[0].type, 'batch');
  assert.deepEqual(events.at(-1), { version: 11, summary: '1 change', opCount: 1 });
  // A refusal is an error result, and nothing was committed.
  const bad = await call('canvas_write', { ops: [{ type: 'addNode', node: { id: 'new:x', type: 'sticker', position: { x: 0, y: 0 } } }] });
  assert.equal(bad.isError, true);
  assert.match(bad.error, /unknown node type/);
  assert.equal(committed.length, 1);
  // The document's own rejection comes back verbatim.
  const rej = await call('canvas_write', { ops: [{ type: 'removeNode', id: 'ghost' }] });
  assert.equal(rej.isError, true);
  assert.equal(rej.error, 'removeNode: no node ghost');

  // page_write, new: a file, then one addNode beside the `with` nodes, with the context's title.
  const created = await call('page_write', { html: '<h1>hello</h1>', title: 'Hello page' });
  assert.equal(created.ok, true);
  assert.equal(created.file, '9000-hello-page.html');
  assert.equal(created.previewUrl, 'http://127.0.0.1:5/p/coast/9000-hello-page.html');
  assert.equal(written[0].html, '<h1>hello</h1>');
  assert.equal(written[0].meta.nodeId, null);
  const addOp = committed.at(-1).ops[0];
  assert.equal(addOp.type, 'addNode');
  assert.equal(addOp.node.type, 'page');
  assert.equal(addOp.node.id, created.nodeId);
  assert.deepEqual(addOp.node.data, { file: '9000-hello-page.html', title: 'Hello page', fileName: '' });
  assert.deepEqual(addOp.node.position, placeBeside(graph, ['103', '101']));
  assert.equal(events.at(-1).summary, 'Created page · Hello page');
  assert.deepEqual(events.at(-1).page, { nodeId: created.nodeId, file: '9000-hello-page.html', title: 'Hello page', created: true });

  // page_write, existing: a NEW file and an updateNode pointing at it -- the old file is untouched.
  const updated = await call('page_write', { nodeId: '107', html: '<h1>v2</h1>' });
  assert.equal(updated.ok, true);
  assert.equal(updated.nodeId, '107');
  assert.equal(updated.file, '9001-launch-page.html', 'named after the existing title');
  assert.equal(written[1].meta.nodeId, '107');
  assert.deepEqual(committed.at(-1).ops, [{ type: 'updateNode', id: '107', patch: { file: '9001-launch-page.html' } }]);
  assert.equal(files.has('3-launch.html'), true, 'never overwritten');
  assert.equal(events.at(-1).summary, 'Updated page · Launch page');
  // A rename travels in the same patch.
  const renamed = await call('page_write', { nodeId: '107', html: '<h1>v3</h1>', title: 'Landing' });
  assert.deepEqual(committed.at(-1).ops[0].patch, { file: '9002-landing.html', title: 'Landing' });
  assert.equal(renamed.title, 'Landing');

  // Refusals.
  assert.match((await call('page_write', { html: '   ' })).error, /non-empty/);
  assert.match((await call('page_write', { html: 'x'.repeat(MAX_PAGE_BYTES + 1) })).error, /too large/);
  assert.match((await call('page_write', { nodeId: 'ghost', html: '<p>' })).error, /no node ghost/);
  assert.match((await call('page_write', { nodeId: '103', html: '<p>' })).error, /is a image, not a page/);
  assert.equal(written.length, 3, 'a refused write touches no file');

  // page_read.
  const read107 = await byName.page_read.handler({ nodeId: '107' }, {});
  assert.equal(read107.content[0].text, '<h1>launch</h1>');
  assert.match((await call('page_read', { nodeId: '103' })).error, /not a page/);
  assert.match((await call('page_read', { nodeId: 'ghost' })).error, /no node/);
  state.graph.nodes.push({ id: 'empty', type: 'page', position: { x: 0, y: 0 }, data: { file: '' } });
  assert.match((await call('page_read', { nodeId: 'empty' })).error, /no file yet/);
  state.graph.nodes.push({ id: 'lost', type: 'page', position: { x: 0, y: 0 }, data: { file: '8-gone.html' } });
  assert.match((await call('page_read', { nodeId: 'lost' })).error, /could not be read/);
}

// ---- the server the SDK sees ----
// Every tool must survive the SDK's schema conversion and come back from listTools: a
// schema it cannot convert made the whole server register nothing, and the model told
// the user the tools were unavailable (2026-09-05). This is the check the session's init
// guard (agent.js, REQUIRED_TOOLS) relies on never firing.
{
  const tools = canvasTools({
    getGraph: async () => graph,
    getSelection: () => [],
    getContext: () => ({}),
    commit: async () => ({ version: 1 }),
    files: { list: async () => [], writePage: async () => 'x.html', readPage: async () => '' },
    previewUrl: (f) => f,
  });
  const server = createSdkMcpServer({ name: 'unframed', version: '2', tools });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((t) => t.name).sort(), ['canvas_read', 'canvas_write', 'page_read', 'page_write']);
  const write = listed.tools.find((t) => t.name === 'canvas_write');
  assert.equal(write.inputSchema.properties.ops.type, 'array');
  assert.deepEqual(write.inputSchema.required, ['ops']);
  const pw = listed.tools.find((t) => t.name === 'page_write');
  assert.deepEqual(pw.inputSchema.required, ['html']);
  // And a call through the client reaches the handler.
  const res = await client.callTool({ name: 'canvas_read', arguments: {} });
  assert.equal(JSON.parse(res.content[0].text).nodes.length, graph.nodes.length);
  await client.close();
}

console.log('agentTools.test.js: ok');
