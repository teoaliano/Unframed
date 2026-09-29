import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  checkCanvasTools,
  classifyToolItem,
  parseScript,
  pickScript,
  preambleMismatch,
  requestTarget,
  scriptTurn,
  UNFRAMED_TOOL_PREFIX,
  type AgentScript,
  type ApprovalDecision,
  type InteractionMode,
  type RuntimeEventDraft,
  type ScriptTurn,
} from "@unframed/domain";
import type { AdapterContext, ProviderAdapter, SessionStart, TitleInput, TurnInput } from "../adapter.ts";
import { McpClient } from "../mcp.ts";
import { PermissionGate } from "../permissionGate.ts";

/** Loads the script file, or every `*.json` in the folder sorted by name. A malformed script fails with its reason. */
export const loadScripts = async (path: string): Promise<AgentScript[]> => {
  const info = await stat(path);
  const files = info.isDirectory()
    ? (await readdir(path))
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => join(path, name))
    : [path];
  const scripts: AgentScript[] = [];
  for (const file of files) {
    const name = basename(file).replace(/\.json$/, "");
    let json: unknown;
    try {
      json = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      throw new Error(`agent script ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const loaded = parseScript(name, json);
    if (!loaded.ok) throw new Error(loaded.error);
    scripts.push(loaded.script);
  }
  return scripts;
};

interface ScriptedSession {
  readonly chatId: string;
  /** The folders granted beyond the project folder, as a session reports them. */
  readonly granted: ReadonlyArray<string>;
  readonly script: AgentScript | undefined;
  readonly pickError: string | undefined;
  readonly mcp: McpClient;
  readonly gate: PermissionGate;
  /** Tools the person allowed for the rest of this session, as the SDK keeps session rules. */
  readonly allowed: Set<string>;
  toolsChecked: boolean;
  turn: { readonly turnId: string; readonly abort: AbortController } | undefined;
}

const nothing = () => {};

/**
 * The scripted agent (spec 07): an adapter like the others that replaces the model and
 * nothing else. Its Unframed tool calls go through the real MCP endpoint and handlers, and
 * its provider tool calls through the real permission decision; no provider tool ever runs.
 */
export const scriptedAdapter = (scriptPath: string, context: AdapterContext): ProviderAdapter => {
  let loaded: Promise<AgentScript[]> | undefined;
  const scripts = () => (loaded ??= loadScripts(scriptPath));
  const sessions = new Map<string, ScriptedSession>();
  let items = 0;

  const emit = (chatId: string, draft: RuntimeEventDraft) => context.emit(chatId, draft);

  const recordSession = async (chatId: string, url: string, token: string) => {
    const folder = join(context.dataDir, "scripted-agent");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `${chatId}.json`), JSON.stringify({ url, token, startedAt: new Date().toISOString() }));
  };

  const runTurn = async (session: ScriptedSession, input: TurnInput, abort: AbortController) => {
    const { chatId, turnId } = input;
    const turn = { turnId };
    const finish = (payload: Record<string, unknown>) => {
      if (session.turn?.turnId === turnId) session.turn = undefined;
      emit(chatId, { type: "turn.completed", ...turn, payload });
    };
    const fail = (message: string) => finish({ state: "failed", errorMessage: message });
    const interrupted = () => abort.signal.aborted;
    emit(chatId, { type: "turn.started", ...turn, payload: {} });

    if (session.script === undefined) return fail(session.pickError ?? "no agent script");
    const script = session.script;
    const picked = scriptTurn(script, input.turnCount);
    if ("error" in picked) return fail(picked.error);
    const step: ScriptTurn = picked.turn;
    const mismatch = preambleMismatch(script, input.turnCount, step, input.preamble);
    if (mismatch) return fail(mismatch);

    if (!session.toolsChecked) {
      session.toolsChecked = true;
      let tools: string[] = [];
      try {
        await session.mcp.initialize();
        tools = (await session.mcp.listTools()).map((name) => `${UNFRAMED_TOOL_PREFIX}${name}`);
      } catch (error) {
        context.log(chatId, `scripted MCP: ${error instanceof Error ? error.message : String(error)}`);
      }
      const check = checkCanvasTools(context.registeredTools(), tools);
      emit(chatId, { type: "session.configured", payload: { tools, foreign: check.foreign, grantedDirectories: session.granted } });
      if (check.failure) return fail(check.failure);
    }

    for (const retry of step.retries ?? []) {
      emit(chatId, { type: "runtime.retry", ...turn, payload: { ...retry } });
    }
    if (step.rateLimit) emit(chatId, { type: "account.rate-limits.updated", ...turn, payload: { ...step.rateLimit } });
    for (const [index, task] of (step.tasks ?? []).entries()) {
      const taskId = `${turnId}:task:${index + 1}`;
      emit(chatId, { type: "task.started", ...turn, payload: { taskId, agentId: taskId, title: task.title, description: task.title } });
      emit(chatId, { type: "task.completed", ...turn, payload: { taskId, agentId: taskId, title: task.title, status: task.status } });
    }
    if (step.question) {
      const answers = await session.gate.ask(step.question.questions, turnId, abort.signal);
      if (answers === undefined || interrupted()) return finish({ state: "interrupted" });
    }

    let text = step.text;
    for (const call of step.provider ?? []) {
      const itemId = `item-${++items}`;
      const itemType = classifyToolItem(call.name, call.input);
      emit(chatId, { type: "item.started", ...turn, itemId, payload: { itemType, status: "inProgress", title: call.name, detail: requestTarget(call.name, call.input), data: { toolName: call.name, input: call.input } } });
      const allowed = session.allowed.has(call.name)
        ? ({ behavior: "allow" } as const)
        : await session.gate.decide({
            toolName: call.name,
            input: call.input,
            turnId,
            runtimeMode: context.runtimeMode(chatId),
            interactionMode: input.interactionMode,
            signal: abort.signal,
          });
      if (allowed.behavior === "allow") {
        for (const update of allowed.updatedPermissions ?? []) {
          for (const rule of (update.rules as Array<{ toolName?: string }> | undefined) ?? []) if (rule.toolName) session.allowed.add(rule.toolName);
        }
        emit(chatId, { type: "item.completed", ...turn, itemId, payload: { itemType, status: "completed", title: call.name } });
        continue;
      }
      emit(chatId, { type: "item.completed", ...turn, itemId, payload: { itemType, status: "declined", title: call.name, detail: allowed.message } });
      if (allowed.interrupt || interrupted()) return finish({ state: "interrupted" });
      text = step.refusedText ?? "";
      return streamText(session, input, text, step, finish, true);
    }

    for (const call of step.tools ?? []) {
      if (interrupted()) return finish({ state: "interrupted" });
      const itemId = `item-${++items}`;
      const toolName = `${UNFRAMED_TOOL_PREFIX}${call.name}`;
      emit(chatId, { type: "item.started", ...turn, itemId, payload: { itemType: "mcp_tool_call", status: "inProgress", title: toolName, data: { toolName, input: call.input } } });
      const allowed = await session.gate.decide({
        toolName,
        input: call.input,
        turnId,
        runtimeMode: context.runtimeMode(chatId),
        interactionMode: input.interactionMode,
        signal: abort.signal,
      });
      if (allowed.behavior === "deny") {
        emit(chatId, { type: "item.completed", ...turn, itemId, payload: { itemType: "mcp_tool_call", status: "failed", title: toolName, detail: allowed.message, data: { toolName, result: { error: allowed.message } } } });
        continue;
      }
      let result: { value: unknown; isError: boolean };
      try {
        result = await session.mcp.callTool(call.name, call.input);
      } catch (error) {
        result = { value: { error: error instanceof Error ? error.message : String(error) }, isError: true };
      }
      emit(chatId, {
        type: "item.completed",
        ...turn,
        itemId,
        payload: { itemType: "mcp_tool_call", status: result.isError ? "failed" : "completed", title: toolName, data: { toolName, input: call.input, result: result.value } },
      });
    }

    if (step.plan !== undefined) {
      await session.gate.decide({
        toolName: "ExitPlanMode",
        input: { plan: step.plan },
        turnId,
        runtimeMode: context.runtimeMode(chatId),
        interactionMode: input.interactionMode,
      });
    }
    return streamText(session, input, text, step, finish, false);
  };

  const streamText = (
    _session: ScriptedSession,
    input: TurnInput,
    text: string,
    step: ScriptTurn,
    finish: (payload: Record<string, unknown>) => void,
    refused: boolean,
  ) => {
    const turn = { turnId: input.turnId };
    if (text !== "") {
      const itemId = `message-${++items}`;
      emit(input.chatId, { type: "content.delta", ...turn, itemId, payload: { streamKind: "assistant_text", delta: text } });
      emit(input.chatId, { type: "item.completed", ...turn, itemId, payload: { itemType: "assistant_message", status: "completed" } });
    }
    if (step.isError === true && !refused) {
      finish({ state: "failed", ...(step.errorSubtype ? { errorSubtype: step.errorSubtype } : {}), usage: { inputTokens: 0, outputTokens: 0 } });
      return;
    }
    finish({ state: "completed", usage: { inputTokens: 10, outputTokens: text.length } });
  };

  const stop = (chatId: string) => {
    const session = sessions.get(chatId);
    if (!session) return;
    sessions.delete(chatId);
    session.turn?.abort.abort();
    session.gate.cancelAll();
  };

  return {
    provider: "scripted",
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: true },
    async startSession(input: SessionStart) {
      let script: AgentScript | undefined;
      let pickError: string | undefined;
      try {
        const loaded = await scripts();
        // The script a chat started on stays its script, even after its first message is rewound away.
        const kept = (input.resumeCursor as { script?: unknown } | undefined)?.script;
        const picked = loaded.find((known) => known.name === kept);
        if (picked) script = picked;
        else {
          const chosen = pickScript(loaded, input.firstMessage);
          if ("script" in chosen) script = chosen.script;
          else pickError = chosen.error;
        }
      } catch (error) {
        pickError = error instanceof Error ? error.message : String(error);
      }
      const session: ScriptedSession = {
        chatId: input.chatId,
        granted: [input.attachmentsDir],
        script,
        pickError,
        mcp: new McpClient(input.mcp.url, input.mcp.token),
        gate: new PermissionGate((draft) => emit(input.chatId, draft)),
        allowed: new Set(),
        toolsChecked: false,
        turn: undefined,
      };
      sessions.set(input.chatId, session);
      await recordSession(input.chatId, input.mcp.url, input.mcp.token).catch(nothing);
      emit(input.chatId, { type: "session.started", payload: input.resumeCursor === undefined ? {} : { resume: input.resumeCursor } });
      return { resumeCursor: { script: script?.name ?? null, resumed: input.resumeCursor !== undefined } };
    },
    async sendTurn(input: TurnInput) {
      const session = sessions.get(input.chatId);
      if (!session) throw new Error("The scripted session is not running.");
      if (input.steer && session.turn) return { turnId: session.turn.turnId };
      const abort = new AbortController();
      session.turn = { turnId: input.turnId, abort };
      void runTurn(session, input, abort).catch((error: unknown) => {
        session.turn = undefined;
        emit(input.chatId, { type: "turn.completed", turnId: input.turnId, payload: { state: "failed", errorMessage: error instanceof Error ? error.message : String(error) } });
      });
      return { turnId: input.turnId };
    },
    async interruptTurn(chatId: string) {
      const session = sessions.get(chatId);
      if (!session) return;
      session.turn?.abort.abort();
      session.gate.cancelAll();
    },
    async respondToRequest(chatId: string, requestId: string, decision: ApprovalDecision) {
      sessions.get(chatId)?.gate.respond(requestId, decision);
    },
    async respondToUserInput(chatId: string, requestId: string, answers: Readonly<Record<string, unknown>>) {
      sessions.get(chatId)?.gate.answer(requestId, answers);
    },
    async setRuntimeMode() {},
    async rollbackThread() {
      return {};
    },
    async stopSession(chatId: string) {
      stop(chatId);
    },
    hasSession: (chatId: string) => sessions.has(chatId),
    async stopAll() {
      for (const chatId of [...sessions.keys()]) stop(chatId);
    },
    async title(input: TitleInput) {
      const picked = pickScript(await scripts(), input.firstMessage);
      if (!("script" in picked)) return undefined;
      const title = picked.script.turns[0]?.title;
      return title === undefined || title.trim() === "" ? undefined : title;
    },
  };
};

export type { InteractionMode };
