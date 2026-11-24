import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SETUP_FIRST_MESSAGE, SETUP_SYSTEM_PROMPT, setupRejection } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { toolResults } from "./agentCanvas.ts";
import { McpClient } from "../src/agent/mcp.ts";
import { git } from "./gitRepos.ts";
import { startRepositoryAgent, type RepositoryAgent } from "./repositoryAgent.ts";

const call = (name: string, input: Record<string, unknown> = {}) => ({ name, input });

const SETUP_WHEN = "^Set up this Repository";

const setupChatOf = async (agent: RepositoryAgent): Promise<string> => {
  const { repository } = await agent.rpc.call("repositories.read", { project: agent.project });
  expect(repository?.setupChat).toEqual(expect.any(String));
  return repository!.setupChat!;
};

const offered = async (agent: RepositoryAgent, chatId: string) => {
  const session = await agent.session(chatId);
  const client = new McpClient(session.url, session.token);
  await client.initialize();
  return client.listTools();
};

describe("Setup", () => {
  it("opens when a Repository is added, in the first Instance's worktree, with its prompt and its own tools", { timeout: 60_000 }, async () => {
    const agent = await startRepositoryAgent({}, { setup: { when: SETUP_WHEN, turns: [{ text: "Looking at the repo." }] }, other: { when: "^look", turns: [{ text: "Looked." }] } });
    const chatId = await setupChatOf(agent);
    const chat = await agent.settled(chatId, 1);
    expect(chat.title).toBe("Setup");
    expect(chat.tags).toEqual([agent.screen.id]);
    expect(chat.messages[0]).toMatchObject({ role: "user", text: SETUP_FIRST_MESSAGE });
    expect(chat.messages.at(-1)?.text).toBe("Looking at the repo.");
    const session = await agent.session(chatId);
    expect(session.cwd).toBe(agent.instance.worktree);
    expect(session.systemPrompt!.endsWith(SETUP_SYSTEM_PROMPT)).toBe(true);
    expect(await offered(agent, chatId)).toEqual(expect.arrayContaining(["ask_login", "screen_snapshot", "setup_save", "instance_status", "instance_start"]));
    expect((await agent.rpc.call("repositories.read", { project: agent.project })).repository?.status).toBe("setting-up");

    const other = await agent.createChat();
    await agent.send(other, "look around");
    await agent.settled(other, 1);
    expect((await offered(agent, other)).filter((name) => ["ask_login", "screen_snapshot", "setup_save"].includes(name))).toEqual([]);
    expect((await agent.session(other)).systemPrompt).not.toContain(SETUP_SYSTEM_PROMPT);
  });

  it("asks the person to log in in the Screen and waits for them", { timeout: 60_000 }, async () => {
    const agent = await startRepositoryAgent({}, { setup: { when: SETUP_WHEN, turns: [{ text: "Logged in, thanks.", tools: [call("ask_login", { message: "Log in to Acme with your work account." })] }] } });
    const chatId = await setupChatOf(agent);
    const watched = await agent.watch(chatId);
    const asked = await watched.until((chat) => chat.activities.some((activity) => activity.kind === "setup.login.requested"), "the login request");
    expect(asked.activities.find((activity) => activity.kind === "setup.login.requested")).toMatchObject({ summary: "Log in to Acme with your work account.", payload: { shapeId: agent.screen.id } });
    expect(asked.latestTurn?.state).toBe("running");
    expect(await agent.rpc.call("repositories.confirmLogin", { project: agent.project })).toEqual({ waiting: true });
    const chat = await agent.settled(chatId, 1);
    expect(toolResults(chat, "ask_login")[0]).toMatchObject({ status: "completed", result: { loggedIn: true, shapeId: agent.screen.id.replace(/^shape:/, "") } });
    expect(chat.activities.find((activity) => activity.kind === "setup.login.resolved")).toMatchObject({ payload: { loggedIn: true } });
    expect(await agent.rpc.call("repositories.confirmLogin", { project: agent.project })).toEqual({ waiting: false });
  });

  it("snapshots its Screen through the Instance's proxy", { timeout: 90_000 }, async () => {
    const agent = await startRepositoryAgent({ UNFRAMED_TEST_RENDERER: "ok" }, { setup: { when: SETUP_WHEN, turns: [{ text: "Seen.", tools: [call("screen_snapshot")] }] } });
    const chat = await agent.settled(await setupChatOf(agent), 1, undefined, 80_000);
    const live = await agent.rpc.call("instances.status", { project: agent.project, id: agent.instance.id });
    expect(toolResults(chat, "screen_snapshot")[0]).toMatchObject({ status: "completed", result: { url: `http://127.0.0.1:${live.proxyPort}/`, route: "/", w: 1280, h: 800 } });
  });

  it("saves the result on the Repository, copies Setup's files into every worktree and the exclude file, and refuses a tracked file", { timeout: 90_000 }, async () => {
    const agent = await startRepositoryAgent({}, {
      setup: {
        when: SETUP_WHEN,
        turns: [
          { text: "Looking." },
          {
            text: "The Screen shows the app. Check it, please.",
            tools: [
              call("setup_save", { runCommand: "npm run dev", packageManager: "npm", files: ["package.json"], mocks: [], warnings: [] }),
              call("setup_save", { setupCommand: "npm install", runCommand: "npm run dev", packageManager: "npm", files: [".unframed/mock-user.js"], mocks: ["mock user"], warnings: ["OAuth only works on localhost:3000"] }),
            ],
          },
        ],
      },
    });
    const chatId = await setupChatOf(agent);
    await agent.settled(chatId, 1);
    const second = await agent.rpc.call("instances.create", { project: agent.project, branch: "second" });
    await mkdir(join(agent.instance.worktree, ".unframed"), { recursive: true });
    await writeFile(join(agent.instance.worktree, ".unframed", "mock-user.js"), "module.exports = { name: 'Ada' };\n");
    await agent.send(chatId, "go on");
    const chat = await agent.settled(chatId, 2, undefined, 60_000);
    const [tracked, saved] = toolResults(chat, "setup_save");
    expect(tracked).toMatchObject({ status: "failed", result: { error: expect.stringMatching(/package.json is tracked by git/) } });
    expect(saved).toMatchObject({ status: "completed", result: { saved: true, files: [".unframed/mock-user.js"], copiedInto: [second.id] } });
    expect(chat.activities.filter((activity) => activity.kind === "setup.proposed")).toHaveLength(1);

    const { repository } = await agent.rpc.call("repositories.read", { project: agent.project });
    expect(repository).toMatchObject({
      status: "setting-up",
      setup: { setupCommand: "npm install", runCommand: "npm run dev", packageManager: "npm", portMode: { mode: "free" }, files: [".unframed/mock-user.js"], mocks: ["mock user"], warnings: ["OAuth only works on localhost:3000"] },
    });
    expect(await readFile(join(second.worktree, ".unframed", "mock-user.js"), "utf8")).toContain("Ada");
    expect(existsSync(join(agent.engine.dataDir, "output", agent.project, "setup-files", ".unframed", "mock-user.js"))).toBe(true);
    const exclude = await readFile(join(agent.root, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n")).toContain("/.unframed/mock-user.js");
    expect(git(second.worktree, "status", "--porcelain")).not.toContain("mock-user");

    const third = await agent.rpc.call("instances.create", { project: agent.project, branch: "third" });
    expect(await readFile(join(third.worktree, ".unframed", "mock-user.js"), "utf8")).toContain("Ada");
    expect((await agent.session(chatId)).systemPrompt).toBeDefined();
    expect(dirname(third.worktree)).toBe(dirname(agent.instance.worktree));
  });

  it("closes on Looks right, and sends a rejection note back as the next turn", { timeout: 60_000 }, async () => {
    const agent = await startRepositoryAgent({}, { setup: { when: SETUP_WHEN, turns: [{ text: "Done, check it." }, { text: "Fixed the header." }] } });
    const chatId = await setupChatOf(agent);
    await agent.settled(chatId, 1);
    await expect(agent.rpc.call("repositories.setupVerdict", { project: agent.project, accepted: false, note: "  " })).rejects.toMatchObject({ code: "bad_request" });
    await agent.rpc.call("repositories.setupVerdict", { project: agent.project, accepted: false, note: "The header is missing." });
    const rejected = await agent.settled(chatId, 2);
    expect(rejected.messages.filter((message) => message.role === "user").at(-1)?.text).toBe(setupRejection("The header is missing."));
    expect(rejected.messages.at(-1)?.text).toBe("Fixed the header.");

    const { repository } = await agent.rpc.call("repositories.setupVerdict", { project: agent.project, accepted: true });
    expect(repository).toMatchObject({ status: "ready", setupChat: null });
    await expect(agent.rpc.call("repositories.setupVerdict", { project: agent.project, accepted: true })).rejects.toMatchObject({ code: "conflict" });
  });

  it("opens a new Setup thread when run again", { timeout: 60_000 }, async () => {
    const agent = await startRepositoryAgent({}, { setup: { when: SETUP_WHEN, turns: [{ text: "Looking." }] } });
    const first = await setupChatOf(agent);
    await agent.settled(first, 1);
    await agent.rpc.call("repositories.setupVerdict", { project: agent.project, accepted: true });
    const { chatId } = await agent.rpc.call("repositories.setup", { project: agent.project });
    expect(chatId).not.toBe(first);
    if (chatId === null) throw new Error("Setup did not open again");
    expect((await agent.rpc.call("repositories.read", { project: agent.project })).repository).toMatchObject({ status: "setting-up", setupChat: chatId });
    expect((await agent.settled(chatId, 1)).messages.at(-1)?.text).toBe("Looking.");
  });
});
