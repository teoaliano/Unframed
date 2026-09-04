// node server/document.test.js  (also runs as part of `npm test`)
//
// The document's I/O half: a project's graph lives as an append-only journal plus a
// snapshot, commits are serialised per project, and a reopen -- after a clean close or
// after a crash mid-write -- lands on exactly the graph the last accepted commit left.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  openDocument,
  closeDocument,
  commit,
  snapshot,
  subscribe,
  undo,
  redo,
  journalPath,
  snapshotPath,
} from './document.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-document-test-'));
const fresh = (name) => path.join(root, name);
const node = (id) => ({ id, type: 'prompt', position: { x: 0, y: 0 }, data: { text: id } });
const origin = { kind: 'session', id: 'test' };

// ---- an empty folder opens as an empty document, and writes nothing until a commit ----
{
  const dir = fresh('empty');
  const doc = await openDocument(dir);
  assert.equal(doc.version, 0);
  assert.deepEqual(doc.graph, { nodes: [], edges: [] });
  await assert.rejects(fs.access(journalPath(dir)), 'no journal until something is committed');
  await closeDocument(dir);
}

// ---- commits append to the journal, bump the version, and survive a reopen ----
{
  const dir = fresh('basic');
  let doc = await openDocument(dir);
  const a = await commit(doc, { type: 'addNode', node: node('1') }, origin);
  assert.equal(a.version, 1);
  assert.equal(a.origin, origin);
  assert.deepEqual(a.inverse, { type: 'removeNode', id: '1' });
  assert.ok(typeof a.at === 'number');
  const b = await commit(doc, { type: 'moveNode', id: '1', position: { x: 5, y: 5 } }, origin);
  assert.equal(b.version, 2);
  assert.equal(doc.version, 2);
  const lines = (await fs.readFile(journalPath(dir), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).version, 2);
  // A rejected op changes nothing: no version, no line.
  const r = await commit(doc, { type: 'moveNode', id: 'ghost', position: { x: 0, y: 0 } }, origin);
  assert.match(r.rejected, /no node/);
  assert.equal(doc.version, 2);
  assert.equal((await fs.readFile(journalPath(dir), 'utf8')).trim().split('\n').length, 2);

  await closeDocument(dir);
  doc = await openDocument(dir);
  assert.equal(doc.version, 2);
  assert.deepEqual(doc.graph.nodes[0].position, { x: 5, y: 5 });
  // The journal is kept in memory too -- undo walks it (see undo tests below).
  assert.equal(doc.entries.length, 2);
  await closeDocument(dir);
}

// ---- a snapshot is a fast start, not the truth: replay continues past it ----
{
  const dir = fresh('snap');
  let doc = await openDocument(dir);
  await commit(doc, { type: 'addNode', node: node('1') }, origin);
  await commit(doc, { type: 'addNode', node: node('2') }, origin);
  await snapshot(doc);
  const snap = JSON.parse(await fs.readFile(snapshotPath(dir), 'utf8'));
  assert.equal(snap.version, 2);
  assert.equal(snap.nodes.length, 2);
  await commit(doc, { type: 'addNode', node: node('3') }, origin);
  await closeDocument(dir);
  doc = await openDocument(dir);
  assert.equal(doc.version, 3);
  assert.deepEqual(doc.graph.nodes.map((n) => n.id), ['1', '2', '3']);
  // Closing snapshots, so the next open needs no replay at all -- but still reads right.
  const closedSnap = JSON.parse(await fs.readFile(snapshotPath(dir), 'utf8'));
  assert.equal(closedSnap.version, 3);
  await closeDocument(dir);
}

// ---- a legacy graph.json (no version, no journal) is the version-0 base ----
{
  const dir = fresh('legacy');
  await fs.mkdir(dir);
  await fs.writeFile(snapshotPath(dir), JSON.stringify({ nodes: [node('old')], edges: [] }));
  let doc = await openDocument(dir);
  assert.equal(doc.version, 0);
  assert.deepEqual(doc.graph.nodes.map((n) => n.id), ['old']);
  await commit(doc, { type: 'addNode', node: node('new') }, origin);
  await closeDocument(dir);
  doc = await openDocument(dir);
  assert.deepEqual(doc.graph.nodes.map((n) => n.id), ['old', 'new']);
  assert.equal(doc.version, 1);
  await closeDocument(dir);
}

