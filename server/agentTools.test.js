// node server/agentTools.test.js  (also runs as part of `npm test`)
//
// What the agent sees when it reads the canvas: a compact, honest description of the
// graph -- ids, kinds, the prompt text, where media files are -- and the selection the
// browser sent. Never bytes, never data URLs.
import assert from 'node:assert/strict';
import { describeCanvas, canvasTools } from './agentTools.js';

const graph = {
  nodes: [
    { id: '100', type: 'prompt', position: { x: 40, y: 60 }, data: { text: 'A @101 on a cliff' }, width: 240, height: 160 },
    { id: '101', type: 'prompt', position: { x: 40, y: 320 }, data: { text: 'lone red fox' } },
    { id: '102', type: 'imageOutput', position: { x: 460, y: 120 }, data: { model: 'openai/gpt-image-2', quality: 'low', aspect_ratio: '1:1', runs: 1, results: [{ url: '/api/file/p/1-a.png', runIndex: 0 }] } },
    { id: '103', type: 'image', position: { x: 0, y: 0 }, data: { file: '2-hero.png', fileName: 'hero.png', aspect: 1.5 }, width: 300 },
    { id: '104', type: 'video', position: { x: 0, y: 200 }, data: { dataUrl: 'https://cdn.example/clip.mp4', fileName: 'clip.mp4' } },
    { id: '105', type: 'video', position: { x: 0, y: 400 }, data: { dataUrl: 'data:video/mp4;base64,AAAA', fileName: 'old.mp4' } },
    { id: '106', type: 'textOutput', position: { x: 500, y: 400 }, data: { text: 'Summarise', result: 'A fox.', model: 'anthropic/claude-sonnet-5', running: { startedAt: 1 } } },
  ],
  edges: [
    { id: 'e1', source: '100', target: '102' },
    { id: 'e2', source: '103', target: '102' },
  ],
};

const d = describeCanvas(graph, ['101', '103']);
assert.deepEqual(Object.keys(d).sort(), ['edges', 'nodes', 'selection']);
assert.equal(d.nodes.length, 7);
const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
// Prompts carry their text; the @reference is left as typed for the model to see.
assert.deepEqual(byId['100'], { id: '100', kind: 'prompt', position: { x: 40, y: 60 }, size: { width: 240, height: 160 }, text: 'A @101 on a cliff' });
// An image output: its settings and the files it produced, as project file names.
assert.equal(byId['102'].kind, 'image output');
assert.equal(byId['102'].model, 'openai/gpt-image-2');
assert.deepEqual(byId['102'].settings, { quality: 'low', aspect_ratio: '1:1', runs: 1 });
assert.deepEqual(byId['102'].results, ['1-a.png']);
// A reference image: the file name in the project folder, never bytes.
assert.deepEqual(byId['103'], { id: '103', kind: 'image', position: { x: 0, y: 0 }, size: { width: 300 }, file: '2-hero.png', fileName: 'hero.png', aspect: 1.5 });
// A hosted video keeps its URL; a legacy inline one is described, not dumped.
assert.equal(byId['104'].url, 'https://cdn.example/clip.mp4');
assert.equal(byId['104'].file, undefined);
assert.equal(byId['105'].url, undefined);
assert.equal(byId['105'].inline, true);
assert.equal(JSON.stringify(d).includes('base64'), false, 'no bytes reach the model');
// A text output: its instructions and its answer are two different things.
assert.equal(byId['106'].kind, 'text output');
assert.equal(byId['106'].text, 'Summarise');
assert.equal(byId['106'].result, 'A fox.');
assert.equal(byId['106'].running, true, 'an in-flight run is worth knowing about');
assert.equal(byId['106'].model, 'anthropic/claude-sonnet-5');
// Edges say what feeds what; selection is passed through, filtered to nodes that exist.
assert.deepEqual(d.edges, [{ from: '100', to: '102' }, { from: '103', to: '102' }]);
assert.deepEqual(d.selection, ['101', '103']);
assert.deepEqual(describeCanvas(graph, ['101', 'ghost']).selection, ['101']);
assert.deepEqual(describeCanvas(graph, undefined).selection, []);
assert.deepEqual(describeCanvas({ nodes: [], edges: [] }, []), { nodes: [], edges: [], selection: [] });

// The tool set: one read-only tool in this slice, wired to whatever the callbacks say.
{
  let asked = 0;
  const tools = canvasTools({
    getGraph: async () => {
      asked++;
      return graph;
    },
    getSelection: () => ['101'],
  });
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'canvas_read');
  const out = await tools[0].handler({}, {});
  assert.equal(asked, 1);
  assert.equal(out.content[0].type, 'text');
  const parsed = JSON.parse(out.content[0].text);
  assert.deepEqual(parsed.selection, ['101']);
  assert.equal(parsed.nodes.length, 7);
}

console.log('agentTools.test.js: ok');
