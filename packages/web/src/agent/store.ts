import { UnframedError, type ChatAttachment, type ChatSummary, type ClientChatCommand, type ProviderStatuses, type ShellStreamItem, type ThreadStreamItem } from "@unframed/contracts";
import { projectChat, type Chat, type ChatEvent, type ChatMessage } from "@unframed/domain";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { EngineConnection } from "../rpc/engine.ts";

export const messageOf = (error: unknown): string => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

type Distributive<T> = T extends unknown ? Omit<T, "commandId" | "projectId"> : never;
/** A command as the rail builds it: the client adds the command id and the project. */
export type CommandInput = Distributive<ClientChatCommand>;

export const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

interface ThreadEntry {
  chat: Chat | undefined;
  sequence: number;
  watchers: number;
  stop: () => void;
}

/** What the rail remembers while the canvas is mounted: never persisted. */
export interface RailUi {
  readonly open: boolean;
  /** The chat last chosen in the strip. */
  readonly chosen: string | null;
  /** A chat chosen from search, shown even when the selection filter hides it, until the selection next changes. */
  readonly pinned: string | null;
  readonly searchOpen: boolean;
  /** The diff panel, when open. */
  readonly diff: { readonly threadId: string; readonly turnCount: number | "all"; readonly shapeId?: string } | undefined;
  /** A line under the transcript for failures the transcript cannot show. */
  readonly error: string | undefined;
}

/** The rail's choice when New chat was pressed: no tab is active and the next message starts a chat. */
export const NEW_CHAT = "new-chat";

const INITIAL_UI: RailUi = { open: false, chosen: null, pinned: null, searchOpen: false, diff: undefined, error: undefined };

type Key = "shell" | "providers" | "ui" | "queues" | "handoff" | `thread:${string}` | `queue:${string}` | `draft:${string}`;

/** A message waiting for the running turn: sent after its next tool call, or when it ends. */
export interface QueuedMessage {
  readonly id: string;
  readonly message: { readonly text: string; readonly selection: ReadonlyArray<string>; readonly attachments: ReadonlyArray<ChatAttachment> };
  /** The latest completed tool call when it was queued: the next one is its boundary. */
  readonly after: string | null;
  readonly state: "waiting" | "sending";
}

/** A draft put back into a chat's composer. */
/** A chat's unsent text, and the shapes its @ mentions put among the context chips. */
export interface ChatDraft {
  readonly text: string;
  readonly mentions: ReadonlyArray<string>;
}

export const EMPTY_DRAFT: ChatDraft = { text: "", mentions: [] };

export const sameDraft = (a: ChatDraft, b: ChatDraft): boolean =>
  a.text === b.text && a.mentions.length === b.mentions.length && a.mentions.every((id, index) => b.mentions[index] === id);

export interface Handoff {
  readonly text: string;
  readonly selection: ReadonlyArray<string>;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}

const EMPTY_QUEUE: ReadonlyArray<QueuedMessage> = [];

/**
 * The chat client state (spec 08, t3code's client-runtime shape): the project's chat
 * summaries from `subscribeShell`, the chats on screen from `subscribeThread` folded with
 * the domain projector and de-duplicated by sequence, optimistic user messages, the
 * provider statuses, and a `dispatch` that stamps command ids. Reconnects resubscribe and
 * start again from a snapshot.
 */
export class ChatClient {
  readonly engine: EngineConnection;
  readonly project: string;
  private summaries = new Map<string, ChatSummary>();
  private shellSequence = -1;
  private synced = false;
  private readonly threads = new Map<string, ThreadEntry>();
  /** User messages sent but not yet in the chat, by chat. */
  private readonly optimistic = new Map<string, ChatMessage[]>();
  /** Chats created here that the shell has not reported yet. */
  private readonly pendingChats = new Map<string, ChatSummary>();
  private readonly creating = new Set<string>();
  private readonly listeners = new Map<Key, Set<() => void>>();
  private readonly versions = new Map<Key, number>();
  private statuses: ProviderStatuses | undefined;
  private checking = false;
  private statusRequest: Promise<void> | undefined;
  private uiState: RailUi = INITIAL_UI;
  private readonly queues = new Map<string, ReadonlyArray<QueuedMessage>>();
  private readonly handoffs = new Map<string, Handoff[]>();
  private readonly drafts = new Map<string, ChatDraft>();
  private followUpValue: "queue" | "steer" = "queue";
  private followUpWatch: (() => void) | undefined;
  private planModeValue = false;
  private planModeWatch: (() => void) | undefined;
  private readonly stopShell: () => void;

