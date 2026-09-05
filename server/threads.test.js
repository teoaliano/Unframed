// node server/threads.test.js  (also runs as part of `npm test`)
//
// A thread is one conversation with the agent about a project, durable like a video job:
// the record is on disk before a turn starts, so a turn in flight survives the tab that
// asked for it. Pure transitions here, thin I/O below them, the sidecar every turn leaves.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  newThread,
  appendMessage,
  appendEvent,
  setStatus,
  threadSummary,
  eventsSince,
  readThread,
  writeThread,
  persistThread,
  listThreads,
  deleteThread,
  threadPath,
  agentSidecar,
  bindArtifact,
  applySettings,
  renameThread,
  findArtifactThread,
} from './threads.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-threads-test-'));

// ---- a new thread ----
const t0 = newThread({ id: 't1', project: 'coast', provider: 'claude', model: 'claude-opus-5', now: 1000 });
assert.equal(t0.id, 't1');
assert.equal(t0.kind, 'canvas');
assert.equal(t0.status, 'idle');
assert.deepEqual(t0.messages, []);
assert.deepEqual(t0.events, []);
assert.equal(t0.createdAt, 1000);
assert.equal(t0.updatedAt, 1000);
assert.equal(t0.seq, 0, 'event sequence starts empty');
assert.equal(t0.turns, 0);
assert.throws(() => newThread({ id: 'x', project: 'p', provider: 'grok', model: 'm' }), /provider/);
assert.throws(() => newThread({ id: '../evil', project: 'p', provider: 'claude', model: 'm' }), /id/);
assert.equal(t0.artifactId, null, 'a canvas thread is about the board, not a node');

// ---- an artifact thread: about one node, bound now or when the agent creates it ----
{
  const bound = newThread({ id: 'ta', project: 'coast', provider: 'claude', model: '', kind: 'artifact', artifactId: '107', now: 1 });
  assert.equal(bound.kind, 'artifact');
  assert.equal(bound.artifactId, '107');
  const pending = newThread({ id: 'tb', project: 'coast', provider: 'claude', model: '', kind: 'artifact', now: 1 });
  assert.equal(pending.artifactId, null);
  const later = bindArtifact(pending, 'a-1', 5);
  assert.equal(later.artifactId, 'a-1');
  assert.equal(later.updatedAt, 5);
  assert.equal(bindArtifact(later, 'a-2', 6).artifactId, 'a-1', 'bound once');

  // Model and effort for the next turn: each optional, '' resets, refused mid-turn.
  const set = applySettings(later, { model: 'claude-opus-5', effort: 'high' }, 7);
  assert.equal(set.model, 'claude-opus-5');
  assert.equal(set.effort, 'high');
  assert.equal(set.updatedAt, 7);
  assert.equal(applySettings(set, { effort: '' }, 8).effort, '', 'empty resets to the default');
  assert.equal(applySettings(set, { effort: 'high' }, 9), set, 'no change returns the same record');
  assert.equal(applySettings(set, { model: 'claude-sonnet-5' }, 9).effort, 'high', 'an absent key leaves the field alone');
  assert.throws(() => applySettings(set, { effort: 'ultra' }), /Effort must be one of/);
  assert.throws(() => applySettings(set, { model: 'x'.repeat(201) }), /model id/);
  assert.throws(() => applySettings({ ...set, status: 'running' }, { effort: 'low' }), /turn is running/);
  assert.equal(newThread({ id: 't-e', project: 'p', provider: 'claude', effort: 'medium', now: 1 }).effort, 'medium');
  assert.throws(() => newThread({ id: 't-e', project: 'p', provider: 'claude', effort: 'silly', now: 1 }), /unknown effort/);
  assert.equal(bindArtifact(t0, 'a-1', 6).artifactId, null, 'a canvas thread never binds');
  assert.equal(newThread({ id: 'tc', project: 'p', provider: 'claude', model: '', artifactId: '107', now: 1 }).artifactId, null, 'a canvas thread ignores an artifactId');
  assert.throws(() => newThread({ id: 'td', project: 'p', provider: 'claude', model: '', kind: 'sticky' }), /kind/);
  assert.throws(() => newThread({ id: 'te', project: 'p', provider: 'claude', model: '', kind: 'artifact', artifactId: '../x' }), /artifactId/);
  assert.equal(threadSummary(bound).artifactId, '107');
  // The composer's context is kept on the message.
  const m = appendMessage(bound, { role: 'user', text: 'swap the hero', selection: ['107', '103'], target: '107', with: ['103'] }, 2).messages[0];
  assert.equal(m.target, '107');
  assert.deepEqual(m.with, ['103']);
  const plain = appendMessage(bound, { role: 'user', text: 'hi', selection: [] }, 2).messages[0];
  assert.equal('target' in plain, false);
  assert.equal('with' in plain, false);
}

// ---- messages and events are appended immutably, with a sequence and a timestamp ----
const t1 = appendMessage(t0, { role: 'user', text: 'What is on the canvas?', selection: ['1', '2'] }, 2000);
assert.equal(t1.messages.length, 1);
assert.equal(t1.messages[0].role, 'user');
assert.equal(t1.messages[0].at, 2000);
assert.deepEqual(t1.messages[0].selection, ['1', '2']);
assert.equal(t1.updatedAt, 2000);
assert.equal(t1.turns, 1, 'a user message starts a turn');
assert.equal(t0.messages.length, 0, 'the original is untouched');
const t2 = appendEvent(t1, { type: 'tool_use', name: 'canvas_read', input: {} }, 2100);
const t3 = appendEvent(t2, { type: 'tool_result', name: 'canvas_read', ok: true }, 2200);
assert.deepEqual(t3.events.map((e) => e.seq), [1, 2]);
assert.equal(t3.events[0].turn, 1, 'events know which turn they belong to');
assert.equal(t3.seq, 2);
// Text deltas are streamed, never stored: the final text is what the record keeps.
const t4 = appendEvent(t3, { type: 'text_delta', text: 'Th' }, 2300);
assert.equal(t4, t3, 'a delta is not a record change');
const t5 = appendMessage(t4, { role: 'assistant', text: 'Three nodes.' }, 2400);
assert.equal(t5.turns, 1, 'an assistant message closes a turn, it does not open one');
assert.equal(t5.messages.at(-1).turn, 1);

