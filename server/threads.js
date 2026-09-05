// Agent threads: one conversation with the agent about one project, durable the way
// video jobs are (jobs.js). The record is written before a turn starts, so a turn in
// flight survives the tab that asked for it, and a reopened panel reads the transcript
// back from disk. Pure transitions first, thin I/O below, the sidecar last. The session
// that fills a thread is server/agent.js; the routes are in index.js.
//
// A thread is
// { id, project, kind, artifactId, provider, model, status, error?, title, messages,
//   events, seq, turns, createdAt, updatedAt }.
// kind: 'canvas' (about the whole board) or 'artifact' (about one page or motion, the
//       node in `artifactId`; null until the agent creates that node).
// messages: [{ role, text, at, turn, selection?, target?, with? }] -- the transcript.
//           target/with are what the composer sent: the node the message is about (or
//           "new") and the rest of the selection.
// events:   [{ seq, at, turn, type, ... }]         -- what happened during turns (tool
//           calls, ops applied, results, errors), replayable from ?since=seq. Text
//           deltas are streamed live and never stored; the assistant message holds the
//           final text.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROVIDERS } from './providers.js';

const ID_RE = /^[\w-]{1,80}$/;
const STATUSES = new Set(['idle', 'running', 'failed']);
const KINDS = new Set(['canvas', 'artifact']);

