/**
 * Browser-seam helpers for the chat rail and the Agent tray (spec 08): an engine running
 * the scripted agent over the fixture scripts, the rail and its composer on screen, and
 * the chats the engine holds.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { ChatSummary, ShellStreamItem, ThreadStreamItem } from "@unframed/contracts";
import { projectChat, type Chat, type ChatEvent } from "@unframed/domain";
import { FIXTURES } from "../../engine/test/agent.ts";
import { fakeCodex, fakeShell, fakeSignedInClaude } from "../../engine/test/agentFakes.ts";
import type { EngineOptions, TestEngine } from "../../engine/test/engineProcess.ts";
import { expect, FIXTURE_KEY, startHostedEngine, test as base } from "./fixtures.ts";

export { FIXTURES };

/** An engine serving the built web whose chats run on the scripted agent. */
export const startAgentEngine = (options: EngineOptions & { script?: string } = {}): Promise<TestEngine> => {
  const { script, ...rest } = options;
  return startHostedEngine({ ...rest, env: { UNFRAMED_TEST_AGENT_SCRIPT: script ?? FIXTURES, ...rest.env } });
};

/**
 * An engine that detects providers for real, against fakes: its login shell adds nothing
 * to PATH and `CLAUDE_PATH` and `CODEX_PATH` name files in `dir`, which the test may or may
 * not have written. No real CLI ever runs. Its `.env` carries the fixture key, because a
 * keyless app opens the settings dialog over the canvas (spec 10).
 */
export const startDetectingEngine = async (dir: string, options: EngineOptions = {}): Promise<TestEngine> => {
  const shell = await fakeShell(join(dir, "shell"));
  return startHostedEngine({
    ...options,
    dotenv: `OPENROUTER_API_KEY=${FIXTURE_KEY}\nCLAUDE_PATH=${join(dir, "bin", "claude")}\nCODEX_PATH=${join(dir, "bin", "codex")}\n${options.dotenv ?? ""}`,
    env: { SHELL: shell, FAKE_SHELL_PATH: "", ...options.env },
  });
};

/**
 * A detecting engine whose Claude and Codex are signed-in fakes: Claude reports Opus 5.5
 * (every effort, thinking, fast mode) and Sonnet 5 (three efforts) and a `review` command,
 * and its config folder holds a `brand` skill; Codex lists GPT-5.5 Codex and GPT-6. Chats
 * on it never run a turn.
 */
