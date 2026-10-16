import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import {
  agentShapeId,
  buildPreamble,
  changeNote,
  chatSummary,
  DEFAULT_RUNTIME_MODE,
  classifyToolItem,
  failureSentence,
  openRequests,
  plainText,
  projectSlug,
  QUIT_MID_TURN,
  SEARCH_LIMIT_MAX,
  searchChats,
  selectionLabel,
  shapeKind,
  type ActivityInput,
  type AgentProvider,
  type Chat,
  type ChatCommand,
  type ChatEvent,
  type ClientCommand,
  type InteractionMode,
  type MessageAttachment,
  type ModelSelection,
  type RejectionCode,
  type RuntimeEvent,
  type RuntimeEventDraft,
  type RuntimeMode,
  type SelectedShape,
  type SkippedBy,
  type ThreadSearchMatch,
  type TurnOutcome,
  type ChatProvider,
} from "@unframed/domain";
import type { ArtifactDiffFile } from "@unframed/contracts";
import type { TLRecord } from "@tldraw/tlschema";
import type { Applied, CanvasChange, ChangeLogRow, ChangeOrigin } from "../canvas/rooms.ts";
import { errorText, logError, logInfo } from "../log.ts";
import type { AdapterContext, ProviderAdapter, TurnAttachment } from "./adapter.ts";
import { scriptedAdapter } from "./adapters/scripted.ts";
import { AttachmentStore } from "./attachmentStore.ts";
import { CanvasTools } from "./canvasTools.ts";
import { OutsideChats } from "./outsideChats.ts";
import { outsideSelectionTools } from "./selectionTools.ts";
import { AgentGeneration } from "./agentGeneration.ts";
import { generateArguments, generateTool } from "./generateTool.ts";
import type { ConnectionBook } from "../agentConnections/book.ts";
import type { ImagePricingAnswer, ImageRunRequest, ModelEntry, RunEvent, TextRunRequest, VideoStartRequest } from "@unframed/contracts";

/** What an agent's generation reaches: the run services, pricing, the default model, run events and the ledger. */
export interface GenerationRuns {
  readonly runImage: (request: ImageRunRequest) => Promise<{ runId: string; batchId: string; placeholders: string[] }>;
  readonly runText: (request: TextRunRequest) => Promise<{ runId: string; batchId: string; placeholders: string[] }>;
  readonly pricing: (model: string) => Promise<ImagePricingAnswer>;
  /** The models of a kind, and the default one: the settings' image or video model. */
  readonly models: (kind: "image" | "video") => Promise<ReadonlyArray<ModelEntry>>;
  readonly defaultModel: (kind: "image" | "video") => Promise<string>;
  /** A render job (spec 04) and how it ends (spec 14: an agent's video). */
  readonly startVideo: (request: VideoStartRequest) => Promise<{ jobId: string; status: string; shapeId: string }>;
  readonly onVideoFinished: (jobId: string, handler: (outcome: { ok: boolean; cost: number | null }) => void) => () => void;
  readonly track: (project: string, handler: (event: RunEvent) => void) => () => void;
  readonly book: ConnectionBook;
}
import type { LiveSelection } from "../selection/liveSelection.ts";
import { OUTSIDE_TURN_IDLE_MS } from "@unframed/domain";
import { ChatEngine, CommandRejected } from "./chatEngine.ts";
import type { RunEnvironment } from "./detection.ts";
import { McpTokens, McpToolRegistry, MCP_PATH, type McpBinding, type McpTool, type ToolAnswer } from "./mcp.ts";
import type { AgentToolContext } from "../artifacts/artifactTools.ts";
import { ProviderService, SESSION_IDLE_MS } from "./providerService.ts";
import { writeTurnSidecar } from "./sidecar.ts";
import { planRevert, TurnChanges } from "./turnChanges.ts";
import { artifactDiff } from "./turnDiff.ts";

export interface AgentRuntimeDeps {
  readonly dataDir: string;
  /** The windows' live selection, read and set by outside calls (spec 14). */
  readonly selection: LiveSelection;
  /** The run services and the connection store, for an agent's `generate` (spec 14). */
  readonly generationRuns: GenerationRuns;
  /** The outside turn's idle time; two minutes unless a test shortens it (spec 14). */
  readonly outsideTurnIdleMs?: number;
  readonly testAgentScript: string | undefined;
  readonly idleMs: number | undefined;
  readonly uploadUrlTtlMs: number | undefined;
  readonly agentDebug: boolean;
  /** The project's folder, or `undefined` when there is no such project. */
  readonly projectFolder: (project: string) => Promise<string | undefined>;
  readonly openDatabase: (slug: string) => Promise<DatabaseSync>;
  readonly registerCloser: (slug: string, name: string, close: () => Promise<void>) => Promise<() => void>;
  readonly rooms: {
    readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
    readonly apply: (project: string, change: CanvasChange, origin: ChangeOrigin) => Promise<Applied>;
    readonly clock: (project: string) => Promise<number>;
    readonly changeLog: (project: string, clock: number) => Promise<ReadonlyArray<ChangeLogRow>>;
  };
  readonly runEnvironment: (provider: AgentProvider) => Promise<RunEnvironment>;
  /** The model an empty model setting means: the provider's first non-legacy row. */
  readonly defaultModel: (provider: AgentProvider) => Promise<string | undefined>;
  /** Builds the real provider adapters; the scripted one replaces both under the test variable. */
  readonly realAdapter: (provider: AgentProvider, context: AdapterContext) => ProviderAdapter;
  /** The tools other specs add to the Unframed MCP server (spec 09: the artifact and preview tools). */
  readonly extraTools?: (context: AgentToolContext) => ReadonlyArray<McpTool>;
  /** Told when a chat's provider session closes, for whatever it held open (spec 09's preview tabs). */
  readonly onSessionClosed?: (project: string, chatId: string) => void;
}

/** A dispatch refusal the RPC layer answers as spec 01's error. */
/** A turn's paid runs are counted by chat and turn, so a revert can wait for the ones still landing (spec 14). */
const runKey = (chatId: string, turn: number): string => `${chatId}:${turn}`;

