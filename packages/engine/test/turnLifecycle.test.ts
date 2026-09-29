import { openRequests, type Chat } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { PROJECT, scriptFolder, shellChats, startAgentEngine, until, type AgentEngine } from "./agent.ts";
import { motionShape, roomShape, scriptedSession, seed } from "./agentCanvas.ts";
import { makeTempDir } from "./harness.ts";

const QUIT = "Unframed stopped while this turn was running, so it never finished. Send again to carry on where it left off.";
const MAX_TURNS = "The agent reached its limit of steps for one turn and stopped. Ask again, more narrowly — one change at a time.";

const parked = (agent: AgentEngine, chatId: string) =>
  agent.watch(chatId).then((watched) => watched.until((chat) => openRequests(chat, "approval").length > 0, "a request"));

const resumedStarts = (chat: Chat) => chat.activities.filter((activity) => activity.kind === "session.started").map((activity) => (activity.payload as { resumed: boolean }).resumed);

const listTools = (token: string) => ({
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});

describe("a failed turn", () => {
  it("records the retry, appends the failure sentence, and marks the turn error and the chat failed (the failure fixture)", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    await agent.send(chatId, "break it");
    const chat = await agent.settled(chatId, 1);
    expect(chat.latestTurn?.state).toBe("error");
    expect(chat.session).toMatchObject({ status: "error", lastError: MAX_TURNS });
    expect(chat.messages.at(-1)).toMatchObject({ role: "assistant", text: MAX_TURNS, streaming: false });
    expect(chat.activities.find((activity) => activity.kind === "retry")?.payload).toEqual({ attempt: 1, maxRetries: 3, delayMs: 2000, status: 529 });
    const shell = agent.rpc.subscribe("orchestration.subscribeShell", { projectId: PROJECT });
    await shell.next(1);
    expect(shellChats(shell.values).get(chatId)?.status).toBe("failed");
  });

  it("keeps what the agent already said, with the sentence below it as a new paragraph", async () => {
    const script = await scriptFolder({ partial: { when: "^half", turns: [{ text: "I made a start.", isError: true, errorSubtype: "error_during_execution" }] } });
    const agent = await startAgentEngine({ script });
    const chatId = await agent.createChat();
    await agent.send(chatId, "half a job");
    const chat = await agent.settled(chatId, 1);
    expect(chat.messages.filter((message) => message.role === "assistant").map((message) => message.text)).toEqual([
      "I made a start.\n\nThe agent stopped part-way through this turn. Nothing further was run — ask again, and say what you want done first.",
    ]);
  });
});

describe("rate limits", () => {
  it("records a warning and a rejection as rate-limit activities, and allowed after them", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    await agent.send(chatId, "usage limit check");
    await agent.settled(chatId, 1);
    await agent.send(chatId, "again");
    const rejected = await agent.settled(chatId, 2);
    expect(rejected.latestTurn?.state).toBe("error");
    await agent.send(chatId, "and now?");
    const chat = await agent.settled(chatId, 3);
    const limits = chat.activities.filter((activity) => activity.kind === "rate-limit");
    expect(limits.map((activity) => [activity.tone, activity.payload])).toEqual([
      ["info", { status: "allowed_warning", resetsAt: "2026-10-01T15:00:00.000Z" }],
      ["error", { status: "rejected", resetsAt: "2026-10-01T15:00:00.000Z" }],
      ["info", { status: "allowed" }],
    ]);
  });
});