export const startProvidersEngine = async (dir: string): Promise<TestEngine> => {
  await fakeSignedInClaude(join(dir, "bin"), {
    models: [
      { value: "claude-opus-5-5", displayName: "Opus", description: "Most capable", supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"], supportsAdaptiveThinking: true, supportsFastMode: true },
      { value: "claude-sonnet-5", displayName: "Sonnet", description: "Balanced", supportedEffortLevels: ["low", "medium", "high"] },
    ],
    commands: [{ name: "review", description: "Review the code" }],
  });
  await fakeCodex(join(dir, "bin"));
  await mkdir(join(dir, "claude-config", "skills", "brand"), { recursive: true });
  await writeFile(join(dir, "claude-config", "skills", "brand", "SKILL.md"), "---\nname: brand\ndescription: Apply the house brand\n---\nUse the brand colours.\n");
  return startDetectingEngine(dir, { dotenv: `CLAUDE_CONFIG_DIR=${join(dir, "claude-config")}\n` });
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

export const agentChromeButton = (page: Page): Locator => page.getByTestId("bottom-toolbar").getByRole("button", { name: "Agent" });

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

/**
 * Small pages (and motions) in a column right of the starter prompts, so the view that
 * opens on them keeps them clear of the rail on the left. Put them before opening the canvas.
 */
export const artifactColumn = (items: ReadonlyArray<{ id: string; kind?: "page" | "motion"; title: string; file?: string }>) =>
  items.map((item, index) => ({
    id: item.id,
    typeName: "shape",
    type: item.kind ?? "page",
    x: 600,
    y: 60 + index * 130,
    rotation: 0,
    index: `a${String.fromCharCode(66 + index)}`,
    parentId: "page:page",
    isLocked: false,
    opacity: 1,
    props: { w: 180, h: 96, file: item.file ?? "", fileName: item.file ?? "", title: item.title },
    meta: { ref: String(700 + index) },
  }));

/** Turns on plan mode, which is off unless set, as in t3code (spec 08). Call before opening the canvas. */
export const enablePlanMode = async (engine: TestEngine): Promise<void> => {
  await (await rpcOf(engine)).call("preferences.set", { key: "agent.planMode", value: true });
};

/** The mode the More composer controls menu shows as chosen in `group` ("Mode" or "Access"), closing the menu after. */
export const chosenControl = async (scope: Locator, group: "Mode" | "Access"): Promise<string> => {
  const page = scope.page();
  await scope.getByRole("button", { name: "More composer controls" }).click();
  const menu = page.getByRole("menu");
  const checked = menu.getByRole("group").filter({ hasText: group }).getByRole("menuitemradio", { checked: true });
  const label = ((await checked.textContent()) ?? "").trim();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  return label;
};

/** Dispatches one chat command as the web would. */
export const dispatch = async (engine: TestEngine, command: Record<string, unknown>, project = "default"): Promise<{ sequence: number }> =>
  (await rpcOf(engine)).call("orchestration.dispatchCommand", { commandId: crypto.randomUUID(), projectId: project, ...command } as never);

/** Creates a chat through the engine, named when `title` is given; answers its id. */
export const createChat = async (
  engine: TestEngine,
  fields: { id?: string; title?: string; tags?: string[]; createdAt?: string; runtimeMode?: string; interactionMode?: "default" | "plan"; provider?: "claude" | "codex" } = {},
  project = "default",
): Promise<string> => {
  const threadId = fields.id ?? `chat-${crypto.randomUUID().slice(0, 8)}`;
  await dispatch(
    engine,
    {
      type: "thread.create",
      threadId,
      modelSelection: { provider: fields.provider ?? "claude", model: "", traits: {} },
      ...(fields.runtimeMode ? { runtimeMode: fields.runtimeMode } : {}),
      ...(fields.interactionMode ? { interactionMode: fields.interactionMode } : {}),
      ...(fields.tags ? { tags: fields.tags } : {}),
      createdAt: fields.createdAt ?? new Date().toISOString(),
    },
    project,
  );
  if (fields.title) await dispatch(engine, { type: "thread.meta.update", threadId, title: fields.title }, project);
  return threadId;
};

/** Sends a message into a chat through the engine. */
export const sendThrough = (engine: TestEngine, threadId: string, text: string, selection: string[] = [], project = "default") =>
  dispatch(
    engine,
    {
      type: "thread.turn.start",
      threadId,
      message: { messageId: `message-${crypto.randomUUID()}`, text, attachments: [], ...(selection.length > 0 ? { context: { selection } } : {}) },
      createdAt: new Date().toISOString(),
    },
    project,
  );

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

/** The open approval request of a chat's running turn, as the engine holds it. */
export const pendingRequest = async (engine: TestEngine, threadId: string): Promise<string | undefined> => {
  const chat = await engineChat(engine, threadId);
  const running = chat.latestTurn?.state === "running" ? chat.latestTurn.turnId : undefined;
  const open = new Map<string, true>();
  for (const activity of chat.activities) {
    if (activity.turnId !== running) continue;
    const id = (activity.payload as { requestId?: string } | null)?.requestId;
    if (!id) continue;
    if (activity.kind === "approval.requested") open.set(id, true);
    else if (activity.kind === "approval.resolved") open.delete(id);
  }
  return [...open.keys()][0];
};

/** Waits for a chat to park on an approval, then answers it through the engine. */
export const answerApproval = async (engine: TestEngine, threadId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel" = "accept") => {
  let requestId: string | undefined;
  await expect.poll(async () => (requestId = await pendingRequest(engine, threadId)) !== undefined, { timeout: 15_000 }).toBe(true);
  await dispatch(engine, { type: "thread.approval.respond", threadId, requestId, decision });
};

/** A folder holding one script, written for a test. */
export const scriptFolder = async (scripts: Record<string, unknown>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "unframed-scripts-"));
  for (const [name, script] of Object.entries(scripts)) await writeFile(join(dir, `${name}.json`), JSON.stringify(script));
  return dir;
};

/** The person's messages in a chat, as the engine holds them. */
export const userTexts = async (engine: TestEngine, threadId: string): Promise<string[]> =>
  (await engineChat(engine, threadId)).messages.filter((message) => message.role === "user").map((message) => message.text);
