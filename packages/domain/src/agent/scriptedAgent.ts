/**
 * The scripted agent's script format (spec 07): parsing, choosing a chat's script by its
 * first message, and the sentences a script fails a turn with. It replaces the model and
 * nothing else.
 */
import type { UserQuestion } from "./runtimeEvents.ts";

export interface ScriptCall {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ScriptTurn {
  readonly text: string;
  /** Unframed tools, run through the real handlers. */
  readonly tools?: ReadonlyArray<ScriptCall>;
  /** Provider tools: the permission decision only, never executed. */
  readonly provider?: ReadonlyArray<ScriptCall>;
  readonly retries?: ReadonlyArray<{ readonly attempt: number; readonly maxRetries: number; readonly delayMs: number; readonly status: number }>;
  readonly question?: { readonly questions: ReadonlyArray<UserQuestion> };
  readonly tasks?: ReadonlyArray<{ readonly title: string; readonly status: string }>;
  readonly rateLimit?: { readonly status: "allowed" | "allowed_warning" | "rejected"; readonly resetsAt?: string };
  readonly plan?: string;
  /** Token usage reported as the turn ends, as a provider reports its context window (spec 08's meter). */
  readonly usage?: { readonly usedTokens: number; readonly maxTokens?: number; readonly totalProcessedTokens?: number };
  readonly title?: string;
  readonly isError?: boolean;
  readonly errorSubtype?: string;
  readonly expectPreamble?: string;
  readonly refusedText?: string;
}

export interface AgentScript {
  readonly name: string;
  readonly when?: string;
  readonly turns: ReadonlyArray<ScriptTurn>;
}

export type ScriptLoad = { readonly ok: true; readonly script: AgentScript } | { readonly ok: false; readonly error: string };

/** Reads one script file's JSON. A bare array means `{turns}`. */
export const parseScript = (name: string, json: unknown): ScriptLoad => {
  const fail = (reason: string): ScriptLoad => ({ ok: false, error: `agent script ${name}: ${reason}` });
  const value = Array.isArray(json) ? { turns: json } : json;
  if (typeof value !== "object" || value === null) return fail("a script is an object with turns, or an array of turns");
  const record = value as { when?: unknown; turns?: unknown };
  if (record.when !== undefined) {
    if (typeof record.when !== "string") return fail("when must be a string");
    try {
      new RegExp(record.when, "i");
    } catch {
      return fail(`when is not a regular expression: ${record.when}`);
    }
  }
  if (!Array.isArray(record.turns) || record.turns.length === 0) return fail("it has no turns");
  for (const [index, turn] of record.turns.entries()) {
    if (typeof turn !== "object" || turn === null || typeof (turn as { text?: unknown }).text !== "string") {
      return fail(`turn ${index + 1} has no text string`);
    }
    const expect = (turn as { expectPreamble?: unknown }).expectPreamble;
    if (expect !== undefined) {
      try {
        new RegExp(String(expect));
      } catch {
        return fail(`turn ${index + 1}'s expectPreamble is not a regular expression`);
      }
    }
  }
  return { ok: true, script: { name, ...(record.when === undefined ? {} : { when: record.when }), turns: record.turns as ScriptTurn[] } };
};

/**
 * The script a chat runs, chosen by its first message: the first whose `when` matches it
 * (case-insensitive), else one with no `when`, else the only script when just one loaded.
 */
export const pickScript = (scripts: ReadonlyArray<AgentScript>, firstMessage: string): { script: AgentScript } | { error: string } => {
  const matched = scripts.find((script) => script.when !== undefined && new RegExp(script.when, "i").test(firstMessage));
  if (matched) return { script: matched };
  const open = scripts.find((script) => script.when === undefined);
  if (open) return { script: open };
  if (scripts.length === 1) return { script: scripts[0]! };
  return { error: `no agent script matches "${firstMessage.slice(0, 60)}"` };
};

/** Turn N answers the chat's Nth message; past the end the turn fails. */
export const scriptTurn = (script: AgentScript, turnCount: number): { turn: ScriptTurn } | { error: string } => {
  const turn = script.turns[turnCount - 1];
  if (turn) return { turn };
  const n = script.turns.length;
  return { error: `agent script ${script.name} has ${n} turn${n === 1 ? "" : "s"}; the chat is on turn ${turnCount}` };
};

/** `undefined` when the turn's preamble matches what the script expects, else the failure sentence. */
export const preambleMismatch = (script: AgentScript, turnCount: number, turn: ScriptTurn, preamble: string): string | undefined => {
  if (turn.expectPreamble === undefined) return undefined;
  if (new RegExp(turn.expectPreamble).test(preamble)) return undefined;
  return `agent script ${script.name} turn ${turnCount}: preamble did not match /${turn.expectPreamble}/: it was "${preamble}"`;
};