// ---- an older server overwrote the snapshot after the journal started ----
{
  const dir = fresh('mixed');
  let doc = await openDocument(dir);
  await commit(doc, { type: 'addNode', node: node('1') }, origin);
  await commit(doc, { type: 'addNode', node: node('2') }, origin);
  await closeDocument(dir);
  // An old autosave: the whole graph, no version, written on top of our snapshot.
  await fs.writeFile(snapshotPath(dir), JSON.stringify({ nodes: [node('1'), node('2'), node('3')], edges: [] }));
  doc = await openDocument(dir);
  assert.deepEqual(doc.graph.nodes.map((n) => n.id), ['1', '2', '3'], 'the old server\'s snapshot is the truth');
  assert.equal(doc.version, 0, 'and the journal was not replayed on top of it');
  const files = await fs.readdir(dir);
  assert.ok(files.some((f) => f.startsWith('graph.log.stale-')), 'the journal is set aside, not deleted');
  await commit(doc, { type: 'addNode', node: node('4') }, origin);
  await closeDocument(dir);
  doc = await openDocument(dir);
  assert.deepEqual(doc.graph.nodes.map((n) => n.id), ['1', '2', '3', '4']);
  await closeDocument(dir);
}

// ---- crash safety: a torn last journal line and a leftover snapshot temp file ----
{
  const dir = fresh('torn');
  let doc = await openDocument(dir);
  await commit(doc, { type: 'addNode', node: node('1') }, origin);
  await commit(doc, { type: 'addNode', node: node('2') }, origin);
  await closeDocument(dir);
  // A process died mid-append: the last line is half a JSON object.
  await fs.appendFile(journalPath(dir), '{"version":3,"op":{"type":"addNo');
  // And mid-snapshot: a temp file next to the real one.
  await fs.writeFile(`${snapshotPath(dir)}.123-456.tmp`, '{"version":9,"nodes":[');
  doc = await openDocument(dir);
  assert.equal(doc.version, 2, 'the torn line is not a commit');
  assert.deepEqual(doc.graph.nodes.map((n) => n.id), ['1', '2']);
  // The next commit takes version 3 and the journal is whole again.
  await commit(doc, { type: 'addNode', node: node('3') }, origin);
  await closeDocument(dir);
  doc = await openDocument(dir);
  assert.equal(doc.version, 3);
  await closeDocument(dir);
}

// ---- an unreadable snapshot is rebuilt from the journal, which is never truncated ----
{
  const dir = fresh('rebuild');
  let doc = await openDocument(dir);
  await commit(doc, { type: 'addNode', node: node('1') }, origin);
  await commit(doc, { type: 'addNode', node: node('2') }, origin);
  await closeDocument(dir); // writes a v2 snapshot
  await fs.writeFile(snapshotPath(dir), '{"version": 2, "nodes": [ TRUNC');
  doc = await openDocument(dir);
  assert.equal(doc.version, 2);
  assert.deepEqual(doc.graph.nodes.map((n) => n.id), ['1', '2']);
  await closeDocument(dir);
}

