// node server/agentFlow.test.js  (also runs as part of `npm test`)
//
// The acceptance test for chats-with-tags. It forks the REAL server (the host.test.js
// harness: a throwaway data dir, an ephemeral port) and drives it through the same
// routes the browser uses, with UNFRAMED_TEST_AGENT_SCRIPT standing in for the model
// (agentScript.js). Nothing else is stubbed: real ops, a real journal, real files, real
// tags, real undo.
//
// It exists because every claim worth making about this feature is a claim about several
// parts agreeing -- that a bulk edit is ONE undo step, that a tag survives deleting the
// node it names, that the next turn is told about an undo of its own change, that
// stitching adds a node beside the originals and tags the chat with it. A unit test of
// any one part cannot see those, and a real turn can see them only once, expensively,
// and never the same way twice.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-agentflow-'));
const outDir = path.join(dataDir, 'out');
const distDir = path.join(dataDir, 'dist');
await fs.mkdir(outDir);
await fs.mkdir(distDir);
await fs.writeFile(path.join(distDir, 'index.html'), '<title>canvas</title>');

const child = fork(path.join(here, 'index.js'), {
  env: {
    ...process.env,
    UNFRAMED_DATA_DIR: dataDir,
    UNFRAMED_CLIENT_DIST: distDir,
    OUTPUT_DIR: outDir,
    PORT: '0',
    // The whole point: turns come from the fixtures, so this file spends nothing and
    // asserts the same thing every run. Unset in a clone, where the SDK runs instead.
    UNFRAMED_TEST_AGENT_SCRIPT: path.join(here, 'fixtures', 'agent'),
  },
  stdio: 'ignore',
});

