import {
  AGENT_SYSTEM_PROMPT,
  CHAT_TITLE_SYSTEM_PROMPT,
  chatTitlePrompt,
  checkCanvasTools,
  codexApprovalAnswer,
  codexPlanCollaboration,
  codexPolicy,
  codexUserInputAnswer,
  mapCodexNotification,
  modelMessage,
  readCodexRequest,
  type ApprovalDecision,
  type RuntimeEventDraft,
  type RuntimeMode,
} from "@unframed/domain";
import type { AdapterContext, ProviderAdapter, SessionStart, TitleInput, TurnInput } from "../adapter.ts";
import { CodexRpc, CodexRpcError, initializeCodex } from "../codexRpc.ts";
import { MCP_SERVER_NAME } from "../mcp.ts";
import { PermissionGate } from "../permissionGate.ts";
import { ENGINE_VERSION } from "../version.ts";
import { errorText } from "../../log.ts";

export const MCP_TOKEN_VARIABLE = "UNFRAMED_MCP_TOKEN";

/** The launch arguments that give a Codex session the Unframed MCP server, its token read from the environment. */
export const codexMcpArgs = (url: string): string[] => [
  "-c",
  `mcp_servers.${MCP_SERVER_NAME}.url=${url}`,
  "-c",
  `mcp_servers.${MCP_SERVER_NAME}.bearer_token_env_var="${MCP_TOKEN_VARIABLE}"`,
];

interface CodexSession {
  readonly chatId: string;
  readonly rpc: CodexRpc;
  threadId: string;
  runtimeMode: RuntimeMode;
  model: string;
  /** The chat's turn Codex is running, and Codex's own id for it. */
  turnId: string | undefined;
  codexTurnId: string | undefined;
  toolsFailure: string | undefined;
  /** Codex decides its own approvals; the gate only holds the requests and questions it raises. */
  readonly gate: PermissionGate;
  stopping: boolean;
}

const threadIdOf = (result: unknown): string => String((result as { thread?: { id?: unknown } } | undefined)?.thread?.id ?? "");

/**
 * The Codex adapter (spec 07): one `codex app-server` per chat, spoken to in
 * newline-delimited JSON messages. Thread start or resume by id, a turn per message with
 * the runtime mode's policies, approvals and questions turned into requests the person
 * answers, and plan mode as Codex's collaboration mode.
 */