describe("a chat quit mid-turn", () => {
  it("reads failed with the quit sentence and no pending request after a restart, and the next message resumes it", async () => {
    const dataDir = await makeTempDir();
    const first = await startAgentEngine({ dataDir });
    const chatId = await first.createChat({ runtimeMode: "approval-required" });
    await first.send(chatId, "clean the build folder");
    await parked(first, chatId);
    await first.engine.stop("SIGKILL");

    const second = await startAgentEngine({ dataDir });
    const chat = await second.settled(chatId, 1);
    expect(chat.latestTurn?.state).toBe("error");
    expect(chat.session).toMatchObject({ status: "error", lastError: QUIT });
    expect(openRequests(chat, "approval")).toEqual([]);
    expect(chat.messages.at(-1)?.text).toBe(QUIT);

    await second.dispatch({ type: "thread.runtime-mode.set", threadId: chatId, runtimeMode: "full-access" });
    await second.send(chatId, "carry on");
    const next = await second.settled(chatId, 2);
    expect(next.latestTurn?.state).toBe("completed");
    expect(next.messages.at(-1)?.text).toBe("Removed dist too.");
    expect(resumedStarts(next).at(-1)).toBe(true);
  });
});

describe("interrupt", () => {
  it("cancels the parked request, settles the turn interrupted, and the next message resumes", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat({ runtimeMode: "approval-required" });
    await agent.send(chatId, "clean the build folder");
    await parked(agent, chatId);
    await agent.dispatch({ type: "thread.turn.interrupt", threadId: chatId });
    const chat = await agent.settled(chatId, 1);
    expect(chat.latestTurn?.state).toBe("interrupted");
    expect(openRequests(chat, "approval")).toEqual([]);
    expect(chat.activities.find((activity) => activity.kind === "approval.resolved")?.payload).toMatchObject({ decision: "cancel" });

    await agent.dispatch({ type: "thread.runtime-mode.set", threadId: chatId, runtimeMode: "full-access" });
    await agent.send(chatId, "try the next one");
    const next = await agent.settled(chatId, 2);
    expect(next.latestTurn?.state).toBe("completed");
    expect(resumedStarts(next)).toEqual([false, true]);
  });
});

describe("titling", () => {
  it("names the chat after turn 1 with the trimmed title, and never after turn 2", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    await agent.send(chatId, "name this chat please");
    await agent.settled(chatId, 1);
    const named = await (await agent.watch(chatId)).until((chat) => chat.title !== "", "the title");
    expect(named).toMatchObject({ title: "A named conversation", titledBy: "agent" });
    await agent.dispatch({ type: "thread.meta.update", threadId: chatId, title: "" });
    await agent.send(chatId, "and again");
    await agent.settled(chatId, 2);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await agent.watch(chatId)).chat()).toMatchObject({ title: "", titledBy: null });
  });

  it("keeps the person's name given before or after the agent's", async () => {
    const agent = await startAgentEngine();
    const before = await agent.createChat();
    await agent.dispatch({ type: "thread.meta.update", threadId: before, title: "Mine first" });
    await agent.send(before, "name this chat please");
    await agent.settled(before, 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await agent.watch(before)).chat()).toMatchObject({ title: "Mine first", titledBy: "user" });

    const after = await agent.createChat();
    await agent.send(after, "name this chat please");
    await (await agent.watch(after)).until((chat) => chat.titledBy === "agent", "the agent's title");
    await agent.dispatch({ type: "thread.meta.update", threadId: after, title: "Mine after" });
    expect((await agent.watch(after)).chat()).toMatchObject({ title: "Mine after", titledBy: "user" });
  });

  it("lets the agent name a cleared chat again on its next first turn", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    await agent.send(chatId, "name this chat please");
    await (await agent.watch(chatId)).until((chat) => chat.titledBy === "agent", "the agent's title");
    await agent.dispatch({ type: "thread.meta.update", threadId: chatId, title: "" });
    await agent.dispatch({ type: "thread.checkpoint.revert", threadId: chatId, turnCount: 0, restoreCanvas: false });
    await (await agent.watch(chatId)).until((chat) => chat.turns.length === 0, "the rewind");
    await agent.send(chatId, "name this chat please");
    const renamed = await (await agent.watch(chatId)).until((chat) => chat.titledBy === "agent", "the second title");
    expect(renamed.title).toBe("A named conversation");
  });
});

