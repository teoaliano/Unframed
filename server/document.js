// The document's I/O half: one in-memory document per project folder, an append-only
// journal (graph.log, one JSON entry per line) that is the truth, and a snapshot
// (graph.json) that only makes the next open fast. graph.js is the pure half; index.js
// turns these into routes; tests in document.test.js.
//
// Three rules, each with a reason:
//
//   The journal is never truncated. It is what undo walks (server-side, so it survives a
//   reload), and it is what rebuilds the graph when the snapshot turns out unreadable.
//   At a few hundred bytes an entry it grows slower than the media folder next to it.
//
//   Commits are serialised per document through one promise chain, the persistJob shape
//   from jobs.js: two writers -- a tab and an agent -- can never interleave a
//   read-modify-write and drop one another's op, and versions are dense and ordered.
//
//   The snapshot is written temp-then-rename, so a crash mid-save leaves either the old
//   file or the new one, never half of one. A leftover .tmp is ignored on open. The
//   journal's own failure mode is a torn last line, which replay skips: an append that
//   did not finish was not a commit.
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyOp, emptyGraph } from './graph.js';

export const snapshotPath = (dir) => path.join(dir, 'graph.json');
export const journalPath = (dir) => path.join(dir, 'graph.log');

// Snapshot after this many commits since the last one, or after this long quiet. Both
// are cheap to change; neither affects correctness, only how much replay an open does.
const SNAPSHOT_EVERY = 50;
const SNAPSHOT_QUIET_MS = 5000;

const open = new Map(); // dir -> document

async function readSnapshot(dir) {
  let raw;
  try {
    raw = await fs.readFile(snapshotPath(dir), 'utf8');
  } catch {
    return null; // nothing saved yet
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.nodes)) return null;
    // A graph saved before the journal existed has no version: it is the version-0 base
    // and every later entry in a (then still empty) journal applies on top of it.
    return {
      version: Number.isInteger(parsed.version) ? parsed.version : 0,
      graph: { nodes: parsed.nodes, edges: Array.isArray(parsed.edges) ? parsed.edges : [] },
    };
  } catch {
    return undefined; // present but unreadable: rebuild from the journal
  }
}

async function readJournal(dir) {
  let raw;
  try {
    raw = await fs.readFile(journalPath(dir), 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Only the LAST line can legitimately be torn (a crash mid-append). Anything
      // unparsable earlier means the file was damaged from outside; stopping here keeps
      // whatever prefix is consistent rather than skipping a hole and applying ops that
      // assumed it.
      break;
    }
  }
  return entries;
}

export async function openDocument(dir) {
  const existing = open.get(dir);
  if (existing) return existing;

  const snap = await readSnapshot(dir);
  const entries = await readJournal(dir);
  let version = 0;
  let graph = emptyGraph();
  if (snap) {
    version = snap.version;
    graph = snap.graph;
  }
  // Replay everything the snapshot does not already contain. With no usable snapshot this
  // is the whole journal from an empty graph, which is exactly how the project began.
  for (const entry of entries) {
    if (entry.version <= version) continue;
    const r = applyOp(graph, entry.op);
    if (r.rejected) {
      // A journal entry that no longer applies means the base it was recorded against is
      // not the base we have -- an externally edited snapshot, most likely. Keep going:
      // losing one op is recoverable, refusing to open the project is not.
      continue;
    }
    graph = r.graph;
    version = entry.version;
  }

  const doc = {
    dir,
    version,
    graph,
    entries,
    subscribers: new Set(),
    // Serialisation and snapshot bookkeeping. `chain` is the promise every commit queues
    // onto; `sinceSnapshot` and `quietTimer` drive the snapshot policy.
    chain: Promise.resolve(),
    sinceSnapshot: entries.filter((e) => e.version > (snap?.version ?? 0)).length,
    quietTimer: null,
    snapshotVersion: snap?.version ?? 0,
  };
  open.set(dir, doc);
  return doc;
}

// Flushes a snapshot and forgets the in-memory document, so the next openDocument reads
// the folder again. Rename, delete and OUTPUT_DIR changes call this before touching the
// folder; tests call it to simulate a restart.
export async function closeDocument(dir) {
  const doc = open.get(dir);
  if (!doc) return;
  await doc.chain;
  if (doc.quietTimer) clearTimeout(doc.quietTimer);
  if (doc.version > doc.snapshotVersion) await writeSnapshot(doc);
  open.delete(dir);
}

export const openDocuments = () => [...open.keys()];

async function writeSnapshot(doc) {
  await fs.mkdir(doc.dir, { recursive: true });
  const file = snapshotPath(doc.dir);
  const tmp = `${file}.${process.pid}-${Date.now()}.tmp`;
  const body = { version: doc.version, nodes: doc.graph.nodes, edges: doc.graph.edges };
  await fs.writeFile(tmp, JSON.stringify(body, null, 2));
  await fs.rename(tmp, file);
  doc.snapshotVersion = doc.version;
  doc.sinceSnapshot = 0;
}

// Public so a caller (or a test) can force one; the policy below calls it on its own.
export async function snapshot(doc) {
  await doc.chain;
  await writeSnapshot(doc);
}

function scheduleSnapshot(doc) {
  if (doc.quietTimer) clearTimeout(doc.quietTimer);
  if (doc.sinceSnapshot >= SNAPSHOT_EVERY) {
    doc.quietTimer = null;
    // Queued behind the commit that triggered it, never racing it.
    doc.chain = doc.chain.then(() => writeSnapshot(doc)).catch(() => {});
    return;
  }
  doc.quietTimer = setTimeout(() => {
    doc.quietTimer = null;
    doc.chain = doc.chain.then(() => writeSnapshot(doc)).catch(() => {});
  }, SNAPSHOT_QUIET_MS);
  // A pending snapshot must not keep the process alive on its own.
  if (typeof doc.quietTimer.unref === 'function') doc.quietTimer.unref();
}

// Applies one op, appends it to the journal, and tells subscribers. Resolves to the
// journal entry ({ version, op, inverse, origin, at }) or { rejected } -- never rejects
// for a structural problem, because the caller has to answer an HTTP request either way.
// The append is awaited BEFORE the in-memory graph advances, so a version a caller has
// been told about is always on disk.
export function commit(doc, op, origin, extra = {}) {
  const run = async () => {
    const r = applyOp(doc.graph, op);
    if (r.rejected) return { rejected: r.rejected };
    const entry = { version: doc.version + 1, op, inverse: r.inverse, origin, at: Date.now(), ...extra };
    await fs.mkdir(doc.dir, { recursive: true });
    await fs.appendFile(journalPath(doc.dir), `${JSON.stringify(entry)}\n`);
    doc.graph = r.graph;
    doc.version = entry.version;
    doc.entries.push(entry);
    doc.sinceSnapshot += 1;
    for (const fn of doc.subscribers) {
      try {
        fn(entry);
      } catch {
        // A broken subscriber must not fail the commit that already reached disk.
      }
    }
    scheduleSnapshot(doc);
    return entry;
  };
  // One chain per document. A rejection in `run` is turned into a value above; a real
  // I/O failure propagates to THIS caller and leaves the chain healthy for the next.
  const result = doc.chain.then(run);
  doc.chain = result.catch(() => {});
  return result;
}

export function subscribe(doc, fn) {
  doc.subscribers.add(fn);
  return () => doc.subscribers.delete(fn);
}
