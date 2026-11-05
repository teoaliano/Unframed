import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT, startAgentEngine } from "./agent.ts";
import { fakeClaudeTurns, fakeShell } from "./agentFakes.ts";
import { makeTempDir } from "./harness.ts";

const sentMessages = async (log: string): Promise<Array<{ content: unknown }>> =>
  (await readFile(log, "utf8").catch(() => ""))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));

const firstShape = async (agent: Awaited<ReturnType<typeof startAgentEngine>>): Promise<string> => {
  const canvas = (await agent.rpc.call("testCanvas.read", { project: PROJECT })) as unknown as { records: Array<{ id: string; typeName: string }> };
  return canvas.records.find((record) => record.typeName === "shape")!.id;
};

describe("Claude compacts a chat on /compact", () => {
  it("sends /compact as Claude's own command, with no preamble, and shows the compaction and the smaller context", async () => {
    const dir = await makeTempDir("unframed-claude-");
    const claude = await fakeClaudeTurns(join(dir, "bin"));
    const shell = await fakeShell(join(dir, "shell"));
    const messages = join(dir, "messages.log");
    const agent = await startAgentEngine({
      dotenv: `CLAUDE_PATH=${claude}\nCODEX_PATH=${join(dir, "none")}\n`,
      env: { UNFRAMED_TEST_AGENT_SCRIPT: undefined, SHELL: shell, FAKE_SHELL_PATH: "", FAKE_CLAUDE_MESSAGES: messages },
    });
    const shape = await firstShape(agent);
    const chatId = await agent.createChat({ modelSelection: { provider: "claude", model: "claude-opus-5-5", traits: {} } });
    await agent.send(chatId, "hello", { selection: [shape] });
    await agent.settled(chatId, 1);
    await agent.send(chatId, "/compact", { selection: [shape] });
    const chat = await agent.settled(chatId, 2);

    const sent = await sentMessages(messages);
    expect(sent[1]!.content).toBe("/compact");
    expect(chat.latestTurn?.state).toBe("completed");
    expect(chat.messages.filter((message) => message.role === "assistant").map((message) => message.text)).toEqual([expect.stringMatching(/^You said: .*hello$/s)]);
    const compaction = chat.activities.filter((activity) => (activity.payload as { itemType?: string }).itemType === "context_compaction");
    expect(compaction.map((activity) => activity.kind)).toEqual(["tool.started", "tool.completed"]);
    const usage = chat.activities.filter((activity) => activity.kind === "context-window.updated").at(-1)!.payload as { usage: { usedTokens: number } };
    expect(usage.usage.usedTokens).toBe(12000);
  });

  it("keeps the change note for the next message: a /compact turn does not use up the canvas changes", async () => {
    const dir = await makeTempDir("unframed-claude-");
    const claude = await fakeClaudeTurns(join(dir, "bin"));
    const shell = await fakeShell(join(dir, "shell"));
    const messages = join(dir, "messages.log");
    const agent = await startAgentEngine({
      dotenv: `CLAUDE_PATH=${claude}\nCODEX_PATH=${join(dir, "none")}\n`,
      env: { UNFRAMED_TEST_AGENT_SCRIPT: undefined, SHELL: shell, FAKE_SHELL_PATH: "", FAKE_CLAUDE_MESSAGES: messages },
    });
    const chatId = await agent.createChat({ modelSelection: { provider: "claude", model: "claude-opus-5-5", traits: {} } });
    await agent.send(chatId, "hello");
    await agent.settled(chatId, 1);
    const shape = await firstShape(agent);
    const canvas = (await agent.rpc.call("testCanvas.read", { project: PROJECT })) as unknown as { records: Array<{ id: string; x: number }> };
    const record = canvas.records.find((known) => known.id === shape)!;
    await agent.rpc.call("testCanvas.apply", { project: PROJECT, change: { put: [{ ...record, x: record.x + 40 }], remove: [] }, origin: { kind: "server", id: "test" } });
    await agent.send(chatId, "/compact");
    await agent.settled(chatId, 2);
    await agent.send(chatId, "carry on");
    await agent.settled(chatId, 3);
    const sent = await sentMessages(messages);
    expect(sent[1]!.content).toBe("/compact");
    expect(JSON.stringify(sent[2]!.content)).toMatch(/Since your last turn the canvas changed/);
  });

  it("passes /compact's instructions through as typed, and fails the compaction row of a /compact that had nothing to compact", async () => {
    const dir = await makeTempDir("unframed-claude-");
    const claude = await fakeClaudeTurns(join(dir, "bin"));
    const shell = await fakeShell(join(dir, "shell"));
    const messages = join(dir, "messages.log");
    const agent = await startAgentEngine({
      dotenv: `CLAUDE_PATH=${claude}\nCODEX_PATH=${join(dir, "none")}\n`,
      env: { UNFRAMED_TEST_AGENT_SCRIPT: undefined, SHELL: shell, FAKE_SHELL_PATH: "", FAKE_CLAUDE_MESSAGES: messages },
    });
    const chatId = await agent.createChat({ modelSelection: { provider: "claude", model: "claude-opus-5-5", traits: {} } });
    await agent.send(chatId, "/compact");
    const first = await agent.settled(chatId, 1);
    const failed = first.activities.filter((activity) => (activity.payload as { itemType?: string }).itemType === "context_compaction");
    expect(failed.at(-1)).toMatchObject({ kind: "tool.completed", payload: { status: "failed", detail: "Not enough messages to compact." } });

    await agent.send(chatId, "/compact keep the API notes");
    const chat = await agent.settled(chatId, 2);
    expect((await sentMessages(messages))[1]!.content).toBe("/compact keep the API notes");
    const items = chat.activities.filter((activity) => activity.turnId === chat.latestTurn!.turnId && (activity.payload as { itemType?: string }).itemType === "context_compaction");
    expect(items.at(-1)).toMatchObject({ kind: "tool.completed", payload: { status: "completed" } });
  });

  it("keeps the selection of a message that only starts with a slash, such as a path", async () => {
    const dir = await makeTempDir("unframed-claude-");
    const claude = await fakeClaudeTurns(join(dir, "bin"));
    const shell = await fakeShell(join(dir, "shell"));
    const messages = join(dir, "messages.log");
    const agent = await startAgentEngine({
      dotenv: `CLAUDE_PATH=${claude}\nCODEX_PATH=${join(dir, "none")}\n`,
      env: { UNFRAMED_TEST_AGENT_SCRIPT: undefined, SHELL: shell, FAKE_SHELL_PATH: "", FAKE_CLAUDE_MESSAGES: messages },
    });
    const shape = await firstShape(agent);
    const chatId = await agent.createChat({ modelSelection: { provider: "claude", model: "claude-opus-5-5", traits: {} } });
    await agent.send(chatId, "/Users/me/x.png explain this", { selection: [shape] });
    await agent.settled(chatId, 1);
    expect(JSON.stringify((await sentMessages(messages))[0]!.content)).toMatch(/Selected: .*\/Users\/me\/x\.png explain this/s);
  });

  it("the scripted agent reports a /compact turn as a context compaction, so the app can be driven without Claude", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    await agent.send(chatId, "long brief for the fox campaign");
    await agent.settled(chatId, 1);
    await agent.send(chatId, "/compact");
    const chat = await agent.settled(chatId, 2);
    const compaction = chat.activities.filter((activity) => (activity.payload as { itemType?: string }).itemType === "context_compaction");
    expect(compaction.map((activity) => [activity.kind, activity.turnId])).toEqual([
      ["tool.started", chat.latestTurn!.turnId],
      ["tool.completed", chat.latestTurn!.turnId],
    ]);
    const usage = chat.activities.filter((activity) => activity.kind === "context-window.updated").at(-1)!.payload as { usage: { usedTokens: number } };
    expect(usage.usage.usedTokens).toBe(12000);
  });
});
