import type { ChatSummary, ClientChatCommand, ProviderStatuses, ShellStreamItem, ThreadStreamItem } from "@unframed/contracts";
import { projectChat, type Chat, type ChatEvent, type ChatMessage } from "@unframed/domain";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { EngineConnection } from "../rpc/engine.ts";

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

const INITIAL_UI: RailUi = { open: false, chosen: null, pinned: null, searchOpen: false, diff: undefined, error: undefined };

type Key = "shell" | "providers" | "ui" | `thread:${string}`;

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
  private readonly stopShell: () => void;

  constructor(engine: EngineConnection, project: string) {
    this.engine = engine;
    this.project = project;
    this.stopShell = engine.subscribe("orchestration.subscribeShell", { projectId: project }, (item) => this.onShell(item));
  }

  dispose(): void {
    this.stopShell();
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
      if (item.sequence <= this.shellSequence) return;
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

  // -------------------------------------------------------------------------------------
  // The rail's own state.

  get ui(): RailUi {
    return this.uiState;
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
export const useWatchedThread = (client: ChatClient, threadId: string | null | undefined): Chat | undefined => {
  useEffect(() => (threadId ? client.watch(threadId) : undefined), [client, threadId]);
  return useThread(client, threadId);
};