  constructor(engine: EngineConnection, project: string) {
    this.engine = engine;
    this.project = project;
    this.stopShell = engine.subscribe("orchestration.subscribeShell", { projectId: project }, (item) => this.onShell(item));
  }

  dispose(): void {
    this.stopShell();
    this.followUpWatch?.();
    this.planModeWatch?.();
    for (const entry of this.threads.values()) entry.stop();
    this.threads.clear();
  }

  // -------------------------------------------------------------------------------------
  // Change notification, by key, so a streaming reply re-renders only its chat.

  subscribe(key: Key, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => void set.delete(listener);
  }

  version(key: Key): number {
    return this.versions.get(key) ?? 0;
  }

  private changed(key: Key): void {
    this.versions.set(key, this.version(key) + 1);
    for (const listener of [...(this.listeners.get(key) ?? [])]) listener();
  }

  // -------------------------------------------------------------------------------------
  // The shell: every chat of the project as a summary.

  private onShell(item: ShellStreamItem): void {
    if (item.kind === "snapshot") {
      this.summaries = new Map(item.chats.map((chat) => [chat.id, chat]));
      this.shellSequence = item.sequence;
    } else if (item.kind === "synchronized") {
      this.synced = true;
    } else {
      // One commit that changes several chats (Clear all chats) sends one item per chat, all with its sequence: only older items are stale.
      if (item.sequence < this.shellSequence) return;
      this.shellSequence = item.sequence;
      if (item.kind === "chat-upserted") this.summaries.set(item.chat.id, item.chat);
      else this.summaries.delete(item.id);
    }
    for (const id of this.pendingChats.keys()) if (this.summaries.has(id)) this.pendingChats.delete(id);
    this.changed("shell");
  }

