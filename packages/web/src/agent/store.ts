import type { ElementChip } from "@unframed/contracts";
import { rememberDrafts, takeDrafts } from "../project/tabMemory.ts";
import { UnframedError, type ChatAttachment, type ChatSummary, type ClientChatCommand, type ProviderStatuses, type ShellStreamItem, type ThreadStreamItem } from "@unframed/contracts";
import { projectChat, readStoredDrafts, sendShortcutOf, storedDraftsValue, type Chat, type ChatEvent, type ChatMessage, type SendShortcut } from "@unframed/domain";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { EngineConnection } from "../rpc/engine.ts";

export const messageOf = (error: unknown): string => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

type Distributive<T> = T extends unknown ? Omit<T, "commandId" | "projectId"> : never;
export type CommandInput = Distributive<ClientChatCommand>;

export const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

interface ThreadEntry {
  chat: Chat | undefined;
  sequence: number;
  watchers: number;
  stop: () => void;
}

export interface RailUi {
  readonly open: boolean;
  readonly chosen: string | null;
  readonly pinned: string | null;
  readonly searchOpen: boolean;
  readonly diff: { readonly threadId: string; readonly turnCount: number | "all"; readonly shapeId?: string } | undefined;
  readonly error: string | undefined;
}

export const NEW_CHAT = "new-chat";

const INITIAL_UI: RailUi = { open: false, chosen: null, pinned: null, searchOpen: false, diff: undefined, error: undefined };

type Key = "shell" | "providers" | "ui" | "queues" | "handoff" | `thread:${string}` | `queue:${string}` | `draft:${string}`;

export interface QueuedMessage {
  readonly id: string;
  readonly message: { readonly text: string; readonly selection: ReadonlyArray<string>; readonly attachments: ReadonlyArray<ChatAttachment>; readonly elements?: ReadonlyArray<ElementChip> };
  readonly after: string | null;
  readonly state: "waiting" | "sending";
  readonly chips?: ReadonlyArray<string>;
}

export interface ChatDraft {
  readonly text: string;
  readonly mentions: ReadonlyArray<string>;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly elements?: ReadonlyArray<ElementChip>;
}

export const EMPTY_DRAFT: ChatDraft = { text: "", mentions: [], attachments: [] };

const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.length === b.length && a.every((id, index) => b[index] === id);

export const sameDraft = (a: ChatDraft, b: ChatDraft): boolean =>
  a.text === b.text &&
  sameIds(a.mentions, b.mentions) &&
  sameIds(
    a.attachments.map((item) => item.id),
    b.attachments.map((item) => item.id),
  ) &&
  JSON.stringify(a.elements ?? []) === JSON.stringify(b.elements ?? []);

export const TOOLBAR_DRAFT = "toolbar";

const DRAFT_WRITE_MS = 400;

export interface Handoff {
  readonly text: string;
  readonly selection: ReadonlyArray<string>;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly elements?: ReadonlyArray<ElementChip>;
}

const EMPTY_QUEUE: ReadonlyArray<QueuedMessage> = [];

export class ChatClient {
  readonly engine: EngineConnection;
  readonly project: string;
  private summaries = new Map<string, ChatSummary>();
  private shellSequence = -1;
  private synced = false;
  private readonly threads = new Map<string, ThreadEntry>();
  private readonly optimistic = new Map<string, ChatMessage[]>();
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
  private readonly drafts_ = new Map<string, ChatDraft>();
  private readonly draftsKey: string;
  private readonly stopDrafts: () => void;
  private draftsTimer: ReturnType<typeof setTimeout> | undefined;
  private draftWrites = 0;
  private readonly writtenDrafts: string[] = [];
  private draftsRead = false;
  private readonly knownAttachments = new Map<string, ChatAttachment>();
  private followUpValue: "queue" | "steer" = "queue";
  private followUpWatch: (() => void) | undefined;
  private planModeValue = false;
  private planModeWatch: (() => void) | undefined;
  private sendShortcutValue: SendShortcut = "enter";
  private sendShortcutWatch: (() => void) | undefined;
  private readonly stopShell: () => void;

  constructor(engine: EngineConnection, project: string) {
    this.engine = engine;
    this.project = project;
    this.stopShell = engine.subscribe("orchestration.subscribeShell", { projectId: project }, (item) => this.onShell(item));
    this.draftsKey = `agent.drafts.${project}`;
    this.stopDrafts = engine.subscribe("preferences.subscribe", { keys: [this.draftsKey] }, (change) => {
      if (change.key === this.draftsKey) this.onStoredDrafts(change.value);
    });
    if (typeof window !== "undefined") window.addEventListener("pagehide", this.flushDrafts);
  }

  drafts(): ReadonlyArray<readonly [string, ChatDraft]> {
    return [...this.drafts_];
  }

