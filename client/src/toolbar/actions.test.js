// Assert-based self-check. Run with: node client/src/toolbar/actions.test.js
import assert from 'node:assert/strict';
import { toolbarActions, sizeHint } from './actions.js';

const n = (id, type, data = {}) => ({ id, type, data, position: { x: 0, y: 0 } });

assert.deepEqual(toolbarActions([]), { primary: null, count: 0 });

// One output: its own action, with what it is set to make.
assert.deepEqual(toolbarActions([n('o', 'imageOutput', { size: '1024x1024' })]), {
  primary: { kind: 'run', label: 'Generate', hint: '1024×1024', nodeId: 'o', busy: false },
  count: 1,
});
assert.equal(toolbarActions([n('o', 'imageOutput', { resolution: '1080p', aspect_ratio: '16:9' })]).primary.hint, '1080p · 16:9');
assert.equal(toolbarActions([n('o', 'imageOutput', {})]).primary.hint, '');
assert.equal(toolbarActions([n('v', 'videoOutput', { resolution: '720p' })]).primary.label, 'Generate');
assert.deepEqual(toolbarActions([n('t', 'textOutput', { text: 'x' })]).primary, { kind: 'run', label: 'Run', hint: '', nodeId: 't', busy: false });
// Mid-run, the action is there but busy, so the button can say so instead of firing twice.
assert.equal(toolbarActions([n('o', 'imageOutput', { running: { startedAt: 1 } })]).primary.busy, true);
assert.equal(toolbarActions([n('v', 'videoOutput', { job: { id: 'j' } })]).primary.busy, true);

// One page: Open, once it has a file.
assert.deepEqual(toolbarActions([n('g', 'page', { file: '1-a.html', title: 'Launch' })]).primary, { kind: 'open', label: 'Open', hint: 'Launch', nodeId: 'g' });
assert.equal(toolbarActions([n('g', 'page', {})]).primary, null);

// A lone input: nothing but Agent.
assert.deepEqual(toolbarActions([n('p', 'prompt')]), { primary: null, count: 1 });
assert.deepEqual(toolbarActions([n('i', 'image', { file: 'x.png' })]), { primary: null, count: 1 });

// Several: the count, whatever they are.
assert.deepEqual(toolbarActions([n('p', 'prompt'), n('o', 'imageOutput')]), { primary: { kind: 'count', label: '2 selected' }, count: 2 });
assert.equal(toolbarActions([n('a', 'page'), n('b', 'page'), n('c', 'image')]).primary.label, '3 selected');

// The hint on its own.
assert.equal(sizeHint({ data: { size: '1536X1024' } }), '1536×1024');
assert.equal(sizeHint({ data: { size: 'auto', aspect_ratio: '3:2' } }), '3:2', 'a non-numeric size is not a size');
assert.equal(sizeHint(null), '');

console.log('actions.test.js: ok');
