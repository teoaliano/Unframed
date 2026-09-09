// The scripted agent: a second runner for Session (agent.js), used only when
// UNFRAMED_TEST_AGENT_SCRIPT names a script. It exists because every interesting thing
// about a turn -- that a bulk edit is one undo step, that a tag appears, that the
// preamble carries the undo note, that a write to a deleted node fails and says so --
// is otherwise checkable only by spending the person's quota on a non-deterministic
// model. So the model is replaced and NOTHING else is: the runner calls the REAL tool
// handlers (so ops reach the real document, files reach the real folder, tags and events
// happen through the same code) and emits the same events the SDK loop emits.
//
// The marker rule, as with UNFRAMED_DATA_DIR and UNFRAMED_CLIENT_DIST: an env var unset
// in a clone is the only safe gate. Nothing here is reachable without it, and there is
// deliberately no route, header or body field that can turn it on.
//
// A script is { when?, turns: [...] } (or a bare array of turns), and a turn is
//   { text, tools?: [{ name, input }], title?, isError?, expectPreamble? }
// Turn N answers the thread's Nth user message. `when` is a pattern matched against a
// chat's FIRST message: it is how one folder of fixtures serves a flow that starts
// several different conversations, since the env var is per server, not per thread.
// `expectPreamble` asserts what the agent was actually told, so the undo-note contract
// is checked from the agent's own side rather than from a log.
import fs from 'node:fs/promises';
import path from 'node:path';

const isTurn = (t) => t && typeof t === 'object' && typeof t.text === 'string';

function parseScript(name, raw) {
  const body = Array.isArray(raw) ? { turns: raw } : raw;
  if (!body || typeof body !== 'object') throw new Error(`agent script ${name}: not an object`);
  if (!Array.isArray(body.turns) || !body.turns.length) throw new Error(`agent script ${name}: turns must be a non-empty array`);
  body.turns.forEach((t, i) => {
    if (!isTurn(t)) throw new Error(`agent script ${name}: turn ${i + 1} needs a text string`);
    if (t.tools !== undefined && !Array.isArray(t.tools)) throw new Error(`agent script ${name}: turn ${i + 1} tools must be an array`);
    for (const call of t.tools ?? []) {
      if (!call || typeof call.name !== 'string') throw new Error(`agent script ${name}: turn ${i + 1} has a tool call with no name`);
    }
  });
  return { name, when: typeof body.when === 'string' && body.when ? new RegExp(body.when, 'i') : null, turns: body.turns };
}

// A file is one script; a directory is every `*.json` in it, which is how the flow test
// runs several conversations against one server. Absent or unreadable is null -- the SDK
// runs, exactly as in a clone.
export async function loadScript(value) {
  if (!value) return null;
  const target = String(value);
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    throw new Error(`UNFRAMED_TEST_AGENT_SCRIPT: no such path ${target}`);
  }
  const read = async (file) => parseScript(path.basename(file, '.json'), JSON.parse(await fs.readFile(file, 'utf8')));
  if (!stat.isDirectory()) return { scripts: [await read(target)] };
  const names = (await fs.readdir(target)).filter((n) => n.endsWith('.json')).sort();
  if (!names.length) throw new Error(`UNFRAMED_TEST_AGENT_SCRIPT: no scripts in ${target}`);
  return { scripts: await Promise.all(names.map((n) => read(path.join(target, n)))) };
}

// Which script this chat is running. Chosen from its first message and then kept, so
// turn 2 of a conversation cannot wander into another fixture. Fallbacks, in order: a
// script that declares no `when` (an explicit catch-all), then -- when only one script
// was loaded at all -- that one, so pointing the variable at a single file just works.
// With several scripts and no match it is null, and the turn fails saying so: silently
// answering from the wrong fixture would make every assertion downstream a guess.
export function pickScript({ scripts }, firstMessage) {
  const text = String(firstMessage ?? '');
  return scripts.find((s) => s.when?.test(text)) ?? scripts.find((s) => !s.when) ?? (scripts.length === 1 ? scripts[0] : null);
}

// One turn, in the shape the SDK loop produces. `session` is the Session: this uses its
// `tools` (the real handlers), `emit`, `settleTurn` and `model`, and nothing else.
export async function runScriptedTurn(session, { turn, preamble, text }) {
  const started = Date.now();
  if (!session.chosenScript) {
    session.chosenScript = pickScript(session.script, text);
    if (!session.chosenScript) throw new Error(`no agent script matches "${String(text).slice(0, 60)}"`);
  }
  const script = session.chosenScript;
  const step = script.turns[turn - 1];
  if (!step) throw new Error(`agent script ${script.name} has ${script.turns.length} turn(s); the chat is on turn ${turn}`);
  if (step.expectPreamble && !new RegExp(step.expectPreamble).test(preamble)) {
    throw new Error(`agent script ${script.name} turn ${turn}: preamble did not match /${step.expectPreamble}/ -- it was "${preamble}"`);
  }

  // The init handshake the SDK path checks, so a listener sees the same first event.
  if (turn === 1) {
    await session.emit({ type: 'session', model: session.model || script.name, tools: session.tools.map((t) => `mcp__unframed__${t.name}`) });
  }

  const byName = new Map(session.tools.map((t) => [t.name, t]));
  for (const [i, call] of (step.tools ?? []).entries()) {
    const tool = byName.get(call.name);
    if (!tool) throw new Error(`agent script ${script.name} turn ${turn}: no tool named ${call.name}`);
    const id = `scripted-${turn}-${i}`;
    await session.emit({ type: 'tool_use', name: `mcp__unframed__${call.name}`, input: call.input ?? {}, id });
    // The real handler. It commits, writes files and fires onWrite (which tags the chat
    // and emits ops_applied) exactly as it does for a model's call.
    const out = await tool.handler(call.input ?? {}, {});
    const body = (out?.content ?? []).map((c) => c.text ?? '').join('');
    await session.emit({ type: 'tool_result', id, ok: !out?.isError, size: body.length });
  }

  if (step.text) await session.emit({ type: 'text_delta', text: step.text });
  await session.settleTurn({
    answer: step.text,
    isError: !!step.isError,
    usage: { input_tokens: 0, output_tokens: 0 },
    numTurns: 1,
    durationMs: Date.now() - started,
    stopReason: 'end_turn',
    model: session.model || `script:${script.name}`,
    // The script decides the chat's name, so turn 1 does not reach for a model. '' means
    // "this script writes no title", which leaves the tab on its fallback.
    title: turn === 1 ? (step.title ?? '') : undefined,
  });
}
