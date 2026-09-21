// Assert-based self-check. Run with: node client/src/agent/tabs.test.js
import assert from 'node:assert/strict';
import { visibleThreads, nextActive, tabLabel, nodeLabel, continuableChat, touchedArtifacts } from './tabs.js';

const n = (id, type, data = {}) => ({ id, type, data, position: { x: 0, y: 0 } });
const nodes = [
  n('i1', 'image'),
  n('g1', 'page', { file: 'a.html', title: 'Launch' }),
  n('g2', 'page', { file: 'b.html', fileName: 'deck.html' }),
  n('m1', 'motion', { file: 'c.html' }),
];
const t = (id, tags = [], extra = {}) => ({ id, tags, status: 'idle', title: '', titledBy: null, preview: '', ...extra });
// Newest first, as the server lists them.
const threads = [t('t5', ['g2']), t('t4', []), t('t3', ['g1', 'g2']), t('t2', ['gone']), t('t1', ['g1'])];

const ids = (list) => list.map((x) => x.id);

// Nothing selected: every chat, including the one whose artifact has been deleted. That
// chat used to be hidden; a tag is a pointer, so the conversation outlives the file.
assert.deepEqual(ids(visibleThreads(threads, [], nodes)), ['t5', 't4', 't3', 't2', 't1']);
assert.deepEqual(ids(visibleThreads(threads, ['i1'], nodes)), ['t5', 't4', 't3', 't2', 't1'], 'an input in the selection does not narrow');
assert.deepEqual(ids(visibleThreads(threads, ['nosuch'], nodes)), ['t5', 't4', 't3', 't2', 't1'], 'an id that is not on the canvas narrows nothing');

// One artifact selected: the chats tagged with it. Untagged chats drop out.
assert.deepEqual(ids(visibleThreads(threads, ['g1', 'i1'], nodes)), ['t3', 't1']);
// Several selected: any-of -- what has been said about either of these.
assert.deepEqual(ids(visibleThreads(threads, ['g1', 'g2'], nodes)), ['t5', 't3', 't1']);
// A selected artifact nothing has been said about shows nothing; the next send starts one.
assert.deepEqual(ids(visibleThreads(threads, ['m1'], nodes)), []);
// A chat tagged with two artifacts is listed under each of them, once.
assert.deepEqual(ids(visibleThreads([t('tx', ['g1', 'g2'])], ['g1', 'g2'], nodes)), ['tx']);

// The active tab survives a re-filter it is still part of, else the newest visible wins,
// else none.
const vis = visibleThreads(threads, ['g1'], nodes);
assert.equal(nextActive('t1', vis), 't1');
assert.equal(nextActive('t5', vis), 't3', 'filtered out: the newest visible');
assert.equal(nextActive(null, vis), 't3');
assert.equal(nextActive('t5', []), null);
assert.equal(nextActive(null, []), null);

// ---- what a tab reads ----
// Nobody has said anything yet.
assert.equal(tabLabel(t('t4')), 'Chat');
// The opening words, when neither the person nor the agent has named it.
assert.equal(tabLabel(t('t4', [], { preview: 'make both titles red' })), 'make both titles red');
assert.equal(
  tabLabel(t('t4', [], { preview: 'make the titles red and then move everything to the left' })),
  'make the titles red and then mov…',
  'a long opening is cut to 32 characters to fit a tab',
);
assert.equal(tabLabel(t('t4', [], { preview: '   ' })), 'Chat', 'whitespace is not an opening');
// A name -- the agent's or the person's -- wins over the opening words. Which of them
// wrote it is settled server-side (titledBy), so the tab does not have to ask.
assert.equal(tabLabel(t('t4', [], { title: 'Title fixes', titledBy: 'agent', preview: 'make both titles red' })), 'Title fixes');
assert.equal(tabLabel(t('t4', [], { title: 'Hero copy', titledBy: 'user', preview: 'make both titles red' })), 'Hero copy');
assert.equal(tabLabel(t('t4', [], { title: '   ', preview: 'still here' })), 'still here', 'a blank name is no name');

