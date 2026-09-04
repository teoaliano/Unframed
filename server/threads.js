// Agent threads: one conversation with the agent about one project, durable the way
// video jobs are (jobs.js). The record is written before a turn starts, so a turn in
// flight survives the tab that asked for it, and a reopened panel reads the transcript
// back from disk. Pure transitions first, thin I/O below, the sidecar last. The session
// that fills a thread is server/agent.js; the routes are in index.js.
//
// A thread is
// { id, project, kind, provider, model, status, error?, title, messages, events, seq,
//   turns, createdAt, updatedAt }.
// messages: [{ role, text, at, turn, selection? }] -- the transcript.
// events:   [{ seq, at, turn, type, ... }]         -- what happened during turns (tool
//           calls, ops applied, results, errors), replayable from ?since=seq. Text
//           deltas are streamed live and never stored; the assistant message holds the
//           final text.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROVIDERS } from './providers.js';

const ID_RE = /^[\w-]{1,80}$/;
const STATUSES = new Set(['idle', 'running', 'failed']);

export function newThread({ id, project, kind = 'canvas', provider, model, now = Date.now() }) {
  if (!ID_RE.test(String(id))) throw new Error('thread id must be a short token');
  if (!PROVIDERS[provider]) throw new Error(`unknown provider ${provider}`);
  return {
    id,
    project,
    kind,
    provider,
    model: model || '',
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
export function appendMessage(thread, { role, text, selection }, now = Date.now()) {
  const turns = role === 'user' ? thread.turns + 1 : thread.turns;
  const message = { role, text: String(text ?? ''), at: now, turn: turns };
  if (selection) message.selection = selection;
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

export function threadSummary(thread) {
  return {
    id: thread.id,
    kind: thread.kind,
    provider: thread.provider,
    model: thread.model,
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