export function newThread({ id, project, kind = 'canvas', artifactId = null, provider, model, effort = '', now = Date.now() }) {
  if (effort && !EFFORTS.has(effort)) throw new Error(`unknown effort "${effort}"`);
  if (!ID_RE.test(String(id))) throw new Error('thread id must be a short token');
  if (!PROVIDERS[provider]) throw new Error(`unknown provider ${provider}`);
  if (!KINDS.has(kind)) throw new Error(`unknown thread kind ${kind}`);
  if (artifactId !== null && (typeof artifactId !== 'string' || !ID_RE.test(artifactId))) throw new Error('artifactId must be a node id');
  return {
    id,
    project,
    kind,
    artifactId: kind === 'artifact' ? artifactId : null,
    provider,
    model: model || '',
    effort: effort || '',
    status: 'idle',
    title: '',
    messages: [],
    events: [],
    seq: 0,
    turns: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// A user message opens a turn; an assistant message closes the current one.
export function appendMessage(thread, { role, text, selection, target, with: withIds }, now = Date.now()) {
  const turns = role === 'user' ? thread.turns + 1 : thread.turns;
  const message = { role, text: String(text ?? ''), at: now, turn: turns };
  if (selection) message.selection = selection;
  if (target) message.target = target;
  if (Array.isArray(withIds) && withIds.length) message.with = withIds;
  return { ...thread, messages: [...thread.messages, message], turns, updatedAt: now };
}

// Deltas are for the live stream only.
export function appendEvent(thread, event, now = Date.now()) {
  if (event.type === 'text_delta') return thread;
  const seq = thread.seq + 1;
  return {
    ...thread,
    seq,
    events: [...thread.events, { seq, at: now, turn: thread.turns, ...event }],
    updatedAt: now,
  };
}

export function setStatus(thread, status, { error } = {}, now = Date.now()) {
  if (!STATUSES.has(status)) throw new Error(`unknown status ${status}`);
  const next = { ...thread, status, updatedAt: now };
  if (status === 'failed' && error) next.error = String(error);
  else delete next.error;
  return next;
}

export const eventsSince = (thread, seq) => thread.events.filter((e) => e.seq > seq);

// An artifact thread that has no node yet takes the one the agent just created.
export function bindArtifact(thread, artifactId, now = Date.now()) {
  if (thread.kind !== 'artifact' || thread.artifactId) return thread;
  return { ...thread, artifactId, updatedAt: now };
}

// The Agent SDK's effort levels; '' means the model's default. Validated here because
// the string reaches the SDK's options.
export const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// Model and effort for the NEXT turn. Each is optional; an absent key leaves the field
// alone, '' resets it to the default. Refused while a turn is running, since the live
// session was built with the old values and closing it mid-turn would cut the answer.
export function applySettings(thread, { model, effort } = {}, now = Date.now()) {
  if (thread.status === 'running') throw Object.assign(new Error('A turn is running; change the model when it finishes.'), { status: 409 });
  const next = { ...thread };
  if (model !== undefined) {
    if (typeof model !== 'string' || model.length > 200) throw Object.assign(new Error('That does not look like a model id.'), { status: 400 });
    next.model = model;
  }
  if (effort !== undefined) {
    if (effort !== '' && !EFFORTS.has(effort)) throw Object.assign(new Error(`Effort must be one of ${[...EFFORTS].join(', ')}.`), { status: 400 });
    next.effort = effort;
  }
  if (next.model === thread.model && next.effort === (thread.effort ?? '')) return thread;
  return { ...next, updatedAt: now };
}

export function threadSummary(thread) {
  return {
    id: thread.id,
    kind: thread.kind,
    artifactId: thread.artifactId ?? null,
    provider: thread.provider,
    model: thread.model,
    effort: thread.effort ?? '',
    status: thread.status,
    title: thread.title || thread.messages.find((m) => m.role === 'user')?.text.slice(0, 80) || '',
    turns: thread.turns,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

// ---- I/O ----

export const threadsDir = (dir) => path.join(dir, 'threads');
export const threadPath = (dir, id) => path.join(threadsDir(dir), `${path.basename(String(id))}.json`);

export async function readThread(dir, id) {
  let raw;
  try {
    raw = await fs.readFile(threadPath(dir, id), 'utf8');
  } catch {
    throw new Error(`Thread not found: ${id}`);
  }
  return JSON.parse(raw);
}

// Temp-then-rename, the jobs.json rule: a crash mid-save leaves the old record or the
// new one, never half of one.
export async function writeThread(dir, thread) {
  await fs.mkdir(threadsDir(dir), { recursive: true });
  const file = threadPath(dir, thread.id);
  const tmp = `${file}.${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(thread, null, 2));
  await fs.rename(tmp, file);
}

// Read-modify-write, serialised per thread so two events landing in the same tick
// cannot drop each other. `update(current)` gets the record on disk (null when there is
// none yet) and returns the next one; returning null writes nothing.
const chains = new Map(); // key -> promise
export function persistThread(dir, id, update) {
  const key = `${dir}\0${id}`;
  const run = async () => {
    let current = null;
    try {
      current = await readThread(dir, id);
    } catch {
      current = null;
    }
    const next = await update(current);
    if (!next) return null;
    await writeThread(dir, next);
    return next;
  };
  const prev = chains.get(key) ?? Promise.resolve();
  const result = prev.then(run);
  chains.set(key, result.catch(() => {}));
  return result;
}

// Newest first. No folder is no threads, not an error.
export async function listThreads(dir) {
  let names;
  try {
    names = await fs.readdir(threadsDir(dir));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(threadSummary(JSON.parse(await fs.readFile(path.join(threadsDir(dir), name), 'utf8'))));
    } catch {
      // a half-written or hand-damaged record: skip it rather than hide every other one
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// The thread a composer message about `artifactId` goes to: the newest one about that
// node that is not mid-turn, or null when there is none and one should be created.
export async function findArtifactThread(dir, artifactId) {
  const all = await listThreads(dir);
  return all.find((t) => t.kind === 'artifact' && t.artifactId === artifactId && t.status !== 'running') ?? null;
}

export async function deleteThread(dir, id) {
  await fs.rm(threadPath(dir, id), { force: true });
}

// Every turn leaves a sidecar next to the generations', with what it used and what it
// would have cost -- and never a `cost` field: a subscription turn has no metered
// price, and writing 0 would silently corrupt the sums the sidecars exist for.
export async function agentSidecar(dir, { threadId, turn, provider, model, usage, estimatedUsd, durationMs, now = Date.now() }) {
  await fs.mkdir(dir, { recursive: true });
  let file;
  for (let n = 0; ; n++) {
    file = `${now}-agent${n ? `-${n}` : ''}.json`;
    try {
      await fs.access(path.join(dir, file));
    } catch {
      break;
    }
  }
  const body = {
    kind: 'agent-turn',
    threadId,
    turn,
    provider,
    model,
    billing: 'subscription',
    usage: usage ?? {},
    ...(estimatedUsd !== undefined ? { estimatedUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    at: new Date(now).toISOString(),
  };
  await fs.writeFile(path.join(dir, file), JSON.stringify(body, null, 2));
  return file;
}
