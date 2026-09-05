// Assert-based self-check. Run with: node client/src/agent/tabs.test.js
import assert from 'node:assert/strict';
import { visibleThreads, nextActive, tabLabel } from './tabs.js';

const n = (id, type, data = {}) => ({ id, type, data, position: { x: 0, y: 0 } });
const nodes = [n('i1', 'image'), n('g1', 'page', { file: 'a.html', title: 'Launch' }), n('g2', 'page', { file: 'b.html', fileName: 'deck.html' })];
const t = (id, kind, artifactId = null) => ({ id, kind, artifactId, status: 'idle' });
// Newest first, as the server lists them.
const threads = [t('t5', 'artifact', 'g2'), t('t4', 'canvas'), t('t3', 'artifact', 'g1'), t('t2', 'artifact', 'gone'), t('t1', 'artifact', 'g1')];

const ids = (list) => list.map((x) => x.id);

// No artifact selected: every thread, minus the one whose node is not on the canvas.
assert.deepEqual(ids(visibleThreads(threads, [], nodes)), ['t5', 't4', 't3', 't1']);
assert.deepEqual(ids(visibleThreads(threads, ['i1'], nodes)), ['t5', 't4', 't3', 't1'], 'an input in the selection does not narrow');
// One artifact selected: only its threads; the canvas ones drop out.
assert.deepEqual(ids(visibleThreads(threads, ['g1', 'i1'], nodes)), ['t3', 't1']);
// Several: the union, still no canvas threads.
assert.deepEqual(ids(visibleThreads(threads, ['g1', 'g2'], nodes)), ['t5', 't3', 't1']);
// A selected artifact with no threads yet shows nothing -- the next send creates one.
assert.deepEqual(ids(visibleThreads([t('t4', 'canvas')], ['g1'], nodes)), []);
// An artifact thread not yet bound (the agent is about to create the node) counts as live.
assert.deepEqual(ids(visibleThreads([t('t9', 'artifact', null)], [], nodes)), ['t9']);

// The active tab survives a re-filter it is still part of, else the newest visible wins,
// else none.
const vis = visibleThreads(threads, ['g1'], nodes);
assert.equal(nextActive('t1', vis), 't1');
assert.equal(nextActive('t5', vis), 't3', 'filtered out: the newest visible');
assert.equal(nextActive(null, vis), 't3');
assert.equal(nextActive('t5', []), null);
assert.equal(nextActive(null, []), null);

// Labels: the node's title, else its file name without the extension, else the id.
assert.equal(tabLabel(t('t4', 'canvas'), nodes), 'Canvas');
assert.equal(tabLabel(t('t3', 'artifact', 'g1'), nodes), 'Launch');
assert.equal(tabLabel(t('t5', 'artifact', 'g2'), nodes), 'deck');
assert.equal(tabLabel(t('t2', 'artifact', 'gone'), nodes), 'gone');

console.log('tabs.test.js: all assertions passed');
