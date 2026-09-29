import { readFile } from "node:fs/promises";
import type { CanUseTool, Options, PermissionResult, PermissionUpdate, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AGENT_SYSTEM_PROMPT,
  CHAT_TITLE_PROMPT,
  CHAT_TITLE_SYSTEM_PROMPT,
  claudePermissionMode,
  claudeTurnPermissionMode,
  initialClaudeState,
  mapClaudeMessage,
  modelMessage,
  UNFRAMED_TOOL_PREFIX,
  type ApprovalDecision,
  type ClaudeMapState,
  type ClaudePermissionMode,
  type InteractionMode,
  type RuntimeEventDraft,
  type RuntimeMode,
} from "@unframed/domain";
import type { AdapterContext, ProviderAdapter, SessionStart, TitleInput, TurnAttachment, TurnInput } from "../adapter.ts";
import { MCP_SERVER_NAME } from "../mcp.ts";
import { PermissionGate } from "../permissionGate.ts";

/** A queue of user messages as the streaming prompt of one long-lived query. */
class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private waiting: ((result: IteratorResult<SDKUserMessage>) => void) | undefined;
  private closed = false;

  push(message: SDKUserMessage): void {
    if (this.closed) return;
    const waiter = this.waiting;
    if (waiter) {
      this.waiting = undefined;
      waiter({ value: message, done: false });
    } else {
      this.items.push(message);
    }
  }

  close(): void {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

/** The resume cursor: the session to resume, where to resume it, and each turn's last assistant message. */
interface ClaudeCursor {
  readonly sessionId?: string;
  readonly resumeSessionAt?: string;
  readonly boundaries?: ReadonlyArray<string>;
}

interface ClaudeSession {
  readonly chatId: string;
  readonly query: Query;
  readonly prompt: PromptQueue;
  readonly abort: AbortController;
  readonly gate: PermissionGate;
  readonly projectDir: string;
  state: ClaudeMapState;
  turnId: string | undefined;
  interactionMode: InteractionMode;
  runtimeMode: RuntimeMode;
  permissionMode: ClaudePermissionMode;
  model: string;
  boundaries: string[];
  stopped: boolean;
}

const IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

const messageContent = async (input: TurnInput): Promise<SDKUserMessage["message"]["content"]> => {
  const blocks: Array<Record<string, unknown>> = [{ type: "text", text: modelMessage(input.preamble, input.text) }];
  for (const attachment of input.attachments) {
    if (attachment.kind !== "image" || !IMAGE_TYPES.has(attachment.type)) continue;
    const bytes = await readFile(attachment.path).catch(() => undefined);
    // An unreadable image keeps only its path line in the preamble.
    if (bytes) blocks.push({ type: "image", source: { type: "base64", media_type: attachment.type, data: bytes.toString("base64") } });
  }
  return blocks as unknown as SDKUserMessage["message"]["content"];
};

const cursorOf = (value: unknown): ClaudeCursor => {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
    ...(typeof record.resumeSessionAt === "string" ? { resumeSessionAt: record.resumeSessionAt } : {}),
    ...(Array.isArray(record.boundaries) ? { boundaries: record.boundaries.filter((entry): entry is string => typeof entry === "string") } : {}),
  };
};

/**
 * The Claude adapter (spec 07): one long-lived Agent SDK `query()` per chat, fed by a
 * streaming prompt, with Claude Code's own tools and system prompt, Unframed's
 * instructions appended, the Unframed MCP server over HTTP, and every permission decision
 * made by the permission policy.
 */