// ---- what a node is called, and whether it still points at anything ----
assert.deepEqual(nodeLabel('g1', nodes), { id: 'g1', label: 'Launch', stale: false, type: 'page' });
assert.deepEqual(nodeLabel('g2', nodes), { id: 'g2', label: 'deck', stale: false, type: 'page' }, 'the file name, without the extension');
assert.deepEqual(nodeLabel('m1', nodes), { id: 'm1', label: 'm1', stale: false, type: 'motion' }, 'nothing to call it but its id');
// The artifact is gone: the row is shown, greyed, with no Locate and no icon to wear.
assert.deepEqual(nodeLabel('gone', nodes), { id: 'gone', label: 'gone', stale: true, type: null });

// ---- what a chat has touched, for the recap card at the foot of the transcript ----
{
  const ev = (type, extra) => ({ type, ...extra });
  const events = [
    ev('session', {}),
    // canvas_read names nothing: it reads the whole board, every turn, and listing
    // everything would bury what the turn was actually about.
    ev('tool_use', { name: 'mcp__unframed__canvas_read', input: {} }),
    ev('tool_use', { name: 'mcp__unframed__motion_read', input: { nodeId: 'm1' } }),
    ev('tool_use', { name: 'mcp__unframed__motion_write', input: { nodeId: 'm1' } }),
    ev('ops_applied', { version: 4, page: { nodeId: 'm1', kind: 'motion' } }),
    // A canvas_write batch reports its artifacts on the applied event; its own tool_use
    // carries ops, not a nodeId.
    ev('tool_use', { name: 'mcp__unframed__canvas_write', input: { ops: [] } }),
    ev('ops_applied', { version: 5, artifacts: ['g1', 'g2'] }),
    ev('result', { ok: true }),
  ];
  // First-touch order, each named once: a read and a write of the same thing is one row,
  // because the card deliberately does not distinguish them.
  assert.deepEqual(touchedArtifacts(events), ['m1', 'g1', 'g2']);
  assert.deepEqual(touchedArtifacts([]), []);
  assert.deepEqual(touchedArtifacts(undefined), []);
  assert.deepEqual(touchedArtifacts([ev('tool_use', { input: {} }), ev('ops_applied', {})]), [], 'nothing named, nothing listed');
  // A created artifact is listed, and an artifact that has since been deleted still is:
  // the card says what the conversation involved, not what survives.
  assert.deepEqual(touchedArtifacts([ev('ops_applied', { page: { nodeId: 'new-1', created: true } })]), ['new-1']);
  assert.deepEqual(touchedArtifacts([ev('tool_use', { input: { nodeId: 'gone' } })]), ['gone']);
}

// ---- which chat the composer would continue ----
// All-of, unlike the strip's any-of above: continuing a chat about g1 for a message
// about g1 AND g2 would carry over an answer that never saw g2.
{
  const c = [
    t('newest-untagged', []),
    t('both', ['g1', 'g2']),
    t('one', ['g1']),
    t('older-untagged', []),
    t('busy', ['m1'], { status: 'running' }),
  ];
  assert.equal(continuableChat(c, ['g1', 'g2']).id, 'both');
  assert.equal(continuableChat(c, ['g1']).id, 'both', 'the newest whose tags include g1');
  assert.equal(continuableChat(c, ['g2']).id, 'both');
  assert.equal(continuableChat(c, ['m1']), null, 'a chat mid-turn is never continued');
  assert.equal(continuableChat(c, ['nope']), null, 'nothing about it yet: start one');
  // A chat about g1 alone does not answer a message about g1 and something new.
  assert.equal(continuableChat([t('one', ['g1'])], ['g1', 'g2']), null);
  // Nothing selected: the newest idle UNTAGGED chat, not simply the newest.
  assert.equal(continuableChat(c, []).id, 'newest-untagged');
  assert.equal(continuableChat(c).id, 'newest-untagged', 'no argument is the same as none selected');
  assert.equal(continuableChat([t('tagged', ['g1'])], []), null, 'every chat is about something: start a fresh one');
  assert.equal(continuableChat([], ['g1']), null);
}

console.log('tabs.test.js: all assertions passed');