export class DispatchError extends Error {
  readonly code: RejectionCode;
  constructor(code: RejectionCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface ActiveTurn {
  readonly turnId: string;
  readonly turnCount: number;
  readonly interactionMode: InteractionMode;
  readonly startedAt: number;
  /** The model the turn runs on, an empty setting resolved. */
  readonly model: string;
}

/** One project's chats: its store, its turn changes, and the queue its runtime events are taken in. */
class ProjectAgent {
  readonly slug: string;
  readonly folder: string;
  readonly engine: ChatEngine;
  readonly turnChanges: TurnChanges;
  ingestion: Promise<unknown> = Promise.resolve();
  readonly subscriptions = new Set<() => void>();
  closed = false;

  constructor(slug: string, folder: string, db: DatabaseSync) {
    this.slug = slug;
    this.folder = folder;
    this.engine = new ChatEngine(slug, db);
    this.turnChanges = new TurnChanges(db);
  }
}

const serverCommandId = () => `server:${randomUUID()}`;

/** A command without the fields the runtime fills in. */
type Bare<C> = C extends unknown ? Omit<C, "commandId" | "projectId" | "threadId"> : never;

const record = (value: unknown): Record<string, any> => (typeof value === "object" && value !== null ? (value as Record<string, any>) : {});

/**
 * The agent runtime (spec 07): the chat store of every open project, the reactors that run
 * its side effects, the provider service, the MCP server's tools and the attachment store.
 * Reactors run after an intent is committed and report back through more commands.
 */
export class AgentRuntime {
  readonly tokens = new McpTokens();
  readonly registry = new McpToolRegistry();
  /** The outside calls: an outside session's chat and turn in each project (spec 14). */
  readonly outside: OutsideChats;
  /** The tools only an outside connection has, after the registry's (spec 14). */
  readonly outsideTools: McpTool[];
  private readonly generation: AgentGeneration;
  readonly attachments: AttachmentStore;
  readonly providers: ProviderService;
  private readonly projects = new Map<string, Promise<ProjectAgent>>();
  private readonly chatProjects = new Map<string, string>();
  private readonly activeTurns = new Map<string, ActiveTurn>();
  /** The paid runs each in-app or outside turn still has landing, by chat and turn (spec 14). */
  private readonly paidRuns = new Map<string, number>();
  private readonly adapters = new Map<AgentProvider, ProviderAdapter>();
  /** The project agents that finished opening. */
  private readonly settledAgents = new Map<string, ProjectAgent>();
  private apiPort = 0;
  private readonly deps: AgentRuntimeDeps;

  constructor(deps: AgentRuntimeDeps) {
    this.deps = deps;
    this.attachments = new AttachmentStore(deps.dataDir, deps.uploadUrlTtlMs);
    const context: AgentToolContext = {
      read: (project) => deps.rooms.read(project),
      apply: (project, change, origin) => deps.rooms.apply(project, change, origin),
      folder: async (project) => (await this.project(project)).folder,
      turnChanges: async (project) => (await this.project(project)).turnChanges,
      chatTurn: (project, chatId) => this.chatTurn(project, chatId),
      isOutside: (project, chatId) => this.settledAgents.get(projectSlug(project))?.engine.chat(chatId)?.outside !== undefined,
      liveSelection: (project) => deps.selection.current(projectSlug(project)),
      tag: (project, chatId, ids) => void this.tag(project, chatId, ids),
      activity: (project, chatId, activity) =>
        void this.project(project).then(
          (agent) => this.activity(agent, chatId, activity),
          () => undefined,
        ),
    };
    for (const tool of new CanvasTools(context).tools()) this.registry.register(tool);
    // Outside calls only: `canvas_select` never reaches an in-app agent (spec 07, spec 14).
    this.generation = new AgentGeneration({
      records: (project) => deps.rooms.read(project),
      recordsOf: async (project, ids) => {
        const byId = new Map((await deps.rooms.read(project)).map((record) => [record.id as string, record]));
        return new Map(ids.map((id) => [id, byId.get(id)]));
      },
      runImage: (request) => deps.generationRuns.runImage(request),
      runText: (request) => deps.generationRuns.runText(request),
      pricing: (model) => deps.generationRuns.pricing(model),
      models: (kind) => deps.generationRuns.models(kind),
      defaultModel: (kind) => deps.generationRuns.defaultModel(kind),
      startVideo: (request) => deps.generationRuns.startVideo(request),
      onVideoFinished: (jobId, handler) => deps.generationRuns.onVideoFinished(jobId, handler),
      track: (project, handler) => deps.generationRuns.track(project, handler),
      book: deps.generationRuns.book,
      recordTurn: async (project, chatId, turn, before, after) => {
        const agent = await this.project(project);
        agent.turnChanges.record(chatId, turn, before, after, await deps.rooms.clock(project));
      },
      holds: {
        runStarted: (chatId, turn) => {
          this.paidRuns.set(runKey(chatId, turn), (this.paidRuns.get(runKey(chatId, turn)) ?? 0) + 1);
          this.outside.runStarted(chatId);
        },
        runEnded: (chatId, turn) => {
          const remaining = (this.paidRuns.get(runKey(chatId, turn)) ?? 1) - 1;
          if (remaining > 0) this.paidRuns.set(runKey(chatId, turn), remaining);
          else this.paidRuns.delete(runKey(chatId, turn));
          this.outside.runEnded(chatId);
        },
      },
      activity: async (project, chatId, draft) => {
        const agent = await this.project(project);
        await this.activity(agent, chatId, {
          id: `${draft.kind}:${randomUUID()}`,
          tone: "info",
          kind: draft.kind,
          summary: draft.summary,
          payload: draft.payload,
          turnId: draft.turnId,
          createdAt: new Date().toISOString(),
        });
      },
    });
    this.outsideTools = [...outsideSelectionTools({ hub: deps.selection, read: (project) => deps.rooms.read(project) })];
    this.outside = new OutsideChats(
      {
        agent: (slug) => this.project(slug),
        command: (agent, chatId, command) => this.internal(agent as ProjectAgent, chatId, command).then(() => undefined),
        activity: (agent, chatId, activity) => this.activity(agent as ProjectAgent, chatId, activity).then(() => undefined),
        clock: (slug) => deps.rooms.clock(slug).catch(() => null),
        changeLog: (slug, since) => deps.rooms.changeLog(slug, since),
      },
      deps.outsideTurnIdleMs ?? OUTSIDE_TURN_IDLE_MS,
    );
    for (const tool of deps.extraTools?.(context) ?? []) this.registry.register(tool);
    // In-app and outside agents both have `generate`; an outside call's own check (its connection's limit) is the only difference (spec 14).
    this.registry.register(generateTool((binding, args) => this.generateFor(binding, args)));
    this.providers = new ProviderService({
      adapterFor: (provider) => this.adapterFor(provider),
      tokens: this.tokens,
      mcpUrl: () => `http://127.0.0.1:${this.apiPort}${MCP_PATH}`,
      idleMs: deps.idleMs ?? SESSION_IDLE_MS,
      attachmentsDir: this.attachments.folder,
      runEnvironment: deps.runEnvironment,
      onIdleClose: (project, chatId) => void this.idleClosed(project, chatId),
      ...(deps.onSessionClosed === undefined ? {} : { onClosed: deps.onSessionClosed }),
    });
  }

  setApiPort(port: number): void {
    this.apiPort = port;
  }

  private adapterContext(): AdapterContext {
    return {
      emit: (chatId, draft) => this.onRuntimeEvent(chatId, draft),
      runtimeMode: (chatId) => this.runtimeModeOf(chatId),
      registeredTools: () => this.registry.names(),
      generationDetail: (chatId, input) => this.generationDetail(chatId, input),
      log: (chatId, line) => {
        if (this.deps.agentDebug) logInfo(`[agent ${chatId}] ${line}`);
      },
      dataDir: this.deps.dataDir,
    };
  }

  /** The provider a runtime event names. An outside chat has no adapter, so its events name Claude as they always did. */
  private eventProvider(provider: ChatProvider | undefined): ProviderAdapter["provider"] {
    return this.adapterFor(provider === undefined || provider === "outside" ? "claude" : provider).provider;
  }

  private adapterFor(provider: AgentProvider): ProviderAdapter {
    const key: AgentProvider = this.deps.testAgentScript !== undefined ? "claude" : provider;
    let adapter = this.adapters.get(key);
    if (!adapter) {
      adapter =
        this.deps.testAgentScript !== undefined
          ? scriptedAdapter(this.deps.testAgentScript, this.adapterContext())
          : this.deps.realAdapter(provider, this.adapterContext());
      this.adapters.set(key, adapter);
    }
    return adapter;
  }

  private runtimeModeOf(chatId: string): RuntimeMode {
    const project = this.chatProjects.get(chatId);
    const agent = project === undefined ? undefined : this.settledAgents.get(project);
    return agent?.engine.chat(chatId)?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  }


  /**
   * What a project's chats are doing now (spec 17): chats with a turn running, and chats waiting on
   * the person. Reads only a chat store that is already open, so a closed project costs nothing.
   */
  liveActivity(name: string): { readonly running: number; readonly needsYou: number } {
    const agent = this.settledAgents.get(projectSlug(name));
    if (agent === undefined) return { running: 0, needsYou: 0 };
    let running = 0;
    let needsYou = 0;
    for (const chat of Object.values(agent.engine.model.chats)) {
      if (chat.deletedAt !== null) continue;
      const summary = chatSummary(chat);
      if (summary.status === "running") running++;
      if (summary.hasPendingApproval || summary.hasPendingUserInput || summary.hasActionableProposedPlan) needsYou++;
    }
    return { running, needsYou };
  }

  /** Opens a project's chat store on first use, reconciling chats a quit left running. */
  project(name: string): Promise<ProjectAgent> {
    const slug = projectSlug(name);
    const known = this.projects.get(slug);
    if (known) return known;
    const opening = (async () => {
      const folder = await this.deps.projectFolder(slug);
      const exists = folder !== undefined && (await stat(folder).then((info) => info.isDirectory(), () => false));
      if (!exists || folder === undefined) throw new DispatchError("not_found", `There is no project named "${slug}".`);
      const db = await this.deps.openDatabase(slug);
      const agent = new ProjectAgent(slug, folder, db);
      for (const chat of Object.values(agent.engine.model.chats)) this.chatProjects.set(chat.id, slug);
      agent.engine.onCommit((events) => this.react(agent, events));
      await this.deps.registerCloser(slug, "chat store", () => this.closeProject(agent));
      this.settledAgents.set(slug, agent);
      await this.reconcile(agent);
      return agent;
    })();
    this.projects.set(slug, opening);
    opening.catch(() => {
      if (this.projects.get(slug) === opening) this.projects.delete(slug);
    });
    return opening;
  }

  private async closeProject(agent: ProjectAgent): Promise<void> {
    // Rename, delete, a folder move and shutdown all close the project: its open outside turns settle first (spec 14).
    await this.outside.settleOpen(agent).catch((error: unknown) => logError(`outside turns of ${agent.slug}: ${errorText(error)}`));
    agent.closed = true;
    if (this.settledAgents.get(agent.slug) === agent) {
      this.settledAgents.delete(agent.slug);
      this.projects.delete(agent.slug);
    }
    for (const stop of [...agent.subscriptions]) stop();
    await this.providers.stopProject(agent.slug);
    await agent.engine.settled().catch(() => undefined);
    agent.engine.close();
  }

  /** At open, a chat whose turn was running when the engine stopped reads as failed with the quit-mid-turn sentence. */
  private async reconcile(agent: ProjectAgent): Promise<void> {
    for (const chat of Object.values(agent.engine.model.chats)) {
      if (chat.deletedAt !== null) continue;
      const running = chat.latestTurn?.state === "running" || chat.session?.status === "starting" || chat.session?.status === "running";
      if (!running || this.providers.has(chat.id)) continue;
      if (chat.outside !== undefined) {
        // An outside turn was not cut off by Unframed: the agent just stopped being heard, so it settles as completed (spec 14).
        await this.outside.settle(agent, chat.id);
        if (agent.engine.chat(chat.id)?.session?.status === "running") {
          await this.internal(agent, chat.id, { type: "thread.session.set", session: { status: "ready", activeTurnId: null, lastError: null } });
        }
        continue;
      }
      await this.clearRequests(agent, chat);
      if (chat.latestTurn?.state === "running") {
        await this.settle(agent, chat.id, { state: "failed", errorMessage: QUIT_MID_TURN });
      } else {
        await this.internal(agent, chat.id, { type: "thread.session.set", session: { status: "error", activeTurnId: null, lastError: QUIT_MID_TURN } });
      }
    }
  }

  private async clearRequests(agent: ProjectAgent, chat: Chat): Promise<void> {
    const now = new Date().toISOString();
    for (const request of openRequests(chat, "approval")) {
      await this.activity(agent, chat.id, {
        id: `cleared:${randomUUID()}`,
        tone: "approval",
        kind: "approval.resolved",
        summary: "Approval resolved",
        payload: { requestId: record(request.payload).requestId, decision: "cancel" },
        turnId: request.turnId,
        createdAt: now,
      });
    }
    for (const question of openRequests(chat, "user-input")) {
      await this.activity(agent, chat.id, {
        id: `cleared:${randomUUID()}`,
        tone: "info",
        kind: "user-input.resolved",
        summary: "Question cancelled",
        payload: { requestId: record(question.payload).requestId, answers: {}, cancelled: true },
        turnId: question.turnId,
        createdAt: now,
      });
    }
  }


  /** A session of an outside client ended: its open turns settle, and its chats say so (spec 14). */
  endOutsideSession(sessionId: string): Promise<void> {
    return this.outside.endSession(sessionId, [...this.settledAgents.values()]);
  }

  /** A connection was revoked: its chats' open turns settle, and each says it is disconnected (spec 14). */
  disconnectOutside(connectionId: string): Promise<void> {
    return this.outside.disconnect(connectionId, [...this.settledAgents.values()]);
  }

  /** Dispatches a command the web sent: attachments and tags are resolved against the files and the canvas first. */
  async dispatch(command: ClientCommand): Promise<{ sequence: number }> {
    const agent = await this.project(command.projectId);
    // An in-app turn cannot be reverted while one of its paid generations is still landing (spec 14).
    if (command.type === "thread.turn.revert" && agent.engine.chat(command.threadId)?.outside === undefined && (this.paidRuns.get(runKey(command.threadId, command.turnCount)) ?? 0) > 0) {
      throw new DispatchError("conflict", "Wait for the generation to land before reverting.");
    }
    // Reverting an open outside turn settles it first, then reverts it (spec 14). The web cannot stop an outside agent.
    if (command.type === "thread.turn.revert" && agent.engine.chat(command.threadId)?.outside !== undefined) {
      await this.outside.settle(agent, command.threadId);
    }
    let resolved: ChatCommand = command;
    if (command.type === "thread.turn.start") {
      const attachments: Array<MessageAttachment | { id: string; name: string }> = [];
      for (const ref of command.message.attachments) {
        const stored = await this.attachments.resolve(ref);
        attachments.push(stored ?? { id: ref.id, name: ref.name });
      }
      resolved = { ...command, message: { ...command.message, attachments } };
    } else if (command.type === "thread.create" && command.tags !== undefined) {
      resolved = { ...command, tags: await this.artifactsAmong(agent.slug, command.tags) };
    } else if (command.type === "thread.tags.add") {
      const ids = await this.artifactsAmong(agent.slug, command.ids);
      if (ids.length === 0) throw new DispatchError("not_found", "That artifact is no longer on the canvas.");
      resolved = { ...command, ids };
    }
    try {
      const answer = await agent.engine.dispatch(resolved, { actor: "client" });
      if (command.type === "thread.create") this.chatProjects.set(command.threadId, agent.slug);
      return answer;
    } catch (error) {
      if (error instanceof CommandRejected) throw new DispatchError(error.code, error.message);
      throw error;
    }
  }

  /** An internal command; a refusal is logged, never thrown. */
  private async internal(agent: ProjectAgent, chatId: string, command: Bare<ChatCommand>): Promise<boolean> {
    if (agent.closed) return false;
    try {
      await agent.engine.dispatch({ ...command, commandId: serverCommandId(), projectId: agent.slug, threadId: chatId } as ChatCommand, { actor: "server" });
      return true;
    } catch (error) {
      if (!(error instanceof CommandRejected)) logError(`chat ${chatId}: ${command.type} failed: ${errorText(error)}`);
      return false;
    }
  }

  private activity(agent: ProjectAgent, chatId: string, activity: ActivityInput) {
    return this.internal(agent, chatId, { type: "thread.activity.append", activity });
  }

  private async artifactsAmong(project: string, ids: ReadonlyArray<string>): Promise<string[]> {
    const records = await this.deps.rooms.read(project);
    const artifacts = new Set(records.filter((item) => item.typeName === "shape" && (item.type === "page" || item.type === "motion")).map((item) => item.id as string));
    return ids.filter((id) => artifacts.has(id));
  }

  /** The tag reactor: adds the ids the chat does not have yet. Adding one it has is a no-op. */
  private async tag(project: string, chatId: string, ids: ReadonlyArray<string>): Promise<void> {
    const agent = await this.project(project);
    const chat = agent.engine.chat(chatId);
    const fresh = ids.filter((id) => !chat?.tags.includes(id));
    if (fresh.length > 0) await this.internal(agent, chatId, { type: "thread.tags.add", ids: fresh });
  }

  /** An outside call of `generate`: its open turn, and the checked arguments (spec 14). */
  private async generateFor(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const checked = generateArguments(args);
    if (!checked.ok) return { value: { error: checked.message }, isError: true };
    const turn = this.chatTurn(binding.project, binding.chatId).turnCount;
    if (turn === undefined) return { value: { error: "Unframed could not open a turn for this call. Try again." }, isError: true };
    const turnId = this.chatTurn(binding.project, binding.chatId).turnId ?? null;
    return this.generation.generate({ project: binding.project, chatId: binding.chatId, turn, turnId, connectionId: binding.connectionId, ...checked });
  }

  /** What an in-app `generate`'s approval says: the medium, the shapes and the estimate, from a dry run (spec 14). */
  private async generationDetail(chatId: string, input: Readonly<Record<string, unknown>>): Promise<string | undefined> {
    const project = this.chatProjects.get(chatId);
    const checked = generateArguments(input);
    if (project === undefined || !checked.ok) return undefined;
    const answer = await this.generation.generate({ project, chatId, turn: 0, turnId: null, ...checked, dryRun: true });
    const value = answer.value as { dryRun?: boolean; estimate?: string | null };
    if (answer.isError || value.dryRun !== true) return undefined;
    const what = checked.medium === "video" ? "a video" : checked.medium === "text" ? "a text answer" : checked.runs === 1 ? "an image" : `${checked.runs} images`;
    const shapes = checked.sources.length === 1 ? "1 shape" : `${checked.sources.length} shapes`;
    return `Generate ${what} from ${shapes}, ${value.estimate ?? "with no exact estimate"}.`;
  }

  private chatTurn(project: string, chatId: string) {
    const chat = this.settledAgents.get(projectSlug(project))?.engine.chat(chatId);
    const active = this.activeTurns.get(chatId);
    const latestUser = [...(chat?.messages ?? [])].reverse().find((message) => message.role === "user");
    return {
      turnCount: chat?.latestTurn?.state === "running" ? chat.latestTurn.turnCount : active?.turnCount,
      turnId: chat?.latestTurn?.state === "running" ? chat.latestTurn.turnId : active?.turnId,
      interactionMode: active?.interactionMode ?? chat?.interactionMode ?? "default",
      selection: latestUser?.context?.selection ?? [],
    };
  }


  private react(agent: ProjectAgent, events: ReadonlyArray<ChatEvent>): void {
    for (const event of events) {
      const p = record(event.payload);
      const chatId = event.aggregateId;
      switch (event.type) {
        case "thread.created":
          this.chatProjects.set(chatId, agent.slug);
          break;
        case "thread.turn-start-requested":
          void this.providers.serial(chatId, () => this.startTurn(agent, chatId, p));
          break;
        case "thread.turn-interrupt-requested":
          void this.providers.serial(chatId, () => this.interrupt(agent, chatId));
          break;
        case "thread.approval-response-requested":
          void this.providers.respond(chatId, String(p.requestId), p.decision);
          break;
        case "thread.user-input-response-requested":
          void this.providers.answer(chatId, String(p.requestId), record(p.answers));
          break;
        case "thread.runtime-mode-set":
          void this.providers.setRuntimeMode(chatId, p.runtimeMode);
          break;
        case "thread.session-stop-requested":
          void this.providers.serial(chatId, async () => {
            await this.providers.stop(chatId, "stopped");
            await this.internal(agent, chatId, { type: "thread.session.set", session: { status: "stopped", activeTurnId: null, lastError: null } });
          });
          break;
        case "thread.deleted":
          void this.providers.serial(chatId, () => this.providers.stop(chatId, "deleted"));
          break;
        case "thread.turn-revert-requested":
          void this.providers.serial(chatId, () => this.revertTurn(agent, chatId, Number(p.turnCount)));
          break;
        case "thread.checkpoint-revert-requested":
          void this.providers.serial(chatId, () =>
            this.revertToCheckpoint(agent, chatId, {
              keep: Number(p.turnCount),
              restoreCanvas: p.restoreCanvas === true,
              dropped: Number(p.dropped ?? 0),
              revertTurns: Array.isArray(p.revertTurns) ? p.revertTurns.map(Number) : [],
            }),
          );
          break;
        default:
          break;
      }
    }
  }

  /** The provider command reactor: builds the preamble, starts or reuses the session, sends the turn. */
  private async startTurn(agent: ProjectAgent, chatId: string, requested: Record<string, any>): Promise<void> {
    const chat = agent.engine.chat(chatId);
    if (!chat) return;
    const message = chat.messages.find((known) => known.id === requested.messageId);
    const steer = requested.steer === true;
    const selection = await this.resolveModel((requested.modelSelection as ModelSelection | undefined) ?? chat.modelSelection);
    if (!steer) {
      this.activeTurns.set(chatId, {
        turnId: String(requested.turnId),
        turnCount: Number(requested.turnCount),
        interactionMode: requested.interactionMode,
        startedAt: Date.now(),
        model: selection.model,
      });
      if (Number(requested.turnCount) === 1 && message?.context?.selection.length) {
        await this.tag(agent.slug, chatId, await this.artifactsAmong(agent.slug, message.context.selection));
      }
    }
    try {
      const records = await this.deps.rooms.read(agent.slug);
      const preamble = await this.preamble(agent, chat, message?.context?.selection ?? [], message?.attachments ?? [], records);
      const live = this.providers.has(chatId);
      if (!live) await this.internal(agent, chatId, { type: "thread.session.set", session: { status: "starting", activeTurnId: String(requested.turnId), lastError: null } });
      await this.providers.ensure(agent.slug, agent.engine.chat(chatId) ?? chat, agent.folder, agent.engine, selection);
      await this.providers.sendTurn(chatId, {
        chatId,
        turnId: String(requested.turnId),
        turnCount: Number(requested.turnCount),
        text: message?.text ?? "",
        preamble,
        attachments: (message?.attachments ?? []).flatMap((attachment): TurnAttachment[] => {
          const path = this.attachments.path(attachment.id);
          return path === undefined ? [] : [{ ...attachment, path }];
        }),
        modelSelection: selection,
        interactionMode: requested.interactionMode ?? chat.interactionMode,
        steer,
      });
    } catch (error) {
      const text = errorText(error);
      logError(`chat ${chatId}: could not start the turn: ${text}`);
      await this.activity(agent, chatId, {
        id: `start-failed:${randomUUID()}`,
        tone: "error",
        kind: "provider.turn.start.failed",
        summary: "The agent could not start",
        payload: { message: text },
        turnId: String(requested.turnId),
        createdAt: new Date().toISOString(),
      });
      await this.settle(agent, chatId, { state: "failed", errorMessage: text });
    }
  }

  /** A selection with an empty model resolved to the provider's first non-legacy one. */
  private async resolveModel(selection: ModelSelection): Promise<ModelSelection> {
    if (selection.model !== "" || selection.provider === "outside") return selection;
    const model = await this.deps.defaultModel(selection.provider).catch(() => undefined);
    return model === undefined ? selection : { ...selection, model };
  }

  /** What the model is told before the person's message. */
  private async preamble(
    agent: ProjectAgent,
    chat: Chat,
    selection: ReadonlyArray<string>,
    attachments: ReadonlyArray<MessageAttachment>,
    records: ReadonlyArray<TLRecord>,
  ): Promise<string> {
    const byId = new Map(records.map((item) => [item.id as string, item]));
    const selected: SelectedShape[] = [];
    for (const id of selection) {
      const shape = byId.get(id);
      if (!shape || shape.typeName !== "shape") continue;
      const props = record(shape.props);
      const asset = typeof props.assetId === "string" ? byId.get(props.assetId) : undefined;
      selected.push({
        kind: shapeKind(shape.type),
        id: agentShapeId(id),
        label: selectionLabel({
          ...(typeof props.title === "string" ? { title: props.title } : {}),
          ...(typeof props.fileName === "string" ? { fileName: props.fileName } : typeof record(record(asset).props).name === "string" ? { fileName: record(record(asset).props).name } : {}),
          ...(props.richText !== undefined ? { text: plainText(props.richText) } : {}),
        }),
      });
    }
    let note: string | undefined;
    if (chat.lastClock !== null) {
      note = changeNote(await this.deps.rooms.changeLog(agent.slug, chat.lastClock), chat.id);
    }
    return buildPreamble({
      selected,
      changeNote: note,
      attachments: attachments.flatMap((attachment) => {
        const path = this.attachments.path(attachment.id);
        return path === undefined ? [] : [{ kind: attachment.kind, name: attachment.name, path }];
      }),
    });
  }

  private async interrupt(agent: ProjectAgent, chatId: string): Promise<void> {
    const chat = agent.engine.chat(chatId);
    if (chat?.latestTurn?.state !== "running") return;
    const interrupted = await this.providers.interrupt(chatId, chat.latestTurn.turnId).catch(() => false);
    if (!interrupted) {
      await this.clearRequests(agent, chat);
      await this.settle(agent, chatId, { state: "interrupted" });
    }
  }

  private async idleClosed(project: string, chatId: string): Promise<void> {
    const agent = this.settledAgents.get(project);
    if (!agent) return;
    await this.internal(agent, chatId, { type: "thread.session.set", session: { status: "stopped", activeTurnId: null, lastError: null } });
  }


  private onRuntimeEvent(chatId: string, draft: RuntimeEventDraft): void {
    const project = this.chatProjects.get(chatId);
    const agent = project === undefined ? undefined : this.settledAgents.get(project);
    if (!agent) return;
    const event: RuntimeEvent = {
      ...draft,
      eventId: randomUUID(),
      provider: this.eventProvider(agent.engine.chat(chatId)?.modelSelection.provider),
      threadId: chatId,
      createdAt: new Date().toISOString(),
    };
    agent.ingestion = agent.ingestion.then(() => this.ingest(agent, event)).catch((error: unknown) => logError(`chat ${chatId}: ${errorText(error)}`));
  }

  /** Turns one canonical runtime event into internal commands. */
  private async ingest(agent: ProjectAgent, event: RuntimeEvent): Promise<void> {
    const chatId = event.threadId;
    const chat = agent.engine.chat(chatId);
    if (!chat || chat.deletedAt !== null) return;
    const p = record(event.payload);
    const turnId = event.turnId ?? chat.latestTurn?.turnId ?? null;
    const now = event.createdAt;
    const activity = (tone: ActivityInput["tone"], kind: string, summary: string, payload: unknown) =>
      this.activity(agent, chatId, { id: event.eventId, tone, kind, summary, payload, turnId, createdAt: now });
    switch (event.type) {
      case "session.started":
        await activity("info", "session.started", "Session started", { resumed: p.resume !== undefined });
        return;
      case "session.configured":
        await activity("info", "session.configured", "Session configured", p);
        return;
      case "thread.started":
        if (p.resumeCursor !== undefined) this.providers.saveCursor(chatId, p.resumeCursor);
        return;
      case "thread.token-usage.updated":
        await activity("info", "context-window.updated", "Context window updated", p);
        return;
      case "turn.started":
        await this.internal(agent, chatId, { type: "thread.session.set", session: { status: "running", activeTurnId: turnId, lastError: null } });
        return;
      case "turn.completed":
      case "turn.aborted":
        await this.settle(agent, chatId, {
          state: event.type === "turn.aborted" ? "interrupted" : ((p.state as TurnOutcome | undefined) ?? "completed"),
          ...(typeof p.errorSubtype === "string" ? { errorSubtype: p.errorSubtype } : {}),
          ...(typeof p.errorMessage === "string" ? { errorMessage: p.errorMessage } : {}),
          ...(p.usage !== undefined ? { usage: p.usage } : {}),
          ...(typeof p.totalCostUsd === "number" ? { totalCostUsd: p.totalCostUsd } : {}),
        });
        return;
      case "turn.plan.updated":
        await activity("info", "turn.plan.updated", "Plan updated", p);
        return;
      case "turn.proposed.delta":
        return;
      case "turn.proposed.completed": {
        const planMarkdown = typeof p.planMarkdown === "string" ? p.planMarkdown.trim() : "";
        const turn = chat.turns.find((known) => known.turnId === turnId) ?? chat.turns.at(-1);
        if (planMarkdown === "" || !turn) return;
        await this.internal(agent, chatId, { type: "thread.proposed-plan.upsert", planId: `plan:${chatId}:turn:${turn.turnCount}`, turnId: turn.turnId, planMarkdown });
        return;
      }
      case "content.delta": {
        const delta = typeof p.delta === "string" ? p.delta : "";
        if (delta === "") return;
        const itemId = event.itemId ?? turnId ?? "message";
        if (p.streamKind === "assistant_text") {
          await this.internal(agent, chatId, { type: "thread.message.assistant.delta", messageId: `assistant:${itemId}`, turnId, delta });
        } else if (p.streamKind === "reasoning_text" || p.streamKind === "reasoning_summary_text") {
          await this.internal(agent, chatId, { type: "thread.message.reasoning.delta", messageId: `reasoning:${itemId}`, turnId, delta });
        }
        return;
      }
      case "item.started":
      case "item.updated":
      case "item.completed": {
        const itemType = String(p.itemType ?? classifyToolItem(String(p.title ?? "")));
        if (itemType === "assistant_message") {
          if (event.type !== "item.completed") return;
          const messageId = `assistant:${event.itemId ?? turnId}`;
          if (!chat.messages.some((message) => message.id === messageId) && typeof p.text !== "string") return;
          await this.internal(agent, chatId, { type: "thread.message.assistant.complete", messageId, turnId, ...(typeof p.text === "string" ? { text: p.text } : {}) });
          return;
        }
        if (itemType === "reasoning") {
          if (event.type !== "item.completed") return;
          const messageId = `reasoning:${event.itemId ?? turnId}`;
          if (!chat.messages.some((message) => message.id === messageId) && typeof p.text !== "string") return;
          await this.internal(agent, chatId, { type: "thread.message.reasoning.complete", messageId, turnId, ...(typeof p.text === "string" ? { text: p.text } : {}) });
          return;
        }
        const kind = event.type === "item.started" ? "tool.started" : event.type === "item.updated" ? "tool.updated" : "tool.completed";
        await activity("tool", kind, String(p.title ?? itemType), { itemId: event.itemId, ...p, itemType });
        return;
      }
      case "request.opened":
        this.providers.busy(chatId);
        await activity("approval", "approval.requested", "Approval requested", { requestId: event.requestId, ...p });
        return;
      case "request.resolved":
        await activity("approval", "approval.resolved", "Approval resolved", { requestId: event.requestId, ...p });
        return;
      case "user-input.requested":
        await activity("info", "user-input.requested", "User input requested", { requestId: event.requestId, ...p });
        return;
      case "user-input.resolved":
        await activity("info", "user-input.resolved", "User input submitted", { requestId: event.requestId, ...p });
        return;
      case "task.started":
      case "task.progress":
      case "task.completed":
        await activity("info", event.type, String(p.title ?? p.description ?? "Task"), p);
        return;
      case "account.rate-limits.updated":
        await activity(p.status === "rejected" ? "error" : "info", "rate-limit", "Usage limit", {
          status: p.status,
          ...(typeof p.resetsAt === "string" ? { resetsAt: p.resetsAt } : {}),
        });
        return;
      case "runtime.retry":
        await activity("info", "retry", "Retrying", { attempt: p.attempt, maxRetries: p.maxRetries, delayMs: p.delayMs, status: p.status });
        return;
      case "runtime.warning":
        await activity("info", "runtime.warning", String(p.message ?? "Warning").slice(0, 120), p);
        return;
      case "runtime.error":
        await activity("error", "runtime.error", "Runtime error", p);
        return;
      case "session.exited":
        void this.providers.serial(chatId, () => this.providers.stop(chatId, "closed"));
        if (chat.latestTurn?.state === "running") {
          await this.clearRequests(agent, chat);
          await this.settle(agent, chatId, { state: "failed", errorMessage: typeof p.detail === "string" ? p.detail : "The agent session ended unexpectedly." });
        }
        return;
      case "session.state.changed":
        return;
    }
  }

  /**
   * The turn settle reactor: a failure sentence below what the agent said, `lastClock`, the
   * turn's files, the sidecar, then the session leaving `running`, which settles the turn.
   * The chat's first completed turn then asks for a title.
   */
  private async settle(
    agent: ProjectAgent,
    chatId: string,
    outcome: { state: TurnOutcome; errorSubtype?: string; errorMessage?: string; usage?: unknown; totalCostUsd?: number },
  ): Promise<void> {
    const chat = agent.engine.chat(chatId);
    const turn = chat?.latestTurn;
    if (!chat || !turn || turn.state !== "running") return;
    const failed = outcome.state === "failed";
    const interrupted = outcome.state === "interrupted" || outcome.state === "cancelled";
    let sentence: string | undefined;
    if (failed) {
      sentence = failureSentence({ subtype: outcome.errorSubtype, message: outcome.errorMessage });
      const current = [...chat.messages].reverse().find((message) => message.role === "assistant" && message.turnId === turn.turnId);
      const messageId = current?.id ?? `assistant:${turn.turnId}:failure`;
      const lead = current !== undefined && current.text.trim() !== "" ? "\n\n" : "";
      await this.internal(agent, chatId, { type: "thread.message.assistant.delta", messageId, turnId: turn.turnId, delta: `${lead}${sentence}` });
      await this.internal(agent, chatId, { type: "thread.message.assistant.complete", messageId, turnId: turn.turnId });
    }
    for (const message of agent.engine.chat(chatId)?.messages ?? []) {
      if (message.streaming && message.turnId === turn.turnId) {
        await this.internal(agent, chatId, {
          type: message.role === "reasoning" ? "thread.message.reasoning.complete" : "thread.message.assistant.complete",
          messageId: message.id,
          turnId: turn.turnId,
        });
      }
    }
    const clock = await this.deps.rooms.clock(agent.slug).catch(() => null);
    await this.internal(agent, chatId, { type: "thread.turn.settle", turnCount: turn.turnCount, clock, ...(outcome.usage === undefined ? {} : { usage: outcome.usage }) });
    await this.internal(agent, chatId, { type: "thread.turn.files.complete", turnCount: turn.turnCount, files: agent.turnChanges.files(chatId, turn.turnCount) });
    const active = this.activeTurns.get(chatId);
    await writeTurnSidecar(agent.folder, {
      chatId,
      turn: turn.turnCount,
      provider: chat.modelSelection.provider,
      model: active?.turnId === turn.turnId ? active.model : chat.modelSelection.model,
      usage: outcome.usage ?? {},
      ...(outcome.totalCostUsd === undefined ? {} : { estimatedUsd: outcome.totalCostUsd }),
      ...(active?.turnId === turn.turnId ? { durationMs: Date.now() - active.startedAt } : {}),
    }).catch((error: unknown) => logError(`chat ${chatId}: could not write the turn sidecar: ${errorText(error)}`));
    await this.internal(agent, chatId, {
      type: "thread.session.set",
      session: { status: failed ? "error" : interrupted ? "interrupted" : "ready", activeTurnId: null, lastError: sentence ?? null },
    });
    if (active?.turnId === turn.turnId) this.activeTurns.delete(chatId);
    // An interrupt is a hard stop, and a session that ended on its own must not keep its token.
    if (interrupted || !this.providers.has(chatId)) {
      void this.providers.serial(chatId, () => this.providers.stop(chatId, interrupted ? "interrupted" : "closed"));
    } else {
      this.providers.quiet(chatId);
    }
    const settled = agent.engine.chat(chatId);
    if (turn.turnCount === 1 && outcome.state === "completed" && settled && settled.titledBy !== "user") void this.title(agent, settled);
  }

  /** Titling: one small request on the chat's own provider; any failure is silent. */
  private async title(agent: ProjectAgent, chat: Chat): Promise<void> {
    // An outside chat has no provider of Unframed's to title it, so it keeps the name it has.
    if (chat.modelSelection.provider === "outside") return;
    try {
      const first = chat.messages.find((message) => message.role === "user")?.text ?? "";
      const answer = chat.messages.find((message) => message.role === "assistant" && message.turnId === chat.latestTurn?.turnId)?.text ?? "";
      const adapter = this.adapterFor(chat.modelSelection.provider);
      const environment = adapter.provider === "scripted" ? undefined : await this.deps.runEnvironment(chat.modelSelection.provider);
      const title = await adapter.title({
        chatId: chat.id,
        projectDir: agent.folder,
        modelSelection: chat.modelSelection,
        firstMessage: first,
        answer: answer.slice(0, 400),
        ...(environment === undefined ? {} : { environment }),
      });
      if (title === undefined || agent.engine.chat(chat.id)?.titledBy === "user") return;
      await this.internal(agent, chat.id, { type: "thread.title.generate.complete", title });
    } catch (error) {
      logInfo(`chat ${chat.id}: no title: ${errorText(error)}`);
    }
  }


  private async revertOne(agent: ProjectAgent, chatId: string, turn: number): Promise<{ restored: string[]; skipped: Array<{ id: string; by: SkippedBy }> }> {
    const rows = agent.turnChanges.rows(chatId, turn);
    const records = await this.deps.rooms.read(agent.slug);
    const current = new Map(records.map((item) => [item.id as string, item]));
    const earliest = rows.reduce((least, row) => Math.min(least, row.lastClock), Number.POSITIVE_INFINITY);
    const log = rows.length === 0 ? [] : await this.deps.rooms.changeLog(agent.slug, Number.isFinite(earliest) ? earliest : 0);
    const plan = planRevert(chatId, rows, current, log);
    if (plan.change.put.length > 0 || plan.change.remove.length > 0) {
      await this.deps.rooms.apply(agent.slug, plan.change, { kind: "server", id: `revert:${chatId}:${turn}` });
    }
    return { restored: plan.restored, skipped: plan.skipped };
  }

  private async revertTurn(agent: ProjectAgent, chatId: string, turn: number): Promise<void> {
    try {
      const { restored, skipped } = await this.revertOne(agent, chatId, turn);
      await this.internal(agent, chatId, { type: "thread.turn.reverted.complete", turnCount: turn, restored, skipped });
    } catch (error) {
      logError(`chat ${chatId}: could not revert turn ${turn}: ${errorText(error)}`);
      await this.activity(agent, chatId, {
        id: `revert-failed:${randomUUID()}`,
        tone: "error",
        kind: "revert.failed",
        summary: "Could not revert the turn",
        payload: { turnCount: turn, message: errorText(error) },
        turnId: agent.engine.chat(chatId)?.turns.find((known) => known.turnCount === turn)?.turnId ?? null,
        createdAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Edit from here, after the decider dropped the later turns: reverts their canvas changes
   * newest first with the skip rule, rolls the provider conversation back, and forgets their
   * turn changes. It runs before any later turn of the chat is sent.
   */
  private async revertToCheckpoint(
    agent: ProjectAgent,
    chatId: string,
    rewind: { keep: number; restoreCanvas: boolean; dropped: number; revertTurns: ReadonlyArray<number> },
  ): Promise<void> {
    const chat = agent.engine.chat(chatId);
    if (!chat) return;
    try {
      if (rewind.restoreCanvas) {
        const restored: string[] = [];
        const skipped: Array<{ id: string; by: SkippedBy }> = [];
        for (const turn of rewind.revertTurns) {
          const outcome = await this.revertOne(agent, chatId, turn);
          restored.push(...outcome.restored);
          skipped.push(...outcome.skipped);
        }
        // Chat-wide, so it outlives the dropped turns: the rail says which shapes were left alone (spec 08).
        await this.activity(agent, chatId, {
          id: `checkpoint-reverted:${randomUUID()}`,
          tone: "info",
          kind: "checkpoint.reverted",
          summary: "Rewound the canvas",
          payload: { turnCount: rewind.keep, restored, skipped },
          turnId: null,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      logError(`chat ${chatId}: could not restore the canvas: ${errorText(error)}`);
    }
    if (rewind.dropped > 0) {
      // The provider conversation is rolled back on a live session: a closed one is resumed first.
      await this.providers
        .ensure(agent.slug, chat, agent.folder, agent.engine)
        .then(() => this.providers.rollback(chatId, rewind.dropped))
        .catch((error: unknown) => logError(`chat ${chatId}: rollback: ${errorText(error)}`));
    }
    agent.turnChanges.dropAfter(chatId, rewind.keep);
  }


  /** Thread search (spec 08): this project's chats whose messages or final replies match. */
  async searchThreads(project: string, query: string, limit: number | undefined): Promise<ThreadSearchMatch[]> {
    const agent = await this.project(project);
    return searchChats(Object.values(agent.engine.model.chats), query, limit ?? SEARCH_LIMIT_MAX);
  }

  /** The pages and motions a chat's turns `from + 1` to `to` wrote, as diffs (spec 08). */
  async turnDiff(project: string, chatId: string, from: number, to: number, ignoreWhitespace: boolean): Promise<{ files: ArtifactDiffFile[] }> {
    const agent = await this.project(project);
    const chat = agent.engine.chat(chatId);
    if (!chat || chat.deletedAt !== null) throw new DispatchError("not_found", "That chat does not exist.");
    if (to < from) throw new DispatchError("bad_request", "A diff runs from an earlier turn to a later one.");
    return { files: await artifactDiff(agent.turnChanges, agent.folder, chatId, from, to, ignoreWhitespace) };
  }

  async chat(project: string, chatId: string): Promise<Chat | undefined> {
    return (await this.project(project)).engine.chat(chatId);
  }

  summaries(agent: ProjectAgent) {
    return Object.values(agent.engine.model.chats)
      .filter((chat) => chat.deletedAt === null)
      .map(chatSummary);
  }

  async stopAll(): Promise<void> {
    for (const adapter of this.adapters.values()) await adapter.stopAll().catch(() => undefined);
  }
}

