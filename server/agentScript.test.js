// node server/agentScript.test.js  (also runs as part of `npm test`)
//
// The scripted agent (agentScript.js) is what makes the rest of the agent testable
// without spending anyone's quota on a non-deterministic turn. So this test's job is to
// prove the substitution is honest: a scripted turn goes through the REAL Session, the
// REAL tool handlers and the REAL document, and leaves exactly what a model's turn
// would -- the same events, the same record, the same files. If that ever stops being
// true, every assertion made through a script starts lying, which is worse than having
// no script at all.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScript, pickScript } from './agentScript.js';
import { sendToThread, subscribeThread, closeAllSessions } from './agent.js';
import { openDocument, commit, closeDocument, undo } from './document.js';
import * as T from './threads.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures', 'agent');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-agentscript-'));

// ---- loading and choosing a script ----

assert.equal(await loadScript(undefined), null, 'unset: the SDK runs, exactly as in a clone');
assert.equal(await loadScript(''), null);
await assert.rejects(() => loadScript(path.join(root, 'nope.json')), /no such path/);

{
  const dir = await loadScript(FIXTURES);
  assert.deepEqual(dir.scripts.map((s) => s.name).sort(), ['bad-node', 'bulk-edit', 'question', 'stitch', 'title']);
  // A chat picks its fixture from its first message, which is how ONE env var serves a
  // flow that starts several different conversations.
  assert.equal(pickScript(dir, 'make both titles red').name, 'bulk-edit');
  assert.equal(pickScript(dir, 'stitch these in order').name, 'stitch');
  assert.equal(pickScript(dir, 'polish it').name, 'bad-node');
  assert.equal(pickScript(dir, 'name this chat').name, 'title');
  assert.equal(pickScript(dir, 'how many nodes are there?').name, 'question');
  assert.equal(pickScript(dir, 'something nothing matches'), null, 'no fallback: an unmatched message fails loudly');
  // Only the FIRST message chooses; a later turn of the same chat is not re-matched
  // (runScriptedTurn keeps it), which is why a follow-up like this need not match at all.
  assert.equal(pickScript(dir, 'now blue'), null);

  // A single file is one script, and answers any message -- no `when` needed.
  const one = await loadScript(path.join(FIXTURES, 'stitch.json'));
  assert.equal(one.scripts.length, 1);
  assert.equal(pickScript(one, 'anything at all').name, 'stitch');
}

// A malformed script is refused at load, not mid-turn.
{
  const bad = path.join(root, 'bad');
  await fs.mkdir(bad, { recursive: true });
  await fs.writeFile(path.join(bad, 'a.json'), JSON.stringify({ turns: [] }));
  await assert.rejects(() => loadScript(bad), /turns must be a non-empty array/);
  await fs.writeFile(path.join(bad, 'a.json'), JSON.stringify({ turns: [{ tools: [] }] }));
  await assert.rejects(() => loadScript(bad), /needs a text string/);
  await fs.writeFile(path.join(bad, 'a.json'), JSON.stringify({ turns: [{ text: 'hi', tools: [{ input: {} }] }] }));
  await assert.rejects(() => loadScript(bad), /tool call with no name/);
  await fs.rm(bad, { recursive: true, force: true });
}

// ---- a turn, end to end through the real Session ----

const env = { ...process.env, UNFRAMED_TEST_AGENT_SCRIPT: FIXTURES };
const settings = () => ({});
let nProject = 0;

