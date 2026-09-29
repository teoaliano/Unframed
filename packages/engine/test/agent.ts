/**
 * Engine-seam helpers for chats: an engine running the scripted agent over the fixture
 * scripts, and a chat driven the way the web drives one, by dispatching commands and
 * folding a `subscribeThread` stream with the domain projector.
 */
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatSummary, ClientChatCommand, ShellStreamItem, ThreadStreamItem } from "@unframed/contracts";
import { projectChat, type Chat, type ChatEvent } from "@unframed/domain";
import { repoRoot, startEngine, type EngineOptions, type TestEngine } from "./harness.ts";
import type { Subscription, TestRpcClient } from "./rpcClient.ts";

export const FIXTURES = join(repoRoot, "assets", "fixtures");
export const PROJECT = "board";

type Distributive<T> = T extends unknown ? Omit<T, "commandId" | "projectId"> : never;
export type CommandInput = Distributive<ClientChatCommand>;

export interface AgentEngine {
  readonly engine: TestEngine;
  readonly rpc: TestRpcClient;
  readonly folder: string;
  dispatch(command: CommandInput): Promise<{ sequence: number }>;
  /** Creates a chat (Claude, Full access, default mode unless overridden). */
  createChat(overrides?: Partial<Extract<CommandInput, { type: "thread.create" }>>): Promise<string>;
  send(chatId: string, text: string, options?: { selection?: string[]; attachments?: Array<{ id: string; name: string }>; steer?: boolean }): Promise<{ sequence: number }>;
  watch(chatId: string): Promise<ChatWatch>;
  /** Waits for the chat's latest turn to leave running, and answers the chat. */
  settled(chatId: string, turnCount?: number): Promise<Chat>;
  sidecars(): Promise<Array<Record<string, unknown>>>;
}

export interface ChatWatch {
  readonly chat: () => Chat;
  readonly items: ThreadStreamItem[];
  until(check: (chat: Chat) => boolean, what?: string, timeoutMs?: number): Promise<Chat>;
  close(): Promise<void>;
}

const until = async <T>(check: () => T | undefined | false, what: string, timeoutMs = 10_000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
};

/** Folds a thread stream into the chat it describes. */
export const watchThread = (subscription: Subscription<ThreadStreamItem>): ChatWatch => {
  let current: Chat | undefined;
  let seen = 0;
  const fold = () => {
    for (; seen < subscription.values.length; seen++) {
      const item = subscription.values[seen]!;
      if (item.kind === "snapshot") current = item.snapshot.thread as unknown as Chat;
      else if (item.kind === "event" && current) current = projectChat(current, item.event as unknown as ChatEvent);
    }
    return current;
  };
  return {
    chat: () => {
      const chat = fold();
      if (!chat) throw new Error("no snapshot yet");
      return chat;
    },
    items: subscription.values,
    until: (check, what = "the chat", timeoutMs) =>
      until(
        () => {
          const chat = fold();
          return chat !== undefined && check(chat) ? chat : undefined;
        },
        what,
        timeoutMs,
      ),
    close: () => subscription.close(),
  };
};

export const startAgentEngine = async (options: EngineOptions & { script?: string } = {}): Promise<AgentEngine> => {
  const { script, ...rest } = options;
  const engine = await startEngine({
    ...rest,
    env: { UNFRAMED_TEST_AGENT_SCRIPT: script ?? FIXTURES, UNFRAMED_TEST_CANVAS: "1", ...rest.env },
  });
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: PROJECT }).catch(() => undefined);
  const folder = join(engine.dataDir, "output", PROJECT);
  const dispatch = (command: CommandInput) =>
    rpc.call("orchestration.dispatchCommand", { ...command, commandId: randomUUID(), projectId: PROJECT } as ClientChatCommand);
  const watch = async (chatId: string) => {
    const subscription = rpc.subscribe("orchestration.subscribeThread", { projectId: PROJECT, threadId: chatId });
    const watched = watchThread(subscription);
    await watched.until(() => true, "the snapshot");
    return watched;
  };
  const agent: AgentEngine = {
    engine,
    rpc,
    folder,
    dispatch,
    async createChat(overrides = {}) {
      const threadId = overrides.threadId ?? `chat-${randomUUID().slice(0, 8)}`;
      await dispatch({
        type: "thread.create",
        modelSelection: { provider: "claude", model: "", traits: {} },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
        ...overrides,
        threadId,
      });
      return threadId;
    },
    send(chatId, text, sendOptions = {}) {
      return dispatch({
        type: "thread.turn.start",
        threadId: chatId,
        message: {
          messageId: `msg-${randomUUID()}`,
          text,
          attachments: sendOptions.attachments ?? [],
          ...(sendOptions.selection ? { context: { selection: sendOptions.selection } } : {}),
        },
        ...(sendOptions.steer ? { steer: true } : {}),
        createdAt: new Date().toISOString(),
      });
    },
    watch,
    async settled(chatId, turnCount) {
      const watched = await watch(chatId);
      try {
        return await watched.until(
          (chat) =>
            chat.latestTurn !== null &&
            chat.latestTurn.state !== "running" &&
            (turnCount === undefined || chat.latestTurn.turnCount === turnCount) &&
            chat.session?.status !== "running" &&
            chat.session?.status !== "starting",
          `chat ${chatId} to settle`,
        );
      } finally {
        await watched.close();
      }
    },
    async sidecars() {
      const names = (await readdir(folder)).filter((name) => /^\d+-agent(-\d+)?\.json$/.test(name)).sort();
      return Promise.all(names.map(async (name) => ({ name, ...JSON.parse(await readFile(join(folder, name), "utf8")) })));
    },
  };
  return agent;
};

/** The shell stream's items, folded into the summaries it describes. */
export const shellChats = (items: ReadonlyArray<ShellStreamItem>): Map<string, ChatSummary> => {
  const chats = new Map<string, ChatSummary>();
  for (const item of items) {
    if (item.kind === "snapshot") for (const chat of item.chats) chats.set(chat.id, chat);
    else if (item.kind === "chat-upserted") chats.set(item.chat.id, item.chat);
    else if (item.kind === "chat-removed") chats.delete(item.id);
  }
  return chats;
};

export { until };
