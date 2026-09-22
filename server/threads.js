// Agent threads: one conversation with the agent about one project, durable the way
// video jobs are (jobs.js). The record is written before a turn starts, so a turn in
// flight survives the tab that asked for it, and a reopened panel reads the transcript
// back from disk. Pure transitions first, thin I/O below, the sidecar last. The session
// that fills a thread is server/agent.js; the routes are in index.js.
//
// A thread is a CHAT, not a thing about an artifact:
// { id, project, tags, provider, model, mode, status, error?, title, titledBy,
//   lastVersion, messages, events, seq, turns, createdAt, updatedAt }.
// mode:     the runtime mode -- how much the agent may do in this chat without asking
//           (permissions.js). A property of the CHAT, so two chats can run at different
//           levels of trust at once.
// pending:  the permission request this chat is waiting on, or null. It is thread state
//           rather than session state precisely so it survives a reload: a client that
//           reconnects reads it from the record instead of from a socket it missed.
// grants:   signatures the person has allowed for the rest of this chat (permissions.js,
//           signatureOf). Thread-scoped by definition -- a new chat starts with none.
// tags:     node ids of the artifacts (pages, motions) this chat has touched -- the ones
//           selected at its first message, plus every artifact the agent writes to.
//           Tags are POINTERS, never dependencies: deleting every file a chat touched
//           leaves the chat intact, and a stale tag simply stops matching. This is why
//           there is no `kind`/`artifactId` any more -- a chat bound to one node could
//           not be about two, and a chat about a deleted node vanished from the strip.
// titledBy: who named the chat -- 'user' (typed on the tab), 'agent' (written once after
//           the first turn) or null. A user name always beats an agent one, in either
//           order, which is why the two cannot share one field.
// lastVersion: the document version when the agent's last turn ended, so the next turn's
//           preamble can say what changed in between (agent.js, contextPreamble).
// messages: [{ role, text, at, turn, selection? }] -- the transcript. `selection` is what
//           the person had selected when they sent it: context, not a target.
// events:   [{ seq, at, turn, type, ... }]         -- what happened during turns (tool
//           calls, ops applied, results, errors), replayable from ?since=seq. Text
//           deltas are streamed live and never stored; the assistant message holds the
//           final text.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROVIDERS } from './providers.js';
import { MODES, DEFAULT_MODE, isMode } from './permissions.js';

const ID_RE = /^[\w-]{1,80}$/;
const STATUSES = new Set(['idle', 'running', 'failed']);

