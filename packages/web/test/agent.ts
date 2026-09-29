/**
 * Browser-seam helpers for the chat rail and the Agent tray (spec 08): an engine running
 * the scripted agent over the fixture scripts, the rail and its composer on screen, and
 * the chats the engine holds.
 */
import type { Locator, Page } from "@playwright/test";
import type { ChatSummary, ShellStreamItem, ThreadStreamItem } from "@unframed/contracts";
import { projectChat, type Chat, type ChatEvent } from "@unframed/domain";
import { FIXTURES } from "../../engine/test/agent.ts";
import type { EngineOptions, TestEngine } from "../../engine/test/engineProcess.ts";
import { expect, startHostedEngine, test as base } from "./fixtures.ts";

export { FIXTURES };

/** An engine serving the built web whose chats run on the scripted agent. */
export const startAgentEngine = (options: EngineOptions & { script?: string } = {}): Promise<TestEngine> => {
  const { script, ...rest } = options;
  return startHostedEngine({ ...rest, env: { UNFRAMED_TEST_AGENT_SCRIPT: script ?? FIXTURES, ...rest.env } });
};

export const test = base.extend<{ agent: TestEngine }>({
  agent: async ({}, use) => {
    const engine = await startAgentEngine();
    await use(engine);
    await engine.dispose();
  },
});

export { expect };

export const rail = (page: Page): Locator => page.getByRole("complementary", { name: "Agent" });

export const agentChromeButton = (page: Page): Locator => page.locator(".unframed-chrome-right").getByRole("button", { name: "Agent" });

/** Opens the rail from the top-right chrome and waits until it is at rest. */
export const openRail = async (page: Page): Promise<Locator> => {
  await agentChromeButton(page).click();
  const panel = rail(page);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-state", "open");
  return panel;
};

/** The Agent tray's box, in the rail or the toolbar's composer. */
export const promptBox = (scope: Locator): Locator => scope.getByRole("textbox", { name: "Message the agent" });

/** Types a message into a composer and sends it with Enter. */
export const say = async (scope: Locator, text: string): Promise<void> => {
  const box = promptBox(scope);
  await box.click();
  await box.pressSequentially(text);
  await box.press("Enter");
};

export const tabs = (page: Page): Locator => rail(page).getByRole("tab");

const sockets = new WeakMap<TestEngine, ReturnType<TestEngine["rpc"]>>();

/** One RPC socket per engine for the helpers below. */
export const rpcOf = (engine: TestEngine): ReturnType<TestEngine["rpc"]> => {
  let socket = sockets.get(engine);
  if (!socket) {
    socket = engine.rpc();
    sockets.set(engine, socket);
  }
  return socket;
};

/** The project's chats, as the shell reports them. */
export const engineChats = async (engine: TestEngine, project = "default"): Promise<ChatSummary[]> => {
  const rpc = await rpcOf(engine);
  const subscription = rpc.subscribe("orchestration.subscribeShell", { projectId: project });
  await expect.poll(() => subscription.values.some((item: ShellStreamItem) => item.kind === "synchronized")).toBe(true);
  const chats = new Map<string, ChatSummary>();
  for (const item of subscription.values) {
    if (item.kind === "snapshot") for (const chat of item.chats) chats.set(chat.id, chat);
    else if (item.kind === "chat-upserted") chats.set(item.chat.id, item.chat);
    else if (item.kind === "chat-removed") chats.delete(item.id);
  }
  await subscription.close();
  return [...chats.values()];
};

/** One chat as the engine holds it. */
export const engineChat = async (engine: TestEngine, threadId: string, project = "default"): Promise<Chat> => {
  const rpc = await rpcOf(engine);
  const subscription = rpc.subscribe("orchestration.subscribeThread", { projectId: project, threadId });
  await expect.poll(() => subscription.values.some((item: ThreadStreamItem) => item.kind === "synchronized")).toBe(true);
  let chat: Chat | undefined;
  for (const item of subscription.values) {
    if (item.kind === "snapshot") chat = item.snapshot.thread as unknown as Chat;
    else if (item.kind === "event" && chat) chat = projectChat(chat, item.event as unknown as ChatEvent);
  }
  await subscription.close();
  return chat!;
};

/** Waits for the one chat of the project and answers it as the engine holds it. */
export const onlyChat = async (engine: TestEngine, check: (chat: Chat) => boolean = () => true, project = "default"): Promise<Chat> => {
  let found: Chat | undefined;
  await expect
    .poll(
      async () => {
        const [summary, ...rest] = await engineChats(engine, project);
        if (!summary || rest.length > 0) return false;
        found = await engineChat(engine, summary.id, project);
        return check(found);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found!;
};