describe("idle close", () => {
  it("closes a quiet session, stops its MCP token working, and the next message resumes it", async () => {
    const agent = await startAgentEngine({ env: { UNFRAMED_TEST_AGENT_IDLE_MS: "300" } });
    const chatId = await agent.createChat();
    await agent.send(chatId, "clean the build folder");
    await agent.settled(chatId, 1);
    const { url, token } = await scriptedSession(agent, chatId);
    const path = new URL(url).pathname;
    expect((await agent.engine.request(path, listTools(token))).status).toBe(200);
    await (await agent.watch(chatId)).until((chat) => chat.session?.status === "stopped", "the idle close");
    expect((await agent.engine.request(path, listTools(token))).status).toBe(401);
    await agent.send(chatId, "and dist");
    const next = await agent.settled(chatId, 2);
    expect(next.messages.at(-1)?.text).toBe("Removed dist too.");
    expect(resumedStarts(next)).toEqual([false, true]);
  });
});

describe("Edit from here", () => {
  const script = () =>
    scriptFolder({
      edits: {
        when: "^retitle",
        turns: [
          { text: "A.", tools: [{ name: "canvas_write", input: { ops: [{ type: "update", id: "m1", props: { title: "A" } }] } }] },
          { text: "B.", tools: [{ name: "canvas_write", input: { ops: [{ type: "update", id: "m1", props: { title: "B" } }] } }] },
        ],
      },
    });

  it("drops the later turns and reverts their canvas changes, or leaves the canvas with restoreCanvas false", async () => {
    const agent = await startAgentEngine({ script: await script() });
    await seed(agent, [motionShape("m1", "100", "Original")]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "retitle it");
    await agent.settled(chatId, 1);
    await agent.send(chatId, "retitle it again");
    await agent.settled(chatId, 2);
    expect((await roomShape(agent, "m1")).props.title).toBe("B");

    await agent.dispatch({ type: "thread.checkpoint.revert", threadId: chatId, turnCount: 1, restoreCanvas: true });
    const one = await (await agent.watch(chatId)).until((chat) => chat.turns.length === 1, "the rewind to turn 1");
    expect(one.messages.map((message) => message.text)).toEqual(["retitle it", "A."]);
    expect((await roomShape(agent, "m1")).props.title).toBe("A");

    await agent.send(chatId, "retitle it once more");
    const replayed = await agent.settled(chatId, 2);
    expect(replayed.messages.at(-1)?.text).toBe("B.");
    expect((await roomShape(agent, "m1")).props.title).toBe("B");

    await agent.dispatch({ type: "thread.checkpoint.revert", threadId: chatId, turnCount: 0, restoreCanvas: false });
    const empty = await (await agent.watch(chatId)).until((chat) => chat.turns.length === 0, "the rewind to the start");
    expect(empty.messages).toEqual([]);
    expect((await roomShape(agent, "m1")).props.title).toBe("B");
  });
});

describe("chat deletion", () => {
  it("stops the session and revokes its token, and leaves its canvas changes and files", async () => {
    const agent = await startAgentEngine();
    await seed(agent, [motionShape("m1", "100", "Intro"), motionShape("m2", "101", "Outro")]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "make the titles red");
    await agent.settled(chatId, 1);
    const { url, token } = await scriptedSession(agent, chatId);
    const shell = agent.rpc.subscribe("orchestration.subscribeShell", { projectId: PROJECT });
    await shell.next(1);
    await agent.dispatch({ type: "thread.delete", threadId: chatId });
    await until(() => !shellChats(shell.values).has(chatId), "the chat to leave the shell");
    const path = new URL(url).pathname;
    await expect
      .poll(async () => (await agent.engine.request(path, listTools(token))).status, { timeout: 5000 })
      .toBe(401);
    expect((await roomShape(agent, "m1")).props.title).toBe("Intro (red)");
    expect(await agent.sidecars()).toHaveLength(1);
    await expect(agent.rpc.subscribe("orchestration.subscribeThread", { projectId: PROJECT, threadId: chatId }).next(0)).rejects.toMatchObject({ code: "not_found" });
  });
});