// Tags as they may be given: node ids, deduplicated, order kept. Validated here because
// a tag reaches a URL (`GET ...threads?tag=`) and a file-name-shaped comparison.
function cleanTags(tags) {
  if (!Array.isArray(tags)) throw new Error('tags must be an array of node ids');
  const out = [];
  for (const raw of tags) {
    const id = String(raw);
    if (!ID_RE.test(id)) throw new Error(`tag must be a node id: ${id}`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function newThread({ id, project, tags = [], provider, model, effort = '', mode = DEFAULT_MODE, now = Date.now() }) {
  if (effort && !EFFORTS.has(effort)) throw new Error(`unknown effort "${effort}"`);
  if (!isMode(mode)) throw new Error(`unknown mode "${mode}"`);
  if (!ID_RE.test(String(id))) throw new Error('thread id must be a short token');
  if (!PROVIDERS[provider]) throw new Error(`unknown provider ${provider}`);
  return {
    id,
    project,
    tags: cleanTags(tags),
    provider,
    model: model || '',
    effort: effort || '',
    mode,
    pending: null,
    grants: [],
    status: 'idle',
    title: '',
    titledBy: null,
    lastVersion: null,
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

// A session lives in one process and cannot outlive it (agent.js keeps them in a Map).
// So a record that says `running` while no session is live for it is, with certainty, a
// turn the app was quit on -- there is no third possibility. That inference is made here
// and applied on the READ path rather than once at boot, so it holds wherever a thread is
// listed or opened, and a record written by a server that has since been replaced cannot
// slip past it.
//
// The reconciled thread reads `failed`, and that is the point: the composer and
// `findChatFor` skip `running`, not `failed`, so an interrupted conversation can be
// carried on instead of being silently replaced by a new one.
//
// `live` defaults to TRUE, which is the safe way round: a caller that forgets to say
// leaves the bug in place, where a caller that forgets and gets `false` would report a
// turn still in flight as dead.
export const QUIT_MID_TURN = 'Unframed stopped while this turn was running, so it never finished. Send again to carry on where it left off.';

export function reconcile(thread, { live = true } = {}, now = Date.now()) {
  if (!thread || thread.status !== 'running' || live) return thread;
  // A pending request goes with it: the turn parked on that answer died with the process,
  // so a panel offering Allow and Deny would be offering them to nobody.
  const failed = setStatus(thread, 'failed', { error: QUIT_MID_TURN }, now);
  return failed.pending ? { ...failed, pending: null } : failed;
}

// The chat picks up a tag for every artifact it touches -- the selection at its first
// message, then every page or motion the agent writes to, created or updated. Adding a
// tag it already has returns the SAME object, so a turn that rewrites one artifact five
// times does not write the record five times.
export function tagThread(thread, ids, now = Date.now()) {
  const have = thread.tags ?? [];
  const add = cleanTags(ids).filter((id) => !have.includes(id));
  if (!add.length) return thread;
  return { ...thread, tags: [...have, ...add], updatedAt: now };
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

// How much the agent may do in this chat without asking (permissions.js). Its own
// function rather than part of `applySettings` for the reason `renameThread` is: the two
// are refused under different conditions, and sharing one would take the stricter. A
// model cannot change mid-turn because the live session was built with it; a mode CAN,
// because the SDK's own `permissionMode` only sets the floor and every decision our
// `canUseTool` makes reads the record -- so tightening a chat takes effect on the agent's
// very next call rather than on the next turn.
export function setMode(thread, mode, now = Date.now()) {
  if (!isMode(mode)) throw Object.assign(new Error(`Mode must be one of ${MODES.join(', ')}.`), { status: 400 });
  if (mode === (thread.mode ?? DEFAULT_MODE)) return thread;
  return { ...thread, mode, updatedAt: now };
}

// ---- permissions ----
//
// A request is written into the record and emitted on the thread's event stream, the same
// path every other agent event takes; the answer arrives as a route call and resolves the
// promise the turn is parked on (agent.js). Only one can be outstanding at a time, which
// is not a limitation but the shape of a turn: the agent is blocked on this answer and
// cannot ask a second question until it has one.
export function askPermission(thread, request, now = Date.now()) {
  if (thread.pending) throw Object.assign(new Error('This chat is already waiting on a permission.'), { status: 409 });
  return { ...thread, pending: { ...request, at: now, turn: thread.turns }, updatedAt: now };
}

// The person's answer. `always` also widens the chat, which is what stops the twentieth
// identical request being the twentieth prompt (user story 18); `once` and `deny` leave
// the chat exactly as trusting as it was. An answer to a request that is not the pending
// one is refused rather than ignored -- a stale panel must not decide the live question.
export function answerPermission(thread, id, decision, now = Date.now()) {
  if (!thread.pending) throw Object.assign(new Error('This chat is not waiting on a permission.'), { status: 409 });
  if (thread.pending.id !== id) throw Object.assign(new Error('That permission request is no longer the one in flight.'), { status: 409 });
  if (!['once', 'always', 'deny'].includes(decision)) throw Object.assign(new Error('A permission is answered once, always or deny.'), { status: 400 });
  const grants = thread.grants ?? [];
  const widened = decision === 'always' && thread.pending.signature && !grants.includes(thread.pending.signature);
  return { ...thread, pending: null, grants: widened ? [...grants, thread.pending.signature] : grants, updatedAt: now };
}

// The name a user typed on the tab. Separate from `applySettings` because it is a
// label, not a setting: nothing in the running turn reads it, so renaming mid-turn is
// fine where changing the model is not. `''` clears the name and the tab falls back to
// what it says by default. The cap is short because the thing being named is a tab.
export function renameThread(thread, title, now = Date.now()) {
  if (typeof title !== 'string') throw Object.assign(new Error('A thread name must be text.'), { status: 400 });
  const next = title.trim().slice(0, 60);
  const by = next ? 'user' : null;
  if (next === thread.title && by === (thread.titledBy ?? null)) return thread;
  return { ...thread, title: next, titledBy: by, updatedAt: now };
}

// The agent's own name for the chat, written once after the first turn (agent.js). It
// never overwrites a name the person typed -- in either order, which is the whole reason
// `titledBy` exists: an agent title arriving after a rename must lose, and a rename
// arriving after an agent title must win.
export function titleThread(thread, title, now = Date.now()) {
  if (thread.titledBy === 'user') return thread;
  const next = String(title ?? '').trim().slice(0, 60);
  if (!next || next === thread.title) return thread;
  return { ...thread, title: next, titledBy: 'agent', updatedAt: now };
}

// `title` is the chat's name -- the person's or the agent's, with `titledBy` saying
// which -- and is empty until one of them gives it one. `preview` is the first thing
// anyone said, which is what the tab falls back to. They were one field, and a tab
// cannot use a field that is sometimes the name and sometimes the opening quote.
export function threadSummary(thread) {
  return {
    id: thread.id,
    tags: thread.tags ?? [],
    provider: thread.provider,
    model: thread.model,
    effort: thread.effort ?? '',
    mode: thread.mode ?? DEFAULT_MODE,
    // The strip shows which chat is waiting on you, so the summary carries the fact but
    // not the request: what it is asking for belongs to the panel that opens it.
    waiting: !!thread.pending,
    status: thread.status,
    title: thread.title,
    titledBy: thread.titledBy ?? null,
    preview: thread.messages.find((m) => m.role === 'user')?.text.slice(0, 80) || '',
    turns: thread.turns,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

// ---- I/O ----

export const threadsDir = (dir) => path.join(dir, 'threads');
export const threadPath = (dir, id) => path.join(threadsDir(dir), `${path.basename(String(id))}.json`);

// A pre-2026-09-06 record was one chat about one node: `kind: 'canvas' | 'artifact'` and
// an `artifactId`. It becomes a chat tagged with that node, and a title it carried was
// necessarily the person's (the agent could not write one yet). Migrated on the way IN,
// never rewritten on disk -- the same rule as `migrateNodes`, and permanent for the same
// reason: the old fields are dropped the next time the record is written, and a chat
// nobody has opened since must still open.
export function migrateThread(record) {
  if (!record) return record;
  // A record written before runtime modes existed ran with no general tools at all, so
  // the mode it never had is the default one.
  if (!isMode(record.mode)) record = { ...record, mode: DEFAULT_MODE };
  if (record.pending === undefined || !Array.isArray(record.grants)) record = { ...record, pending: record.pending ?? null, grants: Array.isArray(record.grants) ? record.grants : [] };
  if (Array.isArray(record.tags)) return record;
  const { kind, artifactId, ...rest } = record;
  return {
    ...rest,
    tags: artifactId ? [String(artifactId)] : [],
    title: record.title ?? '',
    titledBy: record.titledBy ?? (record.title ? 'user' : null),
    lastVersion: record.lastVersion ?? null,
  };
}

export async function readThread(dir, id, { live } = {}) {
  let raw;
  try {
    raw = await fs.readFile(threadPath(dir, id), 'utf8');
  } catch {
    throw new Error(`Thread not found: ${id}`);
  }
  return reconcile(migrateThread(JSON.parse(raw)), { live });
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
// `live(id)` answers whether a session for that thread is running in this process; with
// no answer every thread is assumed live, which is the safe default `reconcile` states.
export async function listThreads(dir, { live } = {}) {
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
      const record = migrateThread(JSON.parse(await fs.readFile(path.join(threadsDir(dir), name), 'utf8')));
      out.push(threadSummary(reconcile(record, { live: live ? live(record.id) : undefined })));
    } catch {
      // a half-written or hand-damaged record: skip it rather than hide every other one
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// The chat a composer message continues: the newest one not mid-turn whose tags include
// EVERY selected artifact, or null when there is none and one should be started. All-of,
// not any-of: continuing a chat about A in a message about A and B would carry over an
// answer that never saw B. With nothing selected it is the newest idle UNTAGGED chat --
// a general conversation, not whichever artifact chat happens to be newest.
export async function findChatFor(dir, artifactIds = [], { live } = {}) {
  const want = cleanTags(artifactIds);
  const all = await listThreads(dir, { live });
  const idle = all.filter((t) => t.status !== 'running');
  if (!want.length) return idle.find((t) => !(t.tags ?? []).length) ?? null;
  return idle.find((t) => want.every((id) => (t.tags ?? []).includes(id))) ?? null;
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
