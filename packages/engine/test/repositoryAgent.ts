import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClientChatCommand, Instance } from "@unframed/contracts";
import type { Chat } from "@unframed/domain";
import { watchThread, type ChatWatch, type CommandInput } from "./agent.ts";
import { makeRepo, repoEngineEnv } from "./gitRepos.ts";
import { makeTempDir, startEngine, type TestEngine } from "./harness.ts";
import type { TestRpcClient } from "./rpcClient.ts";

export interface RepositoryAgent {
  readonly root: string;
  readonly engine: TestEngine;
  readonly rpc: TestRpcClient;
  readonly project: string;
  readonly instance: Instance;
  readonly screen: any;
  readonly scripts: string;
  script(name: string, script: unknown): Promise<void>;
  dispatch(command: CommandInput, project?: string): Promise<{ sequence: number }>;
  createChat(project?: string, overrides?: Record<string, unknown>): Promise<string>;
  send(chatId: string, text: string, options?: { selection?: string[]; project?: string }): Promise<unknown>;
  watch(chatId: string, project?: string): Promise<ChatWatch>;
  settled(chatId: string, turnCount?: number, project?: string, timeoutMs?: number): Promise<Chat>;
  records(project?: string): Promise<any[]>;
  session(chatId: string): Promise<{ url: string; token: string; cwd?: string; systemPrompt?: string; granted?: string[] }>;
}

export const startRepositoryAgent = async (env: Record<string, string> = {}): Promise<RepositoryAgent> => {
  const root = await makeRepo();
  const scripts = await makeTempDir("unframed-scripts-");
  const engine = await startEngine({ env: await repoEngineEnv({ UNFRAMED_TEST_AGENT_SCRIPT: scripts, UNFRAMED_TEST_CANVAS: "1", ...env }) });
  const rpc = await engine.rpc();
  const added = await rpc.call("repositories.add", { path: root });
  const project = added.name as string;
  const records = async (name = project) => (await rpc.call("testCanvas.read", { project: name })).records as any[];
  const screen = (await records()).find((record) => record.typeName === "shape" && record.type === "screen");
  const dispatch = (command: CommandInput, name = project) =>
    rpc.call("orchestration.dispatchCommand", { ...command, commandId: randomUUID(), projectId: name } as ClientChatCommand);
  const watch = async (chatId: string, name = project) => {
    const watched = watchThread(rpc.subscribe("orchestration.subscribeThread", { projectId: name, threadId: chatId }));
    await watched.until(() => true, "the snapshot");
    return watched;
  };
  return {
    root,
    engine,
    rpc,
    project,
    instance: added.instance,
    screen,
    scripts,
    script: (name, script) => writeFile(join(scripts, `${name}.json`), JSON.stringify(script)),
    dispatch,
    async createChat(name = project, overrides = {}) {
      const threadId = `chat-${randomUUID().slice(0, 8)}`;
      await dispatch({ type: "thread.create", modelSelection: { provider: "claude", model: "", traits: {} }, createdAt: new Date().toISOString(), ...overrides, threadId } as CommandInput, name);
      return threadId;
    },
    send(chatId, text, options = {}) {
      return dispatch(
        {
          type: "thread.turn.start",
          threadId: chatId,
          message: { messageId: `msg-${randomUUID()}`, text, attachments: [], ...(options.selection ? { context: { selection: options.selection } } : {}) },
          createdAt: new Date().toISOString(),
        },
        options.project,
      );
    },
    watch,
    async settled(chatId, turnCount, name = project, timeoutMs = 30_000) {
      const watched = await watch(chatId, name);
      try {
        return await watched.until(
          (chat) =>
            chat.latestTurn !== null &&
            chat.latestTurn.state !== "running" &&
            (turnCount === undefined || chat.latestTurn.turnCount === turnCount) &&
            chat.session?.status !== "running" &&
            chat.session?.status !== "starting",
          `chat ${chatId} to settle`,
          timeoutMs,
        );
      } finally {
        await watched.close();
      }
    },
    records,
    session: async (chatId) => JSON.parse(await readFile(join(engine.dataDir, "scripted-agent", `${chatId}.json`), "utf8")),
  };
};