// ---- status ----
const running = setStatus(t5, 'running', {}, 2500);
assert.equal(running.status, 'running');
assert.equal(running.error, undefined);
const failed = setStatus(running, 'failed', { error: 'rate limited' }, 2600);
assert.equal(failed.status, 'failed');
assert.equal(failed.error, 'rate limited');
const idle = setStatus(failed, 'idle', {}, 2700);
assert.equal(idle.error, undefined, 'going idle clears the error');
assert.throws(() => setStatus(idle, 'exploded'), /status/);

// ---- eventsSince, for a stream that reconnects ----
assert.deepEqual(eventsSince(t3, 0).map((e) => e.seq), [1, 2]);
assert.deepEqual(eventsSince(t3, 1).map((e) => e.seq), [2]);
assert.deepEqual(eventsSince(t3, 2), []);

// ---- the list shows a summary, not the transcript ----
const s = threadSummary(t5);
assert.deepEqual(Object.keys(s).sort(), ['artifactId', 'createdAt', 'effort', 'id', 'kind', 'model', 'preview', 'provider', 'status', 'title', 'turns', 'updatedAt']);
assert.equal(s.preview, 'What is on the canvas?', 'the first user message previews the thread');
assert.equal(s.title, '', 'an unnamed thread has no title, however much was said in it');
assert.equal(threadSummary(t0).preview, '');

// ---- renaming ----
const named = renameThread(t5, '  Hero copy  ', 3000);
assert.equal(named.title, 'Hero copy', 'the name is trimmed');
assert.equal(threadSummary(named).title, 'Hero copy');
assert.equal(threadSummary(named).preview, 'What is on the canvas?', 'a name does not replace the preview');
assert.equal(renameThread(named, 'Hero copy', 4000), named, 'renaming to the same name does not touch the record');
assert.equal(renameThread(named, '', 4000).title, '', 'an empty name clears it');
assert.equal(renameThread(t5, 'x'.repeat(200), 3000).title.length, 60, 'a name is capped');
assert.equal(renameThread({ ...t5, status: 'running' }, 'Mid-turn', 3000).title, 'Mid-turn', 'renaming mid-turn is allowed; it is a label, not a setting');
assert.throws(() => renameThread(t5, 42), /text/);

// ---- I/O: temp-then-rename, per-thread serialisation, list, delete ----
{
  const dir = path.join(root, 'proj');
  await writeThread(dir, t5);
  assert.equal(threadPath(dir, 't1'), path.join(dir, 'threads', 't1.json'));
  const back = await readThread(dir, 't1');
  assert.deepEqual(back, t5);
  await assert.rejects(() => readThread(dir, 'nope'), /not found/i);
  // Concurrent persists of the same thread do not interleave: the last write wins
  // whole, and every intermediate one was a complete file.
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => persistThread(dir, 't1', (cur) => appendEvent(cur, { type: 'status', i }, 3000 + i))),
  );
  const many = await readThread(dir, 't1');
  assert.equal(many.events.length, t5.events.length + 10);
  assert.deepEqual(many.events.slice(-10).map((e) => e.i), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'in order, none dropped');
  // persistThread on a thread that is not there yet creates it from the function.
  await persistThread(dir, 't2', (cur) => cur ?? newThread({ id: 't2', project: 'coast', provider: 'codex', model: 'gpt-5.5', now: 5000 }));
  const list = await listThreads(dir);
  assert.deepEqual(list.map((x) => x.id), ['t1', 't2'].sort((a, b) => (a === 't1' ? 1 : -1)), 'newest first');
  assert.equal(list[0].id, 't2');
  assert.equal(await listThreads(path.join(root, 'nothing-here')).then((l) => l.length), 0, 'no folder: no threads');
  await deleteThread(dir, 't2');
  assert.deepEqual((await listThreads(dir)).map((x) => x.id), ['t1']);
  await deleteThread(dir, 't2'); // idempotent
}

// ---- every turn leaves a sidecar, and a subscription turn is not a cost ----
{
  const dir = path.join(root, 'sidecar');
  const file = await agentSidecar(dir, {
    threadId: 't1',
    turn: 1,
    provider: 'claude',
    model: 'claude-opus-5',
    usage: { input_tokens: 1200, output_tokens: 300 },
    estimatedUsd: 0.042,
    durationMs: 8000,
    now: 1700000000000,
  });
  assert.match(file, /^1700000000000-agent\.json$/);
  const side = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
  assert.equal(side.billing, 'subscription');
  assert.equal(side.cost, undefined, 'never a cost field: a zero would corrupt the spend sums');
  assert.equal(side.estimatedUsd, 0.042);
  assert.equal(side.provider, 'claude');
  assert.deepEqual(side.usage, { input_tokens: 1200, output_tokens: 300 });
  // Two turns in one millisecond do not overwrite each other.
  const second = await agentSidecar(dir, { threadId: 't1', turn: 2, provider: 'claude', model: 'm', usage: {}, now: 1700000000000 });
  assert.notEqual(second, file);
}

await fs.rm(root, { recursive: true, force: true });
console.log('threads.test.js: ok');
