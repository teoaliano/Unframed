import type { AgentProvider, Chat, ModelSelection, RuntimeMode } from "@unframed/domain";
import type { ProviderAdapter, TurnInput } from "./adapter.ts";
import type { ChatEngine } from "./chatEngine.ts";
import type { RunEnvironment } from "./detection.ts";
import type { McpTokens } from "./mcp.ts";

export const SESSION_IDLE_MS = 10 * 60_000;

interface LiveSession {
  readonly project: string;
  readonly chatId: string;
  readonly adapter: ProviderAdapter;
  readonly token: string;
  readonly engine: ChatEngine;
  idle: NodeJS.Timeout | undefined;
}

export interface ProviderServiceOptions {
  readonly adapterFor: (provider: AgentProvider) => ProviderAdapter;
  readonly tokens: McpTokens;
  readonly mcpUrl: () => string;
  readonly idleMs: number;
  readonly attachmentsDir: string;
  readonly runEnvironment: (provider: AgentProvider) => Promise<RunEnvironment>;
  /** Called when a quiet session closed itself. */
  readonly onIdleClose: (project: string, chatId: string) => void;
}

/**
 * The provider service (spec 07): owns the adapters, routes by the chat's provider, issues
 * the MCP token per session, keeps the resume cursor in `provider_session_runtime`, and
 * closes a session that has been quiet for ten minutes. Operations on one chat's session
 * run one at a time.
 */
export class ProviderService {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly options: ProviderServiceOptions;

  constructor(options: ProviderServiceOptions) {
    this.options = options;
  }

  /** Runs `work` after every earlier operation on the chat's session. */
  serial<T>(chatId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.chains.get(chatId) ?? Promise.resolve()).then(work);
    this.chains.set(
      chatId,
      run.catch(() => undefined),
    );
    return run;
  }

  has(chatId: string): boolean {
    const session = this.sessions.get(chatId);
    return session !== undefined && session.adapter.hasSession(chatId);
  }

  /** The live session's adapter, when there is one. */
  adapter(chatId: string): ProviderAdapter | undefined {
    return this.has(chatId) ? this.sessions.get(chatId)!.adapter : undefined;
  }

  /** Starts the chat's session, or resumes it from its stored cursor. Answers whether it was already live. */
  async ensure(project: string, chat: Chat, projectDir: string, engine: ChatEngine, modelSelection: ModelSelection = chat.modelSelection): Promise<boolean> {
    if (this.has(chat.id)) return true;
    const stale = this.sessions.get(chat.id);
    if (stale) this.forget(stale);
    const provider = chat.modelSelection.provider;
    const adapter = this.options.adapterFor(provider);
    const token = this.options.tokens.issue({ project, chatId: chat.id });
    const runtime = engine.sessionRuntime(chat.id);
    const environment = adapter.provider === "scripted" ? undefined : await this.options.runEnvironment(provider);
    try {
      const started = await adapter.startSession({
        chatId: chat.id,
        projectDir,
        modelSelection,
        runtimeMode: chat.runtimeMode,
        ...(runtime?.resumeCursor === undefined ? {} : { resumeCursor: runtime.resumeCursor }),
        mcp: { url: this.options.mcpUrl(), token },
        attachmentsDir: this.options.attachmentsDir,
        firstMessage: chat.messages.find((message) => message.role === "user")?.text ?? "",
        ...(environment === undefined ? {} : { environment }),
      });
      this.sessions.set(chat.id, { project, chatId: chat.id, adapter, token, engine, idle: undefined });
      engine.writeSessionRuntime(chat.id, {
        provider,
        runtimeMode: chat.runtimeMode,
        status: "running",
        ...(started.resumeCursor === undefined ? {} : { resumeCursor: started.resumeCursor }),
      });
      return false;
    } catch (error) {
      this.options.tokens.revoke(token);
      throw error;
    }
  }

  async sendTurn(chatId: string, input: TurnInput): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) throw new Error("The agent session is not running.");
    this.busy(chatId);
    const sent = await session.adapter.sendTurn(input);
    if (sent.resumeCursor !== undefined) this.saveCursor(chatId, sent.resumeCursor);
  }

  /** Keeps the newest resume cursor, so the next message resumes after an idle close or a restart. */
  saveCursor(chatId: string, resumeCursor: unknown): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const chat = session.engine.chat(chatId);
    session.engine.writeSessionRuntime(chatId, {
      provider: chat?.modelSelection.provider ?? "claude",
      runtimeMode: chat?.runtimeMode ?? "full-access",
      status: "running",
      resumeCursor,
    });
  }

  /** A turn is running: the session does not idle-close. */
  busy(chatId: string): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    clearTimeout(session.idle);
    session.idle = undefined;
  }

  /** The session has no turn and no request: it closes after the idle delay. */
  quiet(chatId: string): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    clearTimeout(session.idle);
    session.idle = setTimeout(() => {
      if (this.sessions.get(chatId) !== session) return;
      void this.serial(chatId, () => this.stop(chatId, "idle")).then(() => this.options.onIdleClose(session.project, chatId));
    }, this.options.idleMs);
    session.idle.unref();
  }

  async interrupt(chatId: string, turnId?: string): Promise<boolean> {
    const session = this.sessions.get(chatId);
    if (!session || !session.adapter.hasSession(chatId)) return false;
    await session.adapter.interruptTurn(chatId, turnId);
    return true;
  }

  async respond(chatId: string, requestId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel"): Promise<void> {
    await this.sessions.get(chatId)?.adapter.respondToRequest(chatId, requestId, decision);
  }

  async answer(chatId: string, requestId: string, answers: Readonly<Record<string, unknown>>): Promise<void> {
    await this.sessions.get(chatId)?.adapter.respondToUserInput(chatId, requestId, answers);
  }

  async setRuntimeMode(chatId: string, mode: RuntimeMode): Promise<void> {
    await this.sessions.get(chatId)?.adapter.setRuntimeMode(chatId, mode);
  }

  async rollback(chatId: string, numTurns: number): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session || numTurns <= 0) return;
    const rolled = await session.adapter.rollbackThread(chatId, numTurns);
    if (rolled.resumeCursor !== undefined) this.saveCursor(chatId, rolled.resumeCursor);
  }

  private forget(session: LiveSession): void {
    clearTimeout(session.idle);
    this.options.tokens.revoke(session.token);
    if (this.sessions.get(session.chatId) === session) this.sessions.delete(session.chatId);
  }

  /** Closes the chat's session and revokes its MCP token. The next message resumes it. */
  async stop(chatId: string, reason: "idle" | "interrupted" | "stopped" | "deleted" | "closed"): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;
    this.forget(session);
    const chat = session.engine.chat(chatId);
    try {
      session.engine.writeSessionRuntime(chatId, {
        provider: chat?.modelSelection.provider ?? "claude",
        runtimeMode: chat?.runtimeMode ?? "full-access",
        status: reason === "idle" ? "stopped" : reason,
      });
    } catch {
      // The project database may already be closed.
    }
    await session.adapter.stopSession(chatId).catch(() => undefined);
  }

  /** Closes every session of a project, for the open-project registry's closer. */
  async stopProject(project: string): Promise<void> {
    const chats = [...this.sessions.values()].filter((session) => session.project === project).map((session) => session.chatId);
    await Promise.all(chats.map((chatId) => this.stop(chatId, "closed")));
    this.options.tokens.revokeProject(project);
  }
}
