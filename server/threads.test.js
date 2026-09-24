// node server/threads.test.js  (also runs as part of `npm test`)
//
// A thread is a CHAT with the agent about a project, tagged by the artifacts it has
// touched and durable like a video job: the record is on disk before a turn starts, so a
// turn in flight survives the tab that asked for it. Pure transitions here, thin I/O
// below them, the sidecar every turn leaves.
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
  setMode,
  askPermission,
  answerPermission,
  reconcile,
  QUIT_MID_TURN,
  readThread,
  writeThread,
  persistThread,
  listThreads,
  deleteThread,
  threadPath,
  agentSidecar,
  applySettings,
  renameThread,
  titleThread,
  tagThread,
  findChatFor,
  migrateThread,
} from './threads.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-threads-test-'));

// ---- a new thread ----
const t0 = newThread({ id: 't1', project: 'coast', provider: 'claude', model: 'claude-opus-5', now: 1000 });
assert.equal(t0.id, 't1');
assert.equal(t0.status, 'idle');
assert.deepEqual(t0.messages, []);
assert.deepEqual(t0.events, []);
assert.equal(t0.createdAt, 1000);
assert.equal(t0.updatedAt, 1000);
assert.equal(t0.seq, 0, 'event sequence starts empty');
assert.equal(t0.turns, 0);
assert.throws(() => newThread({ id: 'x', project: 'p', provider: 'grok', model: 'm' }), /provider/);
assert.throws(() => newThread({ id: '../evil', project: 'p', provider: 'claude', model: 'm' }), /id/);
assert.deepEqual(t0.tags, [], 'a chat starts tagged with nothing');
assert.equal(t0.titledBy, null);
assert.equal(t0.lastVersion, null);

// ---- a chat is tagged by the artifacts it touches; tags are pointers, not bindings ----
{
  const chat = newThread({ id: 'ta', project: 'coast', provider: 'claude', model: '', tags: ['107', '108'], now: 1 });
  assert.deepEqual(chat.tags, ['107', '108']);
  assert.deepEqual(newThread({ id: 'tb', project: 'p', provider: 'claude', tags: ['107', '107'], now: 1 }).tags, ['107'], 'deduplicated');
  assert.throws(() => newThread({ id: 'tc', project: 'p', provider: 'claude', tags: ['../x'], now: 1 }), /tag must be a node id/);
  assert.throws(() => newThread({ id: 'td', project: 'p', provider: 'claude', tags: '107', now: 1 }), /tags must be an array/);

  // A tag is added once; adding one it already has is not a record change, so a turn
  // that rewrites the same page five times does not write the record five times.
  const more = tagThread(chat, ['109'], 5);
  assert.deepEqual(more.tags, ['107', '108', '109'], 'appended, order kept');
  assert.equal(more.updatedAt, 5);
  assert.equal(tagThread(more, ['108'], 6), more, 'a tag it already has returns the same object');
  assert.equal(tagThread(more, [], 6), more);
  assert.deepEqual(tagThread(more, ['110', '110'], 7).tags, ['107', '108', '109', '110']);
  // A tag whose node is gone stays: the chat outlives the artifact (decision 1).
  assert.deepEqual(tagThread({ ...more, tags: [] }, ['107'], 8).tags, ['107']);

  assert.deepEqual(threadSummary(chat).tags, ['107', '108']);
  // The selection travels on the message as context, not as a target.
  const m = appendMessage(chat, { role: 'user', text: 'swap the hero', selection: ['107', '103'] }, 2).messages[0];
  assert.deepEqual(m.selection, ['107', '103']);
  assert.equal('target' in m, false, 'no target: the agent decides what a message means');
  assert.equal('with' in m, false);
}