  /** Every chat of the project, newest first. */
  chats(): ChatSummary[] {
    const all = new Map(this.pendingChats);
    for (const [id, chat] of this.summaries) all.set(id, chat);
    return [...all.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  /** Resolves once the shell has delivered every change up to `sequence`, such as a command's answer. */
  shellReached(sequence: number): Promise<void> {
    if (this.shellSequence >= sequence) return Promise.resolve();
    return new Promise((resolve) => {
      const stop = this.subscribe("shell", () => {
        if (this.shellSequence < sequence) return;
        stop();
        resolve();
      });
    });
  }

  get shellSynchronized(): boolean {
    return this.synced;
  }

  // -------------------------------------------------------------------------------------
  // Threads: one subscription per chat on screen, shared by every reader.

  private open(threadId: string, entry: ThreadEntry): void {
    entry.stop = this.engine.subscribe("orchestration.subscribeThread", { projectId: this.project, threadId }, (item) => this.onThread(threadId, entry, item));
  }

  watch(threadId: string): () => void {
    let entry = this.threads.get(threadId);
    if (!entry) {
      const created: ThreadEntry = { chat: undefined, sequence: -1, watchers: 0, stop: () => {} };
      // A chat still being created has nothing to subscribe to yet: `created` opens it.
      if (!this.creating.has(threadId)) this.open(threadId, created);
      this.threads.set(threadId, created);
      entry = created;
    }
    entry.watchers++;
    const held = entry;
    return () => {
      held.watchers--;
      if (held.watchers > 0) return;
      // A chat looked away from keeps its subscription briefly, so switching tabs back is instant.
      setTimeout(() => {
        if (held.watchers > 0 || this.threads.get(threadId) !== held) return;
        held.stop();
        this.threads.delete(threadId);
      }, 30_000);
    };
  }

  private onThread(threadId: string, entry: ThreadEntry, item: ThreadStreamItem): void {
    if (item.kind === "snapshot") {
      entry.chat = item.snapshot.thread as unknown as Chat;
      entry.sequence = item.snapshot.snapshotSequence;
    } else if (item.kind === "synchronized") {
      return;
    } else {
      if (item.event.sequence <= entry.sequence || !entry.chat) return;
      entry.sequence = item.event.sequence;
      entry.chat = projectChat(entry.chat, item.event as unknown as ChatEvent);
    }
    const pending = this.optimistic.get(threadId);
    if (pending && entry.chat) {
      const known = new Set(entry.chat.messages.map((message) => message.id));
      const left = pending.filter((message) => !known.has(message.id));
      if (left.length === 0) this.optimistic.delete(threadId);
      else this.optimistic.set(threadId, left);
    }
    this.changed(`thread:${threadId}`);
  }

  /** A chat as the transcript shows it: the engine's projection plus the messages sent from here and not yet in it. */
  thread(threadId: string): Chat | undefined {
    const chat = this.threads.get(threadId)?.chat;
    const pending = this.optimistic.get(threadId) ?? [];
    if (!chat) return undefined;
    if (pending.length === 0) return chat;
    const known = new Set(chat.messages.map((message) => message.id));
    return { ...chat, messages: [...chat.messages, ...pending.filter((message) => !known.has(message.id))] };
  }

  /** Whether the chat's subscription has delivered its snapshot. */
  loaded(threadId: string): boolean {
    return this.threads.get(threadId)?.chat !== undefined;
  }

  // -------------------------------------------------------------------------------------
  // Commands.

  dispatch(command: CommandInput): Promise<{ sequence: number }> {
    return this.engine.call("orchestration.dispatchCommand", {
      ...command,
      commandId: crypto.randomUUID(),
      projectId: this.project,
    } as ClientChatCommand);
  }

  /** Records a chat the shell will report, so its tab shows at once. */
  expectChat(summary: ChatSummary): void {
    if (this.summaries.has(summary.id)) return;
    this.creating.add(summary.id);
    this.pendingChats.set(summary.id, summary);
    this.changed("shell");
  }

  /** The engine acknowledged the chat: whoever watches it now subscribes. */
  created(id: string): void {
    if (!this.creating.delete(id)) return;
    const entry = this.threads.get(id);
    if (entry) this.open(id, entry);
  }

  forgetChat(id: string): void {
    this.creating.delete(id);
    if (this.pendingChats.delete(id)) this.changed("shell");
  }

  /** Shows a user message at once; it leaves this list when the chat holds it. */
  addOptimistic(threadId: string, message: ChatMessage): void {
    this.optimistic.set(threadId, [...(this.optimistic.get(threadId) ?? []), message]);
    this.changed(`thread:${threadId}`);
  }

  dropOptimistic(threadId: string, messageId: string): void {
    const left = (this.optimistic.get(threadId) ?? []).filter((message) => message.id !== messageId);
    if (left.length === 0) this.optimistic.delete(threadId);
    else this.optimistic.set(threadId, left);
    this.changed(`thread:${threadId}`);
  }

  // -------------------------------------------------------------------------------------
  // Provider statuses: asked for only when the agent's UI is used, then kept.

  get providers(): ProviderStatuses | undefined {
    return this.statuses;
  }

  get checkingProviders(): boolean {
    return this.checking;
  }

  loadProviders(refresh = false): Promise<void> {
    if (!refresh && (this.statuses !== undefined || this.statusRequest)) return this.statusRequest ?? Promise.resolve();
    this.checking = true;
    this.changed("providers");
    const request = this.engine
      .call("providers.getStatuses", { projectId: this.project, ...(refresh ? { refresh: true } : {}) })
      .then(
        (statuses) => {
          this.statuses = statuses;
        },
        () => undefined,
      )
      .finally(() => {
        if (this.statusRequest === request) this.statusRequest = undefined;
        this.checking = false;
        this.changed("providers");
      });
    this.statusRequest = request;
    return request;
  }

  /** Whether a message sent from here has not reached the chat yet. */
  inFlight(threadId: string): boolean {
    return (this.optimistic.get(threadId)?.length ?? 0) > 0;
  }

  // -------------------------------------------------------------------------------------
  // Queued messages: kept here, not in the engine, since they are not sent yet. A reload
  // loses them harmlessly.

  queue(threadId: string): ReadonlyArray<QueuedMessage> {
    return this.queues.get(threadId) ?? EMPTY_QUEUE;
  }

  queuedThreads(): string[] {
    return [...this.queues.keys()];
  }

  enqueue(threadId: string, message: QueuedMessage["message"], after: string | null): void {
    this.queues.set(threadId, [...this.queue(threadId), { id: newId("queued"), message, after, state: "waiting" }]);
    this.changed(`queue:${threadId}`);
    this.changed("queues");
  }

  updateQueue(threadId: string, update: (queue: ReadonlyArray<QueuedMessage>) => ReadonlyArray<QueuedMessage>): void {
    const next = update(this.queue(threadId));
    if (next.length === 0) this.queues.delete(threadId);
    else this.queues.set(threadId, next);
    this.changed(`queue:${threadId}`);
    this.changed("queues");
  }

  /** Takes queued messages out (one, or all of them) and answers them. */
  takeQueued(threadId: string, id?: string): QueuedMessage[] {
    const taken = this.queue(threadId).filter((item) => id === undefined || item.id === id);
    this.updateQueue(threadId, (queue) => queue.filter((item) => !taken.includes(item)));
    return taken;
  }

  // -------------------------------------------------------------------------------------
  // Handing a draft back to a chat's composer (a cancelled queued message, Edit from here).

  handOff(threadId: string, draft: Handoff): void {
    this.handoffs.set(threadId, [...(this.handoffs.get(threadId) ?? []), draft]);
    this.changed("handoff");
  }

  /** The drafts handed to a chat's composer since it last took them. */
  takeHandoffs(threadId: string): Handoff[] {
    const drafts = this.handoffs.get(threadId) ?? [];
    this.handoffs.delete(threadId);
    return drafts;
  }

  // -------------------------------------------------------------------------------------
  // Each chat's unsent text (or `NEW_CHAT`'s), so the canvas rail and the editor's rail show
  // the same draft and closing the editor loses nothing. In memory only: a reload drops it.

  draft(key: string): ChatDraft {
    return this.drafts.get(key) ?? EMPTY_DRAFT;
  }

  setDraft(key: string, draft: ChatDraft): void {
    if (sameDraft(this.draft(key), draft)) return;
    if (draft.text === "" && draft.mentions.length === 0) this.drafts.delete(key);
    else this.drafts.set(key, draft);
    this.changed(`draft:${key}`);
  }

  // -------------------------------------------------------------------------------------
  // The Follow-up behavior preference (spec 10 shows its control): Queue unless set.

  get followUp(): "queue" | "steer" {
    if (!this.followUpWatch) {
      this.followUpWatch = this.engine.subscribe("preferences.subscribe", { keys: ["agent.followUp"] }, (change) => {
        if (change.key !== "agent.followUp") return;
        this.followUpValue = change.value === "steer" ? "steer" : "queue";
        this.changed("ui");
      });
    }
    return this.followUpValue;
  }

  /** The Plan mode preference (spec 10 shows its control): off unless set, as in t3code. */
  get planMode(): boolean {
    if (!this.planModeWatch) {
      this.planModeWatch = this.engine.subscribe("preferences.subscribe", { keys: ["agent.planMode"] }, (change) => {
        if (change.key !== "agent.planMode") return;
        this.planModeValue = change.value === true;
        this.changed("ui");
      });
    }
    return this.planModeValue;
  }

  // -------------------------------------------------------------------------------------
  // The rail's own state.

  get ui(): RailUi {
    return this.uiState;
  }

  /** A refused command or a failed call, in the rail's error line (and the toolbar tray's). */
  reportError(error: unknown): void {
    this.setUi({ error: messageOf(error) });
  }

  setUi(update: Partial<RailUi> | ((ui: RailUi) => Partial<RailUi>)): void {
    const patch = typeof update === "function" ? update(this.uiState) : update;
    this.uiState = { ...this.uiState, ...patch };
    this.changed("ui");
  }
}

interface ClientEntry {
  readonly engine: EngineConnection;
  readonly client: ChatClient;
  holders: number;
}

const clients = new Map<string, ClientEntry>();

/** Disposes a client nobody holds, a moment later, so a remount keeps its subscriptions. */
const disposeIfIdle = (project: string, entry: ClientEntry) =>
  setTimeout(() => {
    if (entry.holders > 0 || clients.get(project) !== entry) return;
    clients.delete(project);
    entry.client.dispose();
  }, 1000);

const entryFor = (engine: EngineConnection, project: string): ClientEntry => {
  let entry = clients.get(project);
  if (entry && entry.engine !== engine) {
    entry.client.dispose();
    entry = undefined;
  }
  if (!entry) {
    entry = { engine, client: new ChatClient(engine, project), holders: 0 };
    clients.set(project, entry);
    disposeIfIdle(project, entry);
  }
  return entry;
};

/**
 * The one chat client of a project, shared by the rail, the toolbar's Agent tray and the
 * editor, held for as long as the component is mounted.
 */
export const useChatClient = (engine: EngineConnection, project: string): ChatClient => {
  const client = useMemo(() => entryFor(engine, project).client, [engine, project]);
  useEffect(() => {
    const entry = entryFor(engine, project);
    entry.holders++;
    return () => {
      entry.holders--;
      disposeIfIdle(project, entry);
    };
  }, [engine, project]);
  return client;
};

const useKey = (client: ChatClient, key: Key): number =>
  useSyncExternalStore(
    (listener) => client.subscribe(key, listener),
    () => client.version(key),
  );

export const useChats = (client: ChatClient): ChatSummary[] => {
  useKey(client, "shell");
  return client.chats();
};

export const useThread = (client: ChatClient, threadId: string | null | undefined): Chat | undefined => {
  useKey(client, `thread:${threadId ?? ""}`);
  return threadId ? client.thread(threadId) : undefined;
};

export const useProviders = (client: ChatClient): { statuses: ProviderStatuses | undefined; checking: boolean } => {
  useKey(client, "providers");
  return { statuses: client.providers, checking: client.checkingProviders };
};

export const useRailUi = (client: ChatClient): RailUi => {
  useKey(client, "ui");
  return client.ui;
};

/** Subscribes to a chat while the component shows it, and answers it. */
export const useQueue = (client: ChatClient, threadId: string | null | undefined): ReadonlyArray<QueuedMessage> => {
  useKey(client, `queue:${threadId ?? ""}`);
  return threadId ? client.queue(threadId) : EMPTY_QUEUE;
};

export const useQueuedThreads = (client: ChatClient): string[] => {
  useKey(client, "queues");
  return client.queuedThreads();
};

/** Changes whenever the chat's draft changes. */
export const useDraftVersion = (client: ChatClient, key: string): number => useKey(client, `draft:${key}`);

/** Changes whenever a draft is handed to a composer. */
export const useHandoffVersion = (client: ChatClient): number => useKey(client, "handoff");

/** The Plan mode preference, live. */
export const usePlanMode = (client: ChatClient): boolean => {
  useKey(client, "ui");
  return client.planMode;
};

/** The Follow-up behavior preference, live. */
export const useFollowUp = (client: ChatClient): "queue" | "steer" => {
  useKey(client, "ui");
  return client.followUp;
};

export const useWatchedThread = (client: ChatClient, threadId: string | null | undefined): Chat | undefined => {
  useEffect(() => (threadId ? client.watch(threadId) : undefined), [client, threadId]);
  return useThread(client, threadId);
};