  restoreDrafts(entries: ReadonlyArray<readonly [string, ChatDraft]>): void {
    for (const [key, draft] of entries) {
      this.drafts_.set(key, draft);
      this.rememberAttachments(draft.attachments);
    }
  }

  dispose(): void {
    this.flushDrafts();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.flushDrafts);
    this.stopDrafts();
    this.stopShell();
    this.followUpWatch?.();
    this.planModeWatch?.();
    this.sendShortcutWatch?.();
    for (const entry of this.threads.values()) entry.stop();
    this.threads.clear();
  }

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

  private onShell(item: ShellStreamItem): void {
    if (item.kind === "snapshot") {
      this.summaries = new Map(item.chats.map((chat) => [chat.id, chat]));
      this.shellSequence = item.sequence;
    } else if (item.kind === "synchronized") {
      this.synced = true;
    } else {
      if (item.sequence < this.shellSequence) return;
      this.shellSequence = item.sequence;
      if (item.kind === "chat-upserted") this.summaries.set(item.chat.id, item.chat);
      else this.summaries.delete(item.id);
    }
    for (const id of this.pendingChats.keys()) if (this.summaries.has(id)) this.pendingChats.delete(id);
    this.changed("shell");
  }

  chats(): ChatSummary[] {
    const all = new Map(this.pendingChats);
    for (const [id, chat] of this.summaries) all.set(id, chat);
    return [...all.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

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

  private open(threadId: string, entry: ThreadEntry): void {
    entry.stop = this.engine.subscribe("orchestration.subscribeThread", { projectId: this.project, threadId }, (item) => this.onThread(threadId, entry, item));
  }

  watch(threadId: string): () => void {
    let entry = this.threads.get(threadId);
    if (!entry) {
      const created: ThreadEntry = { chat: undefined, sequence: -1, watchers: 0, stop: () => {} };
      if (!this.creating.has(threadId)) this.open(threadId, created);
      this.threads.set(threadId, created);
      entry = created;
    }
    entry.watchers++;
    const held = entry;
    return () => {
      held.watchers--;
      if (held.watchers > 0) return;
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

  thread(threadId: string): Chat | undefined {
    const chat = this.threads.get(threadId)?.chat;
    const pending = this.optimistic.get(threadId) ?? [];
    if (!chat) return undefined;
    if (pending.length === 0) return chat;
    const known = new Set(chat.messages.map((message) => message.id));
    return { ...chat, messages: [...chat.messages, ...pending.filter((message) => !known.has(message.id))] };
  }

  loaded(threadId: string): boolean {
    return this.threads.get(threadId)?.chat !== undefined;
  }

  dispatch(command: CommandInput): Promise<{ sequence: number }> {
    return this.engine.call("orchestration.dispatchCommand", {
      ...command,
      commandId: crypto.randomUUID(),
      projectId: this.project,
    } as ClientChatCommand);
  }

  expectChat(summary: ChatSummary): void {
    if (this.summaries.has(summary.id)) return;
    this.creating.add(summary.id);
    this.pendingChats.set(summary.id, summary);
    this.changed("shell");
  }

  created(id: string): void {
    if (!this.creating.delete(id)) return;
    const entry = this.threads.get(id);
    if (entry) this.open(id, entry);
  }

  forgetChat(id: string): void {
    this.creating.delete(id);
    if (this.pendingChats.delete(id)) this.changed("shell");
  }

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

  inFlight(threadId: string): boolean {
    return (this.optimistic.get(threadId)?.length ?? 0) > 0;
  }

  queue(threadId: string): ReadonlyArray<QueuedMessage> {
    return this.queues.get(threadId) ?? EMPTY_QUEUE;
  }

  queuedThreads(): string[] {
    return [...this.queues.keys()];
  }

  enqueue(threadId: string, message: QueuedMessage["message"], after: string | null, chips?: ReadonlyArray<string>): void {
    this.queues.set(threadId, [...this.queue(threadId), { id: newId("queued"), message, after, state: "waiting", ...(chips !== undefined ? { chips } : {}) }]);
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

  takeQueued(threadId: string, id?: string): QueuedMessage[] {
    const taken = this.queue(threadId).filter((item) => id === undefined || item.id === id);
    this.updateQueue(threadId, (queue) => queue.filter((item) => !taken.includes(item)));
    return taken;
  }

  handOff(threadId: string, draft: Handoff): void {
    this.handoffs.set(threadId, [...(this.handoffs.get(threadId) ?? []), draft]);
    this.changed("handoff");
  }

  takeHandoffs(threadId: string): Handoff[] {
    const drafts = this.handoffs.get(threadId) ?? [];
    this.handoffs.delete(threadId);
    return drafts;
  }

  draft(key: string): ChatDraft {
    return this.drafts_.get(key) ?? EMPTY_DRAFT;
  }

  setDraft(key: string, draft: ChatDraft): void {
    if (sameDraft(this.draft(key), draft)) return;
    if (draft.text === "" && draft.mentions.length === 0 && draft.attachments.length === 0 && (draft.elements ?? []).length === 0) this.drafts_.delete(key);
    else this.drafts_.set(key, draft);
    this.rememberAttachments(draft.attachments);
    this.changed(`draft:${key}`);
    clearTimeout(this.draftsTimer);
    this.draftsTimer = setTimeout(this.flushDrafts, DRAFT_WRITE_MS);
  }

  rememberAttachments(attachments: ReadonlyArray<ChatAttachment>): void {
    for (const attachment of attachments) this.knownAttachments.set(attachment.id, attachment);
  }

  knownAttachment(id: string): ChatAttachment | undefined {
    return this.knownAttachments.get(id);
  }

  private readonly flushDrafts = (): void => {
    if (this.draftsTimer === undefined) return;
    clearTimeout(this.draftsTimer);
    this.draftsTimer = undefined;
    const keep = (key: string) => !this.synced || key === NEW_CHAT || key === TOOLBAR_DRAFT || this.summaries.has(key) || this.pendingChats.has(key);
    const value = storedDraftsValue(this.drafts_, keep);
    const json = JSON.stringify(value);
    this.writtenDrafts.push(json);
    if (this.writtenDrafts.length > 50) this.writtenDrafts.shift();
    this.draftWrites++;
    void this.engine
      .call("preferences.set", { key: this.draftsKey, value })
      .catch(() => undefined)
      .finally(() => this.draftWrites--);
  };

  private onStoredDrafts(value: unknown): void {
    if (this.draftWrites > 0 || this.draftsTimer !== undefined || this.writtenDrafts.includes(JSON.stringify(value ?? null))) return;
    const first = !this.draftsRead;
    this.draftsRead = true;
    for (const [key, draft] of readStoredDrafts(value)) {
      if (sameDraft(this.draft(key), draft) || (first && this.drafts_.has(key))) continue;
      this.drafts_.set(key, draft);
      this.rememberAttachments(draft.attachments);
      this.changed(`draft:${key}`);
    }
  }

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

  get sendShortcut(): SendShortcut {
    if (!this.sendShortcutWatch) {
      this.sendShortcutWatch = this.engine.subscribe("preferences.subscribe", { keys: ["agent.sendShortcut"] }, (change) => {
        if (change.key !== "agent.sendShortcut") return;
        this.sendShortcutValue = sendShortcutOf(change.value);
        this.changed("ui");
      });
    }
    return this.sendShortcutValue;
  }

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

  get ui(): RailUi {
    return this.uiState;
  }

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

const disposeIfIdle = (project: string, entry: ClientEntry) =>
  setTimeout(() => {
    if (entry.holders > 0 || clients.get(project) !== entry) return;
    clients.delete(project);
    rememberDrafts(project, entry.client.drafts());
    entry.client.dispose();
  }, 1000);

const entryFor = (engine: EngineConnection, project: string): ClientEntry => {
  let entry = clients.get(project);
  if (entry && entry.engine !== engine) {
    entry.client.dispose();
    entry = undefined;
  }
  if (!entry) {
    const client = new ChatClient(engine, project);
    client.restoreDrafts(takeDrafts(project));
    entry = { engine, client, holders: 0 };
    clients.set(project, entry);
    disposeIfIdle(project, entry);
  }
  return entry;
};

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

export const useQueue = (client: ChatClient, threadId: string | null | undefined): ReadonlyArray<QueuedMessage> => {
  useKey(client, `queue:${threadId ?? ""}`);
  return threadId ? client.queue(threadId) : EMPTY_QUEUE;
};

export const useQueuedThreads = (client: ChatClient): string[] => {
  useKey(client, "queues");
  return client.queuedThreads();
};

export const useDraftVersion = (client: ChatClient, key: string): number => useKey(client, `draft:${key}`);

export const useHandoffVersion = (client: ChatClient): number => useKey(client, "handoff");

export const usePlanMode = (client: ChatClient): boolean => {
  useKey(client, "ui");
  return client.planMode;
};

export const useSendShortcut = (client: ChatClient): SendShortcut => {
  useKey(client, "ui");
  return client.sendShortcut;
};

export const useFollowUp = (client: ChatClient): "queue" | "steer" => {
  useKey(client, "ui");
  return client.followUp;
};

export const useWatchedThread = (client: ChatClient, threadId: string | null | undefined): Chat | undefined => {
  useEffect(() => (threadId ? client.watch(threadId) : undefined), [client, threadId]);
  return useThread(client, threadId);
};