export const codexAdapter = (context: AdapterContext): ProviderAdapter => {
  const sessions = new Map<string, CodexSession>();

  const emit = (chatId: string, draft: RuntimeEventDraft) => context.emit(chatId, draft);

  const onRequest = (chatId: string) => async (method: string, params: unknown): Promise<unknown> => {
    const session = sessions.get(chatId);
    const request = readCodexRequest(method, params);
    switch (request.kind) {
      case "approval":
        if (!session) return codexApprovalAnswer("cancel");
        return codexApprovalAnswer(await session.gate.request({ requestType: request.requestType, detail: request.detail, args: request.args }, session.turnId));
      case "question":
        if (!session) return codexUserInputAnswer({});
        return codexUserInputAnswer((await session.gate.ask(request.questions, session.turnId)) ?? {});
      case "elicitation":
        if (request.server === MCP_SERVER_NAME) return { action: "accept", content: {} };
        throw new CodexRpcError("method not found", -32601);
      case "unknown":
        throw new CodexRpcError("method not found", -32601);
    }
  };

  const onNotification = (chatId: string) => (method: string, params: unknown) => {
    const session = sessions.get(chatId);
    if (!session) return;
    if (method === "turn/started") session.codexTurnId = String((params as { turn?: { id?: unknown } })?.turn?.id ?? session.codexTurnId ?? "");
    const events = mapCodexNotification(method, params, session.turnId);
    for (const event of events) {
      if (event.type === "thread.started") continue;
      emit(chatId, event);
      if (event.type === "turn.completed") {
        session.turnId = undefined;
        session.codexTurnId = undefined;
      }
    }
  };

  /** Checks that the Unframed server started with every tool it registers. */
  const checkTools = async (session: CodexSession): Promise<void> => {
    try {
      const answer = await session.rpc.request<{ data?: Array<{ name?: string; tools?: Record<string, unknown> }> }>("mcpServerStatus/list", {}, 15_000);
      const servers = answer?.data ?? [];
      const tools = servers.flatMap((server) => Object.keys(server.tools ?? {}).map((tool) => `mcp__${server.name ?? ""}__${tool}`));
      const check = checkCanvasTools(context.registeredTools(), tools);
      emit(session.chatId, { type: "session.configured", payload: { tools, foreign: check.foreign, grantedDirectories: [] } });
      session.toolsFailure = check.failure;
    } catch (error) {
      context.log(session.chatId, `codex mcpServerStatus/list: ${errorText(error)}`);
    }
  };

  const threadParams = (input: { projectDir: string; runtimeMode: RuntimeMode; model: string }) => {
    const policy = codexPolicy(input.runtimeMode);
    return {
      cwd: input.projectDir,
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
      approvalsReviewer: policy.approvalsReviewer,
      ...(input.model === "" ? {} : { model: input.model }),
      developerInstructions: AGENT_SYSTEM_PROMPT,
    };
  };

  const stop = (chatId: string) => {
    const session = sessions.get(chatId);
    if (!session) return;
    sessions.delete(chatId);
    session.stopping = true;
    session.gate.cancelAll();
    session.rpc.close();
  };

  return {
    provider: "codex",
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: true },
    async startSession(input: SessionStart) {
      if (!input.environment) throw new Error("Codex has no run environment.");
      const env = { ...input.environment.env, [MCP_TOKEN_VARIABLE]: input.mcp.token };
      let session: CodexSession | undefined;
      const rpc = new CodexRpc({
        executable: input.environment.executable,
        args: ["app-server", ...codexMcpArgs(input.mcp.url)],
        env,
        cwd: input.projectDir,
        onNotification: onNotification(input.chatId),
        onRequest: onRequest(input.chatId),
        onStderr: (line) => context.log(input.chatId, line),
        onExit: (code, signal) => {
          if (!session || session.stopping || sessions.get(input.chatId) !== session) return;
          sessions.delete(input.chatId);
          session.gate.cancelAll();
          emit(input.chatId, { type: "session.exited", payload: { exitKind: "error", detail: `Codex stopped (${code ?? signal}).` } });
        },
      });
      try {
        await initializeCodex(rpc, ENGINE_VERSION);
        const params = threadParams({ projectDir: input.projectDir, runtimeMode: input.runtimeMode, model: input.modelSelection.model });
        const stored = (input.resumeCursor as { threadId?: unknown } | undefined)?.threadId;
        let threadId = "";
        if (typeof stored === "string" && stored !== "") {
          threadId = await rpc
            .request("thread/resume", { threadId: stored, ...params, excludeTurns: true })
            .then(threadIdOf, () => "");
        }
        if (threadId === "") threadId = threadIdOf(await rpc.request("thread/start", params));
        if (threadId === "") throw new Error("Codex did not start a thread.");
        session = {
          chatId: input.chatId,
          rpc,
          threadId,
          runtimeMode: input.runtimeMode,
          model: input.modelSelection.model,
          turnId: undefined,
          codexTurnId: undefined,
          toolsFailure: undefined,
          gate: new PermissionGate((draft) => emit(input.chatId, draft)),
          stopping: false,
        };
        sessions.set(input.chatId, session);
        emit(input.chatId, { type: "session.started", payload: typeof stored === "string" ? { resume: { threadId: stored } } : {} });
        await checkTools(session);
        return { resumeCursor: { threadId } };
      } catch (error) {
        rpc.close();
        throw error;
      }
    },
    async sendTurn(input: TurnInput) {
      const session = sessions.get(input.chatId);
      if (!session) throw new Error("The Codex session is not running.");
      const content = [
        { type: "text", text: modelMessage(input.preamble, input.text) },
        ...input.attachments.filter((attachment) => attachment.kind === "image").map((attachment) => ({ type: "localImage", path: attachment.path })),
      ];
      if (input.steer && session.codexTurnId) {
        await session.rpc.request("turn/steer", { threadId: session.threadId, expectedTurnId: session.codexTurnId, input: content });
        return { turnId: session.turnId ?? input.turnId };
      }
      session.turnId = input.turnId;
      if (session.toolsFailure !== undefined) {
        const failure = session.toolsFailure;
        emit(input.chatId, { type: "turn.started", turnId: input.turnId, payload: {} });
        emit(input.chatId, { type: "turn.completed", turnId: input.turnId, payload: { state: "failed", errorMessage: failure } });
        session.turnId = undefined;
        return { turnId: input.turnId };
      }
      const policy = codexPolicy(session.runtimeMode);
      const model = input.modelSelection.model;
      session.model = model;
      const effort = input.modelSelection.traits.effort;
      const started = await session.rpc.request<{ turn?: { id?: unknown } }>("turn/start", {
        threadId: session.threadId,
        input: content,
        approvalPolicy: policy.approvalPolicy,
        approvalsReviewer: policy.approvalsReviewer,
        sandboxPolicy: policy.sandboxPolicy,
        ...(model === "" ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
        ...(input.interactionMode === "plan" ? { collaborationMode: codexPlanCollaboration(model, effort) } : {}),
      });
      if (started?.turn?.id !== undefined) session.codexTurnId = String(started.turn.id);
      return { turnId: input.turnId, resumeCursor: { threadId: session.threadId } };
    },
    async interruptTurn(chatId: string) {
      const session = sessions.get(chatId);
      if (!session) return;
      session.gate.cancelAll();
      const turnId = session.turnId;
      if (session.codexTurnId) {
        await session.rpc.request("turn/interrupt", { threadId: session.threadId, turnId: session.codexTurnId }, 10_000).catch(() => undefined);
      }
      if (turnId !== undefined && session.turnId === turnId) {
        session.turnId = undefined;
        session.codexTurnId = undefined;
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
      if (session) session.runtimeMode = runtimeMode;
    },
    async rollbackThread(chatId: string, numTurns: number) {
      const session = sessions.get(chatId);
      if (!session || numTurns <= 0) return {};
      await session.rpc.request("thread/rollback", { threadId: session.threadId, numTurns });
      return { resumeCursor: { threadId: session.threadId } };
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
      let text = "";
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => (resolveDone = resolve));
      const rpc = new CodexRpc({
        executable: input.environment.executable,
        args: ["app-server"],
        env: input.environment.env,
        cwd: input.projectDir,
        onNotification: (method, params) => {
          const p = params as { item?: { type?: string; text?: string }; delta?: string };
          if (method === "item/agentMessage/delta" && typeof p.delta === "string") text += p.delta;
          if (method === "item/completed" && p.item?.type === "agentMessage" && typeof p.item.text === "string") text = p.item.text;
          if (method === "turn/completed") resolveDone();
        },
        onRequest: async () => {
          throw new CodexRpcError("method not found", -32601);
        },
      });
      try {
        await initializeCodex(rpc, ENGINE_VERSION);
        const thread = threadIdOf(
          await rpc.request("thread/start", {
            cwd: input.projectDir,
            approvalPolicy: "never",
            sandbox: "read-only",
            ephemeral: true,
            ...(input.modelSelection.model === "" ? {} : { model: input.modelSelection.model }),
            developerInstructions: CHAT_TITLE_SYSTEM_PROMPT,
          }),
        );
        const prompt = chatTitlePrompt(input.firstMessage, input.answer);
        await rpc.request("turn/start", { threadId: thread, input: [{ type: "text", text: prompt }] });
        const timer = new Promise<void>((resolve) => setTimeout(resolve, 60_000).unref());
        await Promise.race([done, timer]);
        return text.trim() === "" ? undefined : text;
      } finally {
        rpc.close();
      }
    },
  };
};