const waitFor = (type, ms = 10000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${type} message within ${ms}ms`)), ms);
    child.on('message', (m) => {
      if (m?.type === type) {
        clearTimeout(timer);
        resolve(m);
      }
    });
  });

// Bounded, for the reason host.test.js states: a suite that runs in CI must fail loudly
// rather than hang with no output pointing at the cause.
const withDeadline = (promise, ms, message) => {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
};

try {
  const ready = await waitFor('ready');
  const base = `http://127.0.0.1:${ready.port}`;
  const PROJECT = 'flow';
  const docBase = `${base}/api/projects/${PROJECT}`;
  const tBase = `${docBase}/threads`;

  const call = async (method, url, body) => {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const get = (url) => call('GET', url);
  const graph = async () => (await get(docBase)).body;
  const thread = async (id) => (await get(`${tBase}/${id}`)).body.thread;
  const threads = async (q = '') => (await get(`${tBase}${q}`)).body.threads;

  // A turn is queued, not awaited, by POST /messages -- exactly as it is for a real
  // model. So this waits the way the panel does: until the record is idle again.
  //
  // `titled` is the one thing that lands AFTER the turn goes idle, and deliberately so:
  // naming a chat is its own request on the person's plan (agent.js, askForTitle), and
  // the reply must not wait behind it. So a test that wants the name has to say so --
  // polling only for `idle` and then reading the title would pass or fail on timing.
  const runTurn = async (id, text, selection = [], { titled = false } = {}) => {
    const sent = await call('POST', `${tBase}/${id}/messages`, { text, selection });
    assert.equal(sent.status, 200, `POST messages: ${JSON.stringify(sent.body)}`);
    const settle = async (test, ms, message) =>
      withDeadline(
        (async () => {
          for (;;) {
            const rec = await thread(id);
            if (test(rec)) return rec;
            await new Promise((r) => setTimeout(r, 20));
          }
        })(),
        ms,
        message,
      );
    const done = await settle((r) => r.status !== 'running', 15000, `the turn on ${id} never finished`);
    if (!titled) return done;
    return settle((r) => r.events.some((e) => e.type === 'titled'), 5000, `the chat ${id} was never named`);
  };

  // ---- 1. a project with two motions and one image ----
  const motion = (label) =>
    `<html><body><div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360"><div id="c" class="clip" data-start="0" data-duration="2">${label}</div></div></body></html>`;
  const upload = async (name, body, type) => {
    const res = await fetch(`${docBase}/files?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body,
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(res.status, 200, `upload ${name}`);
    return (await res.json()).file;
  };
  assert.equal((await call('POST', docBase, {})).status, 200, 'the project is created');
  const introFile = await upload('intro.html', motion('Intro'), 'text/html');
  const outroFile = await upload('outro.html', motion('Outro'), 'text/html');
  const heroFile = await upload('hero.png', Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png');
  const seeded = await call('POST', `${docBase}/ops`, {
    origin: { id: 'tab-1' },
    ops: [
      { type: 'addNode', node: { id: 'm1', type: 'motion', position: { x: 0, y: 0 }, width: 480, height: 300, data: { file: introFile, title: 'Intro' } } },
      { type: 'addNode', node: { id: 'm2', type: 'motion', position: { x: 0, y: 400 }, width: 480, height: 300, data: { file: outroFile, title: 'Outro' } } },
      { type: 'addNode', node: { id: 'i3', type: 'image', position: { x: 600, y: 0 }, data: { file: heroFile, fileName: 'hero.png' } } },
    ],
  });
  assert.equal(seeded.status, 200);
  assert.equal(seeded.body.rejected.length, 0, JSON.stringify(seeded.body.rejected));
  assert.deepEqual((await graph()).nodes.map((n) => n.id), ['m1', 'm2', 'i3']);

  // ---- 2. a chat about both motions: one bulk edit, one version, one name ----
  const made = await call('POST', tBase, { provider: 'claude', tags: ['m1', 'm2'] });
  assert.equal(made.status, 200);
  const chat = made.body.thread.id;
  const beforeEdit = (await graph()).version;

  const rec = await runTurn(chat, 'make both titles red', ['m1', 'm2', 'i3'], { titled: true });
  assert.equal(rec.status, 'idle');
  assert.equal(rec.turns, 1);
  assert.match(rec.messages.at(-1).text, /both titles to red/);
  // Both nodes changed, in ONE journal version: that is what makes it one undo step.
  const afterEdit = await graph();
  assert.equal(afterEdit.version, beforeEdit + 1, 'one batch, one version');
  assert.equal(afterEdit.nodes.find((n) => n.id === 'm1').data.title, 'Intro (red)');
  assert.equal(afterEdit.nodes.find((n) => n.id === 'm2').data.title, 'Outro (red)');
  // The chat is tagged with both motions and NOT with the image: an artifact is a page
  // or a motion, and the server decides that from the document, not from the browser.
  assert.deepEqual(rec.tags, ['m1', 'm2']);
  assert.equal(rec.title, 'Title colours', 'the agent named the chat');
  assert.equal(rec.titledBy, 'agent');
  assert.equal(rec.lastVersion, afterEdit.version, 'where the next turn measures from');

  // ---- 3. listing by tag ----
  assert.deepEqual((await threads('?tag=m1')).map((t) => t.id), [chat]);
  assert.deepEqual((await threads('?tag=m2')).map((t) => t.id), [chat]);
  assert.equal((await threads('?tag=i3')).length, 0, 'the image was context, not something touched');
  assert.equal((await threads('?tag=m9')).length, 0);
  assert.equal((await threads()).length, 1, 'unfiltered lists everything');

  // ---- 4. the person undoes it; the next turn is told, and the agent asserts it ----
  const undone = await call('POST', `${docBase}/undo`, { origin: { id: 'tab-1' } });
  assert.equal(undone.status, 200);
  assert.equal((await graph()).nodes.find((n) => n.id === 'm1').data.title, 'Intro', 'one undo, both nodes back');
  assert.equal((await graph()).nodes.find((n) => n.id === 'm2').data.title, 'Outro');

  // The fixture's turn 2 carries `expectPreamble: "Since your last turn the canvas
  // changed"`, so if the note were missing the turn would FAIL rather than quietly
  // pass. This asserts the contract from the agent's own side.
  const rec2 = await runTurn(chat, 'now blue', ['m1', 'm2']);
  assert.equal(rec2.status, 'idle', `turn 2 failed: ${rec2.error ?? ''}`);
  assert.equal(rec2.turns, 2);
  assert.equal((await graph()).nodes.find((n) => n.id === 'm1').data.title, 'Intro (blue)');
  assert.equal(rec2.title, 'Title colours', 'a chat is named once, not every turn');
  assert.equal(rec2.events.filter((e) => e.type === 'titled').length, 1);

  // ---- 5. deleting a tagged node leaves the chat and its tag alone ----
  const removed = await call('POST', `${docBase}/ops`, { origin: { id: 'tab-1' }, ops: [{ type: 'removeNode', id: 'm1' }] });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.rejected.length, 0);
  assert.equal((await graph()).nodes.some((n) => n.id === 'm1'), false);
  const survivor = await thread(chat);
  assert.deepEqual(survivor.tags, ['m1', 'm2'], 'a tag is a pointer: it goes stale, it does not vanish');
  assert.equal(survivor.turns, 2, 'and the transcript is untouched');
  assert.deepEqual((await threads('?tag=m1')).map((t) => t.id), [chat], 'still listed under the id it touched');

  // ---- 6. a turn that writes to the deleted node fails politely, and writes nothing ----
  const htmlBefore = (await fs.readdir(path.join(outDir, PROJECT))).filter((n) => n.endsWith('.html'));
  const orphan = (await call('POST', tBase, { provider: 'claude', tags: ['m1'] })).body.thread.id;
  const failedWrite = await runTurn(orphan, 'polish it', ['m1']);
  assert.equal(failedWrite.status, 'idle', 'the agent was refused; the CHAT did not break');
  assert.match(failedWrite.messages.at(-1).text, /no longer on the canvas/);
  assert.equal(failedWrite.events.some((e) => e.type === 'ops_applied'), false, 'nothing was committed');
  assert.equal(failedWrite.events.filter((e) => e.type === 'tool_result').at(-1).ok, false);
  assert.deepEqual(
    (await fs.readdir(path.join(outDir, PROJECT))).filter((n) => n.endsWith('.html')),
    htmlBefore,
    'and no file was written',
  );

  // ---- 7. stitching: one new motion beside the two, and a third tag ----
  const stitcher = (await call('POST', tBase, { provider: 'claude', tags: ['m2'] })).body.thread.id;
  const before = await graph();
  const stitched = await runTurn(stitcher, 'stitch these in order', ['m2', 'i3'], { titled: true });
  assert.equal(stitched.status, 'idle', `stitch failed: ${stitched.error ?? ''}`);

  const applied = stitched.events.filter((e) => e.type === 'ops_applied');
  assert.equal(applied.length, 1, 'one change');
  assert.equal(applied[0].page.created, true);
  assert.equal(applied[0].page.kind, 'motion');
  const after = await graph();
  assert.equal(after.nodes.length, before.nodes.length + 1, 'one node added, none replaced');
  const newId = applied[0].page.nodeId;
  const madeNode = after.nodes.find((n) => n.id === newId);
  assert.equal(madeNode.type, 'motion');
  assert.equal(madeNode.data.title, 'Sequence');
  // The originals are untouched: a new asset from several is made of copies.
  assert.equal(after.nodes.find((n) => n.id === 'm2').data.file, outroFile);
  // Tagged with what it read AND what it made.
  assert.deepEqual(stitched.tags, ['m2', newId]);
  assert.deepEqual((await threads(`?tag=${newId}`)).map((t) => t.id), [stitcher]);
  // Any-of when repeated: the strip's rule with several artifacts selected.
  const anyOf = (await threads(`?tag=m2&tag=${newId}`)).map((t) => t.id).sort();
  assert.deepEqual(anyOf, [chat, stitcher].sort());

  // The file is real, previewable, and has its own sidecar.
  const html = await fs.readFile(path.join(outDir, PROJECT, madeNode.data.file), 'utf8');
  assert.match(html, /data-hyperframes-preview-runtime/, 'the runtime tag: it can actually play');
  const side = JSON.parse(await fs.readFile(path.join(outDir, PROJECT, madeNode.data.file.replace(/\.html$/, '.json')), 'utf8'));
  assert.equal(side.source, 'agent');
  assert.equal(side.kind, 'motion');

  // ---- 8. UPDATING an artifact tags the chat too, not only creating one ----
  // This is the case the old `bindArtifact` got wrong -- it bound a thread once, when
  // the agent CREATED a node -- so a chat that spent ten turns rewriting an existing
  // page ended up tagged with nothing. The selection is deliberately empty here, so the
  // only thing that can produce the tag is the write itself.
  const reviser = (await call('POST', tBase, { provider: 'claude' })).body.thread.id;
  const nodesBefore = (await graph()).nodes.length;
  const oldFile = (await graph()).nodes.find((n) => n.id === 'm2').data.file;
  const revised = await runTurn(reviser, 'revise the outro', [], { titled: true });
  assert.equal(revised.status, 'idle', `revise failed: ${revised.error ?? ''}`);
  assert.deepEqual(revised.tags, ['m2'], 'tagged by writing to it, with nothing selected at all');
  const revision = revised.events.filter((e) => e.type === 'ops_applied');
  assert.equal(revision.length, 1);
  assert.equal(revision[0].page.created, false, 'an update, not a creation');
  const m2After = (await graph()).nodes.find((n) => n.id === 'm2');
  assert.equal((await graph()).nodes.length, nodesBefore, 'no node added: the same motion, a new version');
  assert.notEqual(m2After.data.file, oldFile, 'every write is a new file, so the previous version survives to undo to');
  assert.equal(m2After.data.title, 'Outro, revised');
  assert.ok(await fs.readFile(path.join(outDir, PROJECT, oldFile), 'utf8'), 'and the old file is still on disk');
  // Three chats now point at m2 -- one tagged at creation, one that stitched from it,
  // one that rewrote it -- and the strip would show all three when it is selected.
  assert.deepEqual((await threads('?tag=m2')).map((t) => t.id).sort(), [chat, stitcher, reviser].sort());

  // Every turn left a subscription sidecar, and never a cost.
  const sidecars = (await fs.readdir(path.join(outDir, PROJECT))).filter((n) => n.endsWith('-agent.json'));
  assert.equal(sidecars.length, 5, 'five turns, five sidecars');
  for (const name of sidecars) {
    const body = JSON.parse(await fs.readFile(path.join(outDir, PROJECT, name), 'utf8'));
    assert.equal(body.billing, 'subscription');
    assert.equal(body.cost, undefined, 'a zero here would corrupt the spend sums');
  }

  console.log('agentFlow.test.js: ok');
} finally {
  child.kill();
  await fs.rm(dataDir, { recursive: true, force: true });
}