// ---- who named the chat: a person always beats the agent, in either order ----
{
  const base = newThread({ id: 'tn', project: 'p', provider: 'claude', now: 1 });
  const byAgent = titleThread(base, '  Title fixes  ', 2);
  assert.equal(byAgent.title, 'Title fixes', 'trimmed');
  assert.equal(byAgent.titledBy, 'agent');
  assert.equal(titleThread(byAgent, 'Something else', 3).title, 'Something else', 'the agent may still retitle its own');
  // agent first, then the person: the person wins.
  const renamed = renameThread(byAgent, 'Hero copy', 4);
  assert.equal(renamed.title, 'Hero copy');
  assert.equal(renamed.titledBy, 'user');
  assert.equal(titleThread(renamed, 'Agent guess', 5), renamed, 'an agent title never overwrites the person\'s');
  // the person first, then the agent: the person still wins.
  const userFirst = renameThread(base, 'Mine', 4);
  assert.equal(titleThread(userFirst, 'Agent guess', 5), userFirst);
  // Clearing a name drops the credit with it, so the agent may name it again.
  const cleared = renameThread(renamed, '', 6);
  assert.equal(cleared.title, '');
  assert.equal(cleared.titledBy, null);
  assert.equal(titleThread(cleared, 'Agent guess', 7).titledBy, 'agent');
  assert.equal(titleThread(base, '   ', 7), base, 'an empty agent title is not a change');
  assert.equal(titleThread(byAgent, 'x'.repeat(200), 7).title.length, 60, 'capped like a rename');
}

// ---- a pre-2026-09-06 record: one chat about one node becomes a chat with one tag ----
{
  const canvas = { id: 'old1', project: 'p', kind: 'canvas', artifactId: null, title: '', messages: [], events: [], seq: 0, turns: 2 };
  const mig = migrateThread(canvas);
  assert.deepEqual(mig.tags, [], 'a canvas thread was about the board: no tags');
  assert.equal('kind' in mig, false, 'the old fields are dropped');
  assert.equal('artifactId' in mig, false);
  assert.equal(mig.titledBy, null);
  assert.equal(mig.lastVersion, null);
  assert.equal(mig.turns, 2, 'everything else survives');

  const artifact = { id: 'old2', project: 'p', kind: 'artifact', artifactId: 'a-7', title: 'Hero copy', messages: [], events: [], seq: 0, turns: 1 };
  const mig2 = migrateThread(artifact);
  assert.deepEqual(mig2.tags, ['a-7'], 'the node it was bound to becomes its one tag');
  assert.equal(mig2.titledBy, 'user', 'a title on an old record can only have been typed: the agent could not write one');
  const unbound = migrateThread({ id: 'old3', project: 'p', kind: 'artifact', artifactId: null, title: '', messages: [], events: [], seq: 0 });
  assert.deepEqual(unbound.tags, [], 'an artifact thread whose node was never created');
  // Already migrated, or absent: left exactly alone.
  const fresh = newThread({ id: 'new1', project: 'p', provider: 'claude', tags: ['x'], now: 1 });
  assert.equal(migrateThread(fresh), fresh, 'a current record is not copied');
  assert.equal(migrateThread(null), null);
}