// A project folder with two motions and one image, seeded the way the browser does it:
// real files on disk, real ops in the journal.
async function seed() {
  const dir = path.join(root, `p${++nProject}`);
  await fs.mkdir(dir, { recursive: true });
  const motion = (label) =>
    `<html><body><div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360"><div id="c" class="clip" data-start="0" data-duration="2">${label}</div></div></body></html>`;
  await fs.writeFile(path.join(dir, '1-intro.html'), motion('Intro'));
  await fs.writeFile(path.join(dir, '2-outro.html'), motion('Outro'));
  await fs.writeFile(path.join(dir, '3-hero.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  const doc = await openDocument(dir);
  await commit(
    doc,
    {
      type: 'batch',
      ops: [
        { type: 'addNode', node: { id: 'm1', type: 'motion', position: { x: 0, y: 0 }, width: 480, height: 300, data: { file: '1-intro.html', title: 'Intro' } } },
        { type: 'addNode', node: { id: 'm2', type: 'motion', position: { x: 0, y: 400 }, width: 480, height: 300, data: { file: '2-outro.html', title: 'Outro' } } },
        { type: 'addNode', node: { id: 'i3', type: 'image', position: { x: 600, y: 0 }, data: { file: '3-hero.png', fileName: 'hero.png' } } },
      ],
    },
    { kind: 'session', id: 'seed' },
  );
  return dir;
}

// Send one message and wait for the turn to end, collecting everything the panel would
// have seen. `sendToThread` returns as soon as the turn is queued, so this is the same
// wait a browser does on the event stream.
async function turn(dir, threadId, text, selection = []) {
  const events = [];
  const done = new Promise((resolve, reject) => {
    const off = subscribeThread(threadId, (e) => {
      events.push(e);
      if (e.type === 'result' || e.type === 'error') {
        // `titled` is emitted AFTER `result` (agent.js, nameChat), so the listener stays
        // on through the settle -- which is also what the panel does.
        setTimeout(() => {
          off();
          if (e.type === 'error') reject(new Error(e.message));
          else resolve();
        }, 50);
      }
    });
  });
  await sendToThread(dir, threadId, { text, selection }, { settings, env, previewPort: 0 });
  await done;
  return events;
}

async function newChat(dir, tags = []) {
  const thread = T.newThread({ id: `t${++nProject}-${Math.random().toString(36).slice(2, 6)}`, project: path.basename(dir), provider: 'claude', model: '', tags });
  await T.writeThread(dir, thread);
  return thread.id;
}

// ---- a bulk edit is one journal version, one undo step, and tags the chat ----
{
  const dir = await seed();
  const id = await newChat(dir, ['m1', 'm2']);
  const before = (await openDocument(dir)).version;
  const events = await turn(dir, id, 'make both titles red', ['m1', 'm2', 'i3']);

  // The same events the SDK loop emits, in the same order.
  assert.deepEqual(
    events.map((e) => e.type),
    ['turn', 'session', 'tool_use', 'tool_result', 'tool_use', 'ops_applied', 'tool_result', 'text_delta', 'result', 'titled'],
  );
  const session = events.find((e) => e.type === 'session');
  assert.ok(session.tools.includes('mcp__unframed__canvas_write'), 'the handshake names our tools, prefixed as the SDK reports them');
  assert.deepEqual(
    events.filter((e) => e.type === 'tool_use').map((e) => e.name),
    ['mcp__unframed__canvas_read', 'mcp__unframed__canvas_write'],
  );
  assert.ok(events.filter((e) => e.type === 'tool_result').every((e) => e.ok && e.size > 0));
  assert.equal(events.at(-2).ok, true);

  // Two nodes changed, in ONE version: undoable as one step.
  const doc = await openDocument(dir);
  assert.equal(doc.version, before + 1, 'one batch, one version');
  assert.equal(doc.graph.nodes.find((n) => n.id === 'm1').data.title, 'Intro (red)');
  assert.equal(doc.graph.nodes.find((n) => n.id === 'm2').data.title, 'Outro (red)');
  const applied = events.find((e) => e.type === 'ops_applied');
  assert.equal(applied.version, doc.version);
  assert.equal(applied.opCount, 2);
  assert.equal(doc.entries.at(-1).origin.kind, 'thread', 'committed under the chat, not a tab');
  assert.equal(doc.entries.at(-1).origin.id, id);

  // The record: the answer, an idle status, lastVersion, and the agent's title.
  const rec = await T.readThread(dir, id);
  assert.equal(rec.status, 'idle');
  assert.equal(rec.turns, 1);
  assert.equal(rec.messages.at(-1).role, 'assistant');
  assert.match(rec.messages.at(-1).text, /both titles to red/);
  assert.deepEqual(rec.messages[0].selection, ['m1', 'm2', 'i3']);
  assert.equal(rec.lastVersion, doc.version, 'stamped where the next turn measures from');
  assert.equal(rec.title, 'Title colours');
  assert.equal(rec.titledBy, 'agent');
  assert.equal(events.at(-1).title, 'Title colours');

  // A turn leaves a sidecar, and never a cost: it is on the person's subscription.
  const sidecars = (await fs.readdir(dir)).filter((n) => n.endsWith('-agent.json'));
  assert.equal(sidecars.length, 1);
  const side = JSON.parse(await fs.readFile(path.join(dir, sidecars[0]), 'utf8'));
  assert.equal(side.billing, 'subscription');
  assert.equal(side.cost, undefined);
  assert.equal(side.threadId, id);

  // ---- the person undoes it; the next turn is TOLD, from the agent's own side ----
  // The fixture's turn 2 asserts its preamble, so this passing means the agent really
  // was handed the note -- not that a log line was formatted somewhere.
  await undo(await openDocument(dir), { id: 'tab-1' });
  assert.equal((await openDocument(dir)).graph.nodes.find((n) => n.id === 'm1').data.title, 'Intro');
  const second = await turn(dir, id, 'now blue', ['m1', 'm2']);
  assert.equal(second.filter((e) => e.type === 'result')[0].ok, true);
  assert.equal(second.some((e) => e.type === 'titled'), false, 'a chat is named once, not every turn');
  const after = await openDocument(dir);
  assert.equal(after.graph.nodes.find((n) => n.id === 'm1').data.title, 'Intro (blue)');
  const rec2 = await T.readThread(dir, id);
  assert.equal(rec2.turns, 2);
  assert.equal(rec2.title, 'Title colours', 'still the turn-1 name');
  await closeDocument(dir);
}

// ---- a write to a node that is gone fails, says so, and writes no file ----
{
  const dir = await seed();
  const id = await newChat(dir, ['m1']);
  await commit(await openDocument(dir), { type: 'removeNode', id: 'm1' }, { kind: 'session', id: 'tab' });
  const filesBefore = (await fs.readdir(dir)).length;

  const events = await turn(dir, id, 'polish it', ['m1']);
  const result = events.find((e) => e.type === 'result');
  assert.equal(result.ok, true, 'the TURN did not fail: the agent tried, was refused, and said so');
  assert.match(result.text, /no longer on the canvas/);
  const failed = events.filter((e) => e.type === 'tool_result').at(-1);
  assert.equal(failed.ok, false, 'the tool call is the thing that failed');
  assert.equal(events.some((e) => e.type === 'ops_applied'), false, 'nothing was committed');

  // No new motion file, and no library either: the write never got that far.
  const names = await fs.readdir(dir);
  assert.equal(names.filter((n) => n.endsWith('.html')).length, 2, 'the two seeded compositions, nothing new');
  assert.ok(names.length >= filesBefore);
  const rec = await T.readThread(dir, id);
  assert.equal(rec.status, 'idle', 'the chat is usable again');
  // The tag stays: a chat outlives the artifact it touched (decision 1).
  assert.deepEqual(rec.tags, ['m1']);
  await closeDocument(dir);
}

// ---- a question: no tools beyond reading, nothing changed ----
{
  const dir = await seed();
  const id = await newChat(dir);
  const before = (await openDocument(dir)).version;
  const events = await turn(dir, id, 'what is on the canvas?', []);
  assert.deepEqual(
    events.map((e) => e.type),
    ['turn', 'session', 'tool_use', 'tool_result', 'text_delta', 'result', 'titled'],
  );
  assert.equal((await openDocument(dir)).version, before, 'a question changes nothing');
  const rec = await T.readThread(dir, id);
  assert.deepEqual(rec.tags, [], 'reading an artifact is not touching one');
  await closeDocument(dir);
}

// ---- stitching: two motions read, ONE new motion node created beside them ----
{
  const dir = await seed();
  const id = await newChat(dir, ['m1', 'm2']);
  const events = await turn(dir, id, 'stitch these in order', ['m1', 'm2']);

  const applied = events.find((e) => e.type === 'ops_applied');
  assert.equal(applied.page.created, true);
  assert.equal(applied.page.kind, 'motion');
  assert.equal(applied.page.title, 'Sequence');

  const doc = await openDocument(dir);
  const motions = doc.graph.nodes.filter((n) => n.type === 'motion');
  assert.equal(motions.length, 3, 'a third motion, beside the two; the originals are untouched');
  assert.equal(doc.graph.nodes.find((n) => n.id === 'm1').data.file, '1-intro.html', 'the original still names its own file');
  const made = motions.find((n) => !['m1', 'm2'].includes(n.id));
  assert.equal(made.id, applied.page.nodeId);
  // Placed to the right of the selection's bounding box.
  assert.ok(made.position.x > 480, `placed beside the selection, not on top of it (x=${made.position.x})`);

  // The file is real, carries the runtime tag, and has a sidecar of its own.
  const html = await fs.readFile(path.join(dir, made.data.file), 'utf8');
  assert.match(html, /data-hyperframes-preview-runtime/, 'withRuntime ran: the composition can be previewed');
  assert.match(html, /Intro[\s\S]*Outro/, 'both clips, in order');
  const side = JSON.parse(await fs.readFile(path.join(dir, made.data.file.replace(/\.html$/, '.json')), 'utf8'));
  assert.equal(side.source, 'agent');
  assert.equal(side.kind, 'motion');
  // The motion library landed beside it, or the composition could not play.
  const names = await fs.readdir(dir);
  assert.ok(names.includes('hyperframes-viewer.html') && names.includes('gsap.js'), 'the player and GSAP are beside it');

  // The chat is now tagged with what it MADE as well as what it read.
  const rec = await T.readThread(dir, id);
  assert.deepEqual(rec.tags, ['m1', 'm2', made.id]);
  await closeDocument(dir);
}

// ---- the agent's title never overwrites the person's ----
{
  const dir = await seed();
  const id = await newChat(dir);
  await T.persistThread(dir, id, (cur) => T.renameThread(cur, 'Mine', Date.now()));
  const events = await turn(dir, id, 'name this chat', []);
  assert.equal(events.some((e) => e.type === 'titled'), false, 'no title event: there was nothing to name');
  const rec = await T.readThread(dir, id);
  assert.equal(rec.title, 'Mine');
  assert.equal(rec.titledBy, 'user');

  // And on a chat nobody has named, the script's title is taken and trimmed.
  const id2 = await newChat(dir);
  await turn(dir, id2, 'name this chat', []);
  const rec2 = await T.readThread(dir, id2);
  assert.equal(rec2.title, 'A named conversation');
  assert.equal(rec2.titledBy, 'agent');
  await closeDocument(dir);
}

// ---- a script that runs out of turns fails the turn loudly, not silently ----
{
  const dir = await seed();
  const id = await newChat(dir);
  await turn(dir, id, 'how many nodes are there?', []);
  await assert.rejects(() => turn(dir, id, 'and again?', []), /turn\(s\); the chat is on turn 2/);
  const rec = await T.readThread(dir, id);
  assert.equal(rec.status, 'failed');
  await closeDocument(dir);
}

closeAllSessions();
await fs.rm(root, { recursive: true, force: true });
console.log('agentScript.test.js: ok');