export const claudeAdapter = (context: AdapterContext): ProviderAdapter => {
  const sessions = new Map<string, ClaudeSession>();

  const emit = (chatId: string, draft: RuntimeEventDraft) => context.emit(chatId, draft);

  const cursor = (session: ClaudeSession): ClaudeCursor => ({
    ...(session.state.sessionId === undefined ? {} : { sessionId: session.state.sessionId }),
    ...(session.state.lastAssistantUuid === undefined ? {} : { resumeSessionAt: session.state.lastAssistantUuid }),
    boundaries: session.boundaries,
  });

  const run = async (session: ClaudeSession) => {
    try {
      for await (const message of session.query) {
        const mapped = mapClaudeMessage(session.state, message, {
          turnId: session.turnId,
          registeredTools: context.registeredTools(),
        });
        session.state = mapped.state;
        for (const event of mapped.events) {
          if (event.type === "turn.completed") {
            if (session.state.lastAssistantUuid !== undefined) session.boundaries.push(session.state.lastAssistantUuid);
            emit(session.chatId, { type: "thread.started", payload: { providerThreadId: session.state.sessionId ?? "", resumeCursor: cursor(session) } });
            session.turnId = undefined;
          }
          emit(session.chatId, event);
        }
        if (mapped.toolsFailure !== undefined && session.turnId !== undefined) {
          const turnId = session.turnId;
          session.turnId = undefined;
          emit(session.chatId, { type: "turn.completed", turnId, payload: { state: "failed", errorMessage: mapped.toolsFailure } });
          await session.query.interrupt().catch(() => undefined);
        }
      }
    } catch (error) {
      if (!session.stopped) context.log(session.chatId, `claude query: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!session.stopped && sessions.get(session.chatId) === session) {
      sessions.delete(session.chatId);
      session.gate.cancelAll();
      emit(session.chatId, { type: "session.exited", payload: { exitKind: "error", detail: "The Claude session ended unexpectedly." } });
    }
  };

  const stop = (chatId: string) => {
    const session = sessions.get(chatId);
    if (!session) return;
    sessions.delete(chatId);
    session.stopped = true;
    session.gate.cancelAll();
    session.prompt.close();
    session.abort.abort();
    try {
      session.query.close();
    } catch {
      // already closed
    }
  };

  return {
    provider: "claude",
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: true },
    async startSession(input: SessionStart) {
      if (!input.environment) throw new Error("Claude has no run environment.");
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      const stored = cursorOf(input.resumeCursor);
      const prompt = new PromptQueue();
      const abort = new AbortController();
      const mode = claudePermissionMode(input.runtimeMode);
      let session: ClaudeSession | undefined;
      const gate = new PermissionGate((draft) => emit(input.chatId, draft));
      const canUseTool: CanUseTool = async (toolName, toolInput, options) => {
        const answer = await gate.decide({
          toolName,
          input: toolInput,
          turnId: session?.turnId,
          runtimeMode: context.runtimeMode(input.chatId),
          interactionMode: session?.interactionMode ?? "default",
          ...(options.toolUseID ? { toolUseId: options.toolUseID } : {}),
          ...(options.suggestions ? { suggestions: options.suggestions as unknown as ReadonlyArray<{ type: string; destination: string }> } : {}),
          signal: options.signal,
        });
        if (answer.behavior === "allow") {
          return {
            behavior: "allow",
            updatedInput: answer.updatedInput ?? toolInput,
            ...(answer.updatedPermissions ? { updatedPermissions: answer.updatedPermissions as unknown as PermissionUpdate[] } : {}),
          } satisfies PermissionResult;
        }
        return { behavior: "deny", message: answer.message, ...(answer.interrupt ? { interrupt: true } : {}) } satisfies PermissionResult;
      };
      const traits = input.modelSelection.traits;
      const settings = {
        ...(traits.thinking === undefined ? {} : { alwaysThinkingEnabled: traits.thinking }),
        ...(traits.fastMode === true ? { fastMode: true } : {}),
      };
      const options: Options = {
        pathToClaudeCodeExecutable: input.environment.executable,
        env: input.environment.env,
        cwd: input.projectDir,
        additionalDirectories: [input.attachmentsDir],
        ...(input.modelSelection.model === "" ? {} : { model: input.modelSelection.model }),
        ...(traits.effort === undefined ? {} : { effort: traits.effort }),
        ...(Object.keys(settings).length > 0 ? { settings } : {}),
        systemPrompt: { type: "preset", preset: "claude_code", append: AGENT_SYSTEM_PROMPT },
        tools: { type: "preset", preset: "claude_code" },
        allowedTools: context.registeredTools().map((name) => `${UNFRAMED_TOOL_PREFIX}${name}`),
        settingSources: ["user", "project", "local"],
        mcpServers: { [MCP_SERVER_NAME]: { type: "http", url: input.mcp.url, headers: { Authorization: `Bearer ${input.mcp.token}` } } },
        ...(mode.permissionMode === undefined ? {} : { permissionMode: mode.permissionMode }),
        ...(mode.allowDangerouslySkipPermissions ? { allowDangerouslySkipPermissions: true } : {}),
        canUseTool,
        includePartialMessages: true,
        maxTurns: 30,
        ...(stored.sessionId === undefined ? {} : { resume: stored.sessionId, ...(stored.resumeSessionAt === undefined ? {} : { resumeSessionAt: stored.resumeSessionAt }) }),
        abortController: abort,
        stderr: (data) => context.log(input.chatId, data.trimEnd()),
      };
      const handle = query({ prompt, options });
      session = {
        chatId: input.chatId,
        query: handle,
        prompt,
        abort,
        gate,
        projectDir: input.projectDir,
        state: { ...initialClaudeState(), ...(stored.sessionId === undefined ? {} : { sessionId: stored.sessionId }), ...(stored.resumeSessionAt === undefined ? {} : { lastAssistantUuid: stored.resumeSessionAt }) },
        turnId: undefined,
        interactionMode: "default",
        runtimeMode: input.runtimeMode,
        permissionMode: mode.permissionMode ?? "default",
        model: input.modelSelection.model,
        boundaries: [...(stored.boundaries ?? [])],
        stopped: false,
      };
      sessions.set(input.chatId, session);
      void run(session);
      emit(input.chatId, { type: "session.started", payload: stored.sessionId === undefined ? {} : { resume: stored } });
      return stored.sessionId === undefined ? {} : { resumeCursor: stored };
    },
    async sendTurn(input: TurnInput) {
      const session = sessions.get(input.chatId);
      if (!session) throw new Error("The Claude session is not running.");
      if (!input.steer) {
        session.turnId = input.turnId;
        session.interactionMode = input.interactionMode;
        if (input.modelSelection.model !== session.model) {
          await session.query.setModel(input.modelSelection.model === "" ? undefined : input.modelSelection.model);
          session.model = input.modelSelection.model;
        }
        const mode = claudeTurnPermissionMode(context.runtimeMode(input.chatId), input.interactionMode);
        if (mode !== session.permissionMode) {
          await session.query.setPermissionMode(mode);
          session.permissionMode = mode;
        }
        emit(input.chatId, { type: "turn.started", turnId: input.turnId, payload: {} });
      }
      session.prompt.push({ type: "user", message: { role: "user", content: await messageContent(input) }, parent_tool_use_id: null } as SDKUserMessage);
      return { turnId: session.turnId ?? input.turnId };
    },
    async interruptTurn(chatId: string) {
      const session = sessions.get(chatId);
      if (!session) return;
      session.gate.cancelAll();
      const turnId = session.turnId;
      await session.query.interrupt().catch(() => undefined);
      if (turnId !== undefined && session.turnId === turnId) {
        session.turnId = undefined;
        emit(chatId, { type: "turn.completed", turnId, payload: { state: "interrupted" } });
      }
    },
    async respondToRequest(chatId: string, requestId: string, decision: ApprovalDecision) {
      sessions.get(chatId)?.gate.respond(requestId, decision);
    },
    async respondToUserInput(chatId: string, requestId: string, answers: Readonly<Record<string, unknown>>) {
      sessions.get(chatId)?.gate.answer(requestId, answers);
    },
    async setRuntimeMode(chatId: string, runtimeMode: RuntimeMode) {
      const session = sessions.get(chatId);
      if (!session) return;
      session.runtimeMode = runtimeMode;
      if (session.interactionMode === "plan") return;
      const mode = claudeTurnPermissionMode(runtimeMode, "default");
      if (mode === session.permissionMode) return;
      await session.query.setPermissionMode(mode).catch(() => undefined);
      session.permissionMode = mode;
    },
    async rollbackThread(chatId: string, numTurns: number) {
      const session = sessions.get(chatId);
      if (!session || numTurns <= 0) return {};
      const keep = session.boundaries.length - numTurns;
      const sessionId = session.state.sessionId;
      stop(chatId);
      if (keep <= 0 || sessionId === undefined) return { resumeCursor: { boundaries: [] } };
      const { forkSession } = await import("@anthropic-ai/claude-agent-sdk");
      const upTo = session.boundaries[keep - 1]!;
      const forked = await forkSession(sessionId, { dir: session.projectDir, upToMessageId: upTo });
      return { resumeCursor: { sessionId: forked.sessionId, resumeSessionAt: upTo, boundaries: session.boundaries.slice(0, keep) } };
    },
    async stopSession(chatId: string) {
      stop(chatId);
    },
    hasSession: (chatId: string) => sessions.has(chatId),
    async stopAll() {
      for (const chatId of [...sessions.keys()]) stop(chatId);
    },
    async title(input: TitleInput) {
      if (!input.environment) return undefined;
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 60_000);
      timer.unref();
      try {
        const handle = query({
          prompt: CHAT_TITLE_PROMPT.replace("<first message>", input.firstMessage).replace("<answer>", input.answer),
          options: {
            pathToClaudeCodeExecutable: input.environment.executable,
            env: input.environment.env,
            cwd: input.projectDir,
            systemPrompt: CHAT_TITLE_SYSTEM_PROMPT,
            settingSources: [],
            tools: [],
            mcpServers: {},
            maxTurns: 1,
            persistSession: false,
            abortController: abort,
            ...(input.modelSelection.model === "" ? {} : { model: input.modelSelection.model }),
          },
        });
        for await (const message of handle) {
          if (message.type === "result") return message.subtype === "success" ? message.result : undefined;
        }
        return undefined;
      } finally {
        clearTimeout(timer);
        abort.abort();
      }
    },
  };
};

export type { TurnAttachment };