// ---- model and effort for the next turn: each optional, '' resets, refused mid-turn ----
{
  const base = newThread({ id: 'ts', project: 'p', provider: 'claude', model: '', now: 1 });
  const set = applySettings(base, { model: 'claude-opus-5', effort: 'high' }, 7);
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
assert.deepEqual(Object.keys(s).sort(), ['createdAt', 'effort', 'id', 'mode', 'model', 'preview', 'provider', 'status', 'tags', 'title', 'titledBy', 'turns', 'updatedAt', 'waiting']);
assert.equal(s.preview, 'What is on the canvas?', 'the first user message previews the thread');
assert.equal(s.title, '', 'an unnamed thread has no title, however much was said in it');
assert.equal(threadSummary(t0).preview, '');

// ---- renaming ----
const named = renameThread(t5, '  Hero copy  ', 3000);
assert.equal(named.title, 'Hero copy', 'the name is trimmed');
assert.equal(threadSummary(named).title, 'Hero copy');
assert.equal(threadSummary(named).preview, 'What is on the canvas?', 'a name does not replace the preview');
assert.equal(named.titledBy, 'user');
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

// ---- findChatFor: the chat a composer message continues ----
{
  const dir = path.join(root, 'continue');
  const chat = (id, tags, status = 'idle', at = 100) => writeThread(dir, {
    ...newThread({ id, project: 'p', provider: 'claude', tags, now: at }),
    status,
    updatedAt: at,
  });
  await chat('untagged-old', [], 'idle', 100);
  await chat('ab', ['m1', 'm2'], 'idle', 200);
  await chat('a', ['m1'], 'idle', 300);
  await chat('untagged-new', [], 'idle', 400);
  await chat('abc-running', ['m1', 'm2', 'm3'], 'running', 500);

  // All-of, not any-of: a chat about m1 alone must not answer a message about m1 AND m2,
  // or it would carry over an answer that never saw m2.
  assert.equal((await findChatFor(dir, ['m1', 'm2']))?.id, 'ab');
  assert.equal((await findChatFor(dir, ['m1']))?.id, 'a', 'the newest whose tags include m1');
  assert.equal(await findChatFor(dir, ['m9']), null, 'nothing tagged with it: start one');
  // A superset matches: a chat that has touched m1, m2 and m3 is about m1 and m2 too --
  // but this one is mid-turn, so it is not offered.
  assert.equal((await findChatFor(dir, ['m3'])), null, 'a running chat is never continued');
  // Nothing selected continues the newest idle UNTAGGED chat, not whichever is newest.
  assert.equal((await findChatFor(dir, []))?.id, 'untagged-new');
  assert.equal((await findChatFor(dir))?.id, 'untagged-new', 'no argument is the same as none selected');
  assert.equal(await findChatFor(path.join(root, 'no-such'), ['m1']), null);
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

// ---- the runtime mode ----
{
  const t = newThread({ id: 'm1', project: 'p', provider: 'claude', now: 1 });
  assert.equal(t.mode, 'auto', 'a chat starts in the default mode');
  assert.equal(newThread({ id: 'm2', project: 'p', provider: 'claude', mode: 'plan' }).mode, 'plan');
  assert.throws(() => newThread({ id: 'm3', project: 'p', provider: 'claude', mode: 'yolo' }), /unknown mode/);

  const planned = setMode(t, 'plan', 5);
  assert.equal(planned.mode, 'plan');
  assert.equal(planned.updatedAt, 5);
  assert.equal(setMode(planned, 'plan', 9), planned, 'setting the mode it already has changes nothing');
  assert.throws(() => setMode(t, 'nonsense'), /Mode must be one of/);
  // Unlike the model, it may change mid-turn: the running session only sets the floor.
  const running = setStatus(t, 'running', {}, 2);
  assert.equal(setMode(running, 'plan', 5).mode, 'plan');
  assert.throws(() => applySettings(running, { model: 'x' }), /A turn is running/);
  assert.equal(threadSummary(planned).mode, 'plan', 'the strip can see it');
  // A record written before runtime modes existed ran with no general tools at all.
  assert.equal(migrateThread({ id: 'old', tags: [], status: 'idle' }).mode, 'auto');
}

// ---- a permission request lives on the thread, not in the session ----
{
  const base = setStatus(newThread({ id: 'p1', project: 'p', provider: 'claude', now: 1 }), 'running', {}, 2);
  assert.equal(base.pending, null);
  assert.deepEqual(base.grants, []);

  const asking = askPermission(base, { id: 'r1', tool: 'Bash', signature: 'Bash!rm -rf build', target: 'rm -rf build' }, 5);
  assert.equal(asking.pending.id, 'r1');
  assert.equal(asking.pending.turn, base.turns, 'stamped with the turn that is waiting');
  assert.equal(asking.status, 'running', 'a parked turn has not failed and has not finished');
  assert.equal(threadSummary(asking).waiting, true, 'the strip says which chat wants you');
  assert.equal(threadSummary(base).waiting, false);
  // Only one at a time: the agent is blocked on this answer and cannot ask a second.
  assert.throws(() => askPermission(asking, { id: 'r2', tool: 'Read' }), /already waiting/);

  // Once leaves the chat exactly as trusting as it was; always widens it.
  assert.deepEqual(answerPermission(asking, 'r1', 'once', 6).grants, []);
  assert.equal(answerPermission(asking, 'r1', 'once', 6).pending, null);
  assert.deepEqual(answerPermission(asking, 'r1', 'always', 6).grants, ['Bash!rm -rf build']);
  // Granting the same kind twice is still one grant.
  const widened = answerPermission(asking, 'r1', 'always', 6);
  const again = askPermission(widened, { id: 'r2', tool: 'Bash', signature: 'Bash!rm -rf build' }, 7);
  assert.deepEqual(answerPermission(again, 'r2', 'always', 8).grants, ['Bash!rm -rf build']);
  assert.deepEqual(answerPermission(asking, 'r1', 'deny', 6).grants, []);

  // A stale panel answering a question that is no longer the live one is refused.
  assert.throws(() => answerPermission(asking, 'other', 'once'), /no longer the one in flight/);
  assert.throws(() => answerPermission(base, 'r1', 'once'), /not waiting/);
  assert.throws(() => answerPermission(asking, 'r1', 'maybe'), /once, always or deny/);

  // A record written before permissions existed has neither field.
  const old = migrateThread({ id: 'o', tags: [], mode: 'auto', status: 'idle' });
  assert.equal(old.pending, null);
  assert.deepEqual(old.grants, []);
}

// ---- a turn the app was quit on ----
// A session cannot outlive its process, so `running` with no live session has exactly
// one explanation. Reconciling it to `failed` is what makes the chat continuable again:
// the composer skips `running`, not `failed`.
{
  const base = newThread({ id: 'q1', project: 'p', provider: 'claude', now: 1 });
  const running = setStatus(base, 'running', {}, 2);

  const dead = reconcile(running, { live: false }, 3);
  assert.equal(dead.status, 'failed');
  assert.equal(dead.error, QUIT_MID_TURN);
  assert.equal(dead.updatedAt, 3);
  assert.deepEqual(dead.messages, running.messages, 'the transcript is untouched');

  assert.equal(reconcile(running, { live: true }, 3), running, 'a turn actually in flight is left alone');
  assert.equal(reconcile(running, {}, 3), running, 'and so is one whose caller did not say');
  assert.equal(reconcile(base, { live: false }, 3), base, 'idle passes through');
  const failed = setStatus(base, 'failed', { error: 'something else' }, 2);
  assert.equal(reconcile(failed, { live: false }, 3), failed, 'and so does a failure that already has its own reason');

  // A pending request goes with it: the turn parked on that answer died with the process,
  // so a panel offering Allow and Deny would be offering them to nobody.
  const parked = askPermission(running, { id: 'r1', tool: 'Bash', signature: 'Bash:ls' }, 2);
  const cleared = reconcile(parked, { live: false }, 3);
  assert.equal(cleared.status, 'failed');
  assert.equal(cleared.pending, null);
  assert.equal(reconcile(parked, { live: true }, 3).pending.id, 'r1', 'a live one is still waiting for you');
}

// The read path applies it, which is what makes the fix permanent rather than a boot-time
// sweep that a later write could undo.
{
  const dir = path.join(root, 'quit');
  await writeThread(dir, setStatus(newThread({ id: 'q2', project: 'p', provider: 'claude', now: 1 }), 'running', {}, 2));
  assert.equal((await readThread(dir, 'q2')).status, 'running', 'no answer about liveness: left alone');
  assert.equal((await readThread(dir, 'q2', { live: false })).status, 'failed');
  assert.equal((await readThread(dir, 'q2', { live: true })).status, 'running');
  assert.equal((await listThreads(dir, { live: () => false }))[0].status, 'failed');
  assert.equal((await listThreads(dir, { live: (id) => id === 'q2' }))[0].status, 'running');
  // And the record on disk is NOT rewritten: reconciliation is how a thread READS, so a
  // server that starts, reports and stops has changed nothing to be undone.
  assert.equal(JSON.parse(await fs.readFile(threadPath(dir, 'q2'), 'utf8')).status, 'running');
}

await fs.rm(root, { recursive: true, force: true });
console.log('threads.test.js: ok');