// ---- commits are serialised: concurrent callers get distinct, ordered versions ----
{
  const dir = fresh('serial');
  const doc = await openDocument(dir);
  const results = await Promise.all(
    Array.from({ length: 25 }, (_, i) => commit(doc, { type: 'addNode', node: node(String(i)) }, origin)),
  );
  assert.deepEqual(results.map((r) => r.version), Array.from({ length: 25 }, (_, i) => i + 1));
  const lines = (await fs.readFile(journalPath(dir), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 25);
  assert.deepEqual(lines.map((l) => JSON.parse(l).version), results.map((r) => r.version));
  await closeDocument(dir);
}

// ---- subscribers see every accepted entry, and unsubscribe stops them ----
{
  const dir = fresh('subs');
  const doc = await openDocument(dir);
  const seen = [];
  const off = subscribe(doc, (entry) => seen.push(entry.version));
  await commit(doc, { type: 'addNode', node: node('1') }, origin);
  await commit(doc, { type: 'moveNode', id: 'ghost', position: { x: 0, y: 0 } }, origin); // rejected
  await commit(doc, { type: 'addNode', node: node('2') }, origin);
  off();
  await commit(doc, { type: 'addNode', node: node('3') }, origin);
  assert.deepEqual(seen, [1, 2]);
  await closeDocument(dir);
}

// ---- openDocument is idempotent while a document is open ----
{
  const dir = fresh('same');
  const a = await openDocument(dir);
  const b = await openDocument(dir);
  assert.equal(a, b, 'one in-memory document per folder');
  await closeDocument(dir);
}

// ---- undo / redo walk the journal ----
{
  const dir = fresh('undo');
  let doc = await openDocument(dir);
  const ids = (d) => d.graph.nodes.map((n) => n.id);
  await commit(doc, { type: 'addNode', node: node('1') }, origin); // v1
  await commit(doc, { type: 'addNode', node: node('2') }, origin); // v2
  await commit(doc, { type: 'moveNode', id: '1', position: { x: 9, y: 9 } }, origin); // v3

  const u1 = await undo(doc); // reverts v3
  assert.equal(u1.undoes, 3);
  assert.equal(u1.origin.kind, 'undo');
  assert.deepEqual(doc.graph.nodes[0].position, { x: 0, y: 0 });
  const u2 = await undo(doc); // reverts v2
  assert.equal(u2.undoes, 2);
  assert.deepEqual(ids(doc), ['1']);

  const r1 = await redo(doc); // re-applies v2
  assert.equal(r1.redoes, u2.version);
  assert.deepEqual(ids(doc), ['1', '2']);
  // Undoing a redo undoes the same thing again.
  const u3 = await undo(doc);
  assert.equal(u3.undoes, r1.version);
  assert.deepEqual(ids(doc), ['1']);
  await redo(doc); // back to ['1','2']
  assert.deepEqual(ids(doc), ['1', '2']);

  // A fresh op after an undo drops the redo branch.
  await undo(doc); // ['1']
  await commit(doc, { type: 'addNode', node: node('3') }, origin);
  assert.equal(await redo(doc), null);
  assert.deepEqual(ids(doc), ['1', '3']);

  // Undo all the way down, then one more is a no-op, not an error.
  await undo(doc);
  await undo(doc);
  assert.deepEqual(ids(doc), []);
  assert.equal(await undo(doc), null);

  // The pointer is derived from the journal, so a reopen keeps the redo branch.
  await closeDocument(dir);
  doc = await openDocument(dir);
  assert.deepEqual(ids(doc), []);
  await redo(doc);
  assert.deepEqual(ids(doc), ['1']);
  await closeDocument(dir);
}

// ---- an agent's batch is one undo step ----
{
  const dir = fresh('undo-batch');
  const doc = await openDocument(dir);
  await commit(doc, { type: 'addNode', node: node('1') }, origin);
  await commit(
    doc,
    {
      type: 'batch',
      ops: [
        { type: 'addNode', node: node('a') },
        { type: 'addNode', node: node('b') },
        { type: 'addEdge', edge: { id: 'e', source: 'a', target: 'b' } },
      ],
    },
    { kind: 'thread', id: 't1' },
  );
  assert.equal(doc.graph.nodes.length, 3);
  await undo(doc);
  assert.deepEqual(doc.graph.nodes.map((n) => n.id), ['1']);
  assert.equal(doc.graph.edges.length, 0);
  await closeDocument(dir);
}

// ---- media leaves the document: on open (legacy graph) and on the way in (an op) ----
{
  const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const dir = fresh('media');
  await fs.mkdir(dir);
  await fs.writeFile(
    snapshotPath(dir),
    JSON.stringify({ nodes: [{ id: 'i', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: PNG_1PX, fileName: 'old.png' } }], edges: [] }),
  );
  let doc = await openDocument(dir);
  // The legacy bytes are on disk as a file and gone from the graph, and the rewrite is a
  // journaled system commit -- version 1, visible to any subscriber like any other change.
  assert.equal(doc.graph.nodes[0].data.dataUrl, undefined);
  assert.match(doc.graph.nodes[0].data.file, /-old\.png$/);
  assert.equal(doc.version, 1);
  assert.equal(doc.entries[0].origin.kind, 'system');
  const bytes = await fs.readFile(path.join(dir, doc.graph.nodes[0].data.file));
  assert.equal(bytes.length, 70);
  // Extraction is not undoable: its inverse would carry the bytes back in.
  assert.equal(doc.entries[0].inverse, null);
  assert.equal(await undo(doc), null);
  // An op that arrives with inline media is rewritten before it is applied or journaled.
  const seen = [];
  subscribe(doc, (e) => seen.push(e));
  const entry = await commit(
    doc,
    { type: 'addNode', node: { id: 'j', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: PNG_1PX, fileName: 'new.png' } } },
    origin,
  );
  assert.equal(entry.op.node.data.dataUrl, undefined);
  assert.match(entry.op.node.data.file, /-new\.png$/);
  assert.equal(seen[0].op.node.data.dataUrl, undefined, 'subscribers never see the bytes either');
  const journal = await fs.readFile(journalPath(dir), 'utf8');
  assert.equal(journal.includes('base64'), false, 'no bytes in the journal');
  await closeDocument(dir);
  doc = await openDocument(dir);
  assert.equal(doc.version, 2, 'nothing left to extract on the second open');
  await closeDocument(dir);
}

await fs.rm(root, { recursive: true, force: true });
console.log('document.test.js: ok');
