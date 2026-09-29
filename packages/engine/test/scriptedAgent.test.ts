import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { PROJECT, scriptFolder, startAgentEngine } from "./agent.ts";

describe("the scripted agent: one turn", () => {
  it("picks the script by its when, streams its text, settles the turn and uses the same script's turn 2", async () => {
    const script = await scriptFolder({
      greet: { when: "^hello", turns: [{ text: "First answer." }, { text: "Second answer." }] },
      other: { when: "^goodbye", turns: [{ text: "Never." }] },
    });
    const agent = await startAgentEngine({ script });
    const chatId = await agent.createChat();
    await agent.send(chatId, "Hello there");
    const one = await agent.settled(chatId, 1);
    expect(one.latestTurn?.state).toBe("completed");
    expect(one.messages.filter((message) => message.role === "assistant").map((message) => [message.text, message.streaming])).toEqual([["First answer.", false]]);

    await agent.send(chatId, "and again");
    const two = await agent.settled(chatId, 2);
    expect(two.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "Hello there"],
      ["assistant", "First answer."],
      ["user", "and again"],
      ["assistant", "Second answer."],
    ]);
    expect(two.session?.status).toBe("ready");
  });
});

describe("the scripted agent: load and match errors", () => {
  it("fails the turn with a malformed script's reason", async () => {
    const script = await scriptFolder({ broken: { when: "x", turns: [{ tools: [] }] } });
    const agent = await startAgentEngine({ script });
    const chatId = await agent.createChat();
    await agent.send(chatId, "x marks the spot");
    const chat = await agent.settled(chatId);
    expect(chat.latestTurn?.state).toBe("error");
    expect(chat.session?.lastError).toBe("agent script broken: turn 1 has no text string");
  });

  it("fails the turn with the no-match sentence", async () => {
    const script = await scriptFolder({ a: { when: "^alpha", turns: [{ text: "a" }] }, b: { when: "^beta", turns: [{ text: "b" }] } });
    const agent = await startAgentEngine({ script });
    const chatId = await agent.createChat();
    const text = "Something the scripts never expected, which is long enough to be cut at sixty characters";
    await agent.send(chatId, text);
    const chat = await agent.settled(chatId);
    const sentence = `no agent script matches "${text.slice(0, 60)}"`;
    expect(sentence).toBe('no agent script matches "Something the scripts never expected, which is long enough t"');
    expect(chat.session?.lastError).toBe(sentence);
    expect(chat.messages.at(-1)).toMatchObject({ role: "assistant", text: sentence });
  });

  it("fails a turn past the last one with the turn-count sentence", async () => {
    const script = await scriptFolder({ one: { when: "only once", turns: [{ text: "Once." }] } });
    const agent = await startAgentEngine({ script });
    const chatId = await agent.createChat();
    await agent.send(chatId, "only once please");
    await agent.settled(chatId, 1);
    await agent.send(chatId, "and twice?");
    const chat = await agent.settled(chatId, 2);
    expect(chat.latestTurn?.state).toBe("error");
    expect(chat.session?.lastError).toBe("agent script one has 1 turn; the chat is on turn 2");
  });
});

describe("the turn sidecar", () => {
  it("writes <epochMs>-agent.json for every settled turn with billing subscription and no cost, failed turns included", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    await agent.send(chatId, "what is on the board?");
    await agent.settled(chatId, 1);
    const failing = await agent.createChat();
    await agent.send(failing, "break it");
    const failed = await agent.settled(failing, 1);
    expect(failed.latestTurn?.state).toBe("error");

    const sidecars = await agent.sidecars();
    expect(sidecars).toHaveLength(2);
    for (const sidecar of sidecars) {
      expect(sidecar.name).toMatch(/^\d+-agent(-\d+)?\.json$/);
      expect(sidecar).toMatchObject({ kind: "agent-turn", turn: 1, provider: "claude", billing: "subscription" });
      expect(sidecar).not.toHaveProperty("cost");
      expect(typeof sidecar.at).toBe("string");
      expect(sidecar).toHaveProperty("usage");
    }
    expect(sidecars.map((sidecar) => sidecar.chatId).sort()).toEqual([chatId, failing].sort());
  });
});

describe("paths only through settings", () => {
  const raw = (port: number, frame: unknown) =>
    new Promise<any>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { host: `localhost:${port}` } });
      socket.on("error", reject);
      socket.on("open", () => socket.send(JSON.stringify(frame)));
      socket.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message._tag === "Exit") {
          socket.close();
          resolve(message);
        }
      });
    });

  it.each([
    ["thread.create", { modelSelection: { provider: "claude", model: "", traits: {} }, runtimeMode: "full-access", interactionMode: "default", createdAt: "2026-09-29T00:00:00.000Z", claudePath: "/tmp/evil" }],
    ["thread.turn.start", { message: { messageId: "m", text: "hi", attachments: [], cwd: "/etc" }, createdAt: "2026-09-29T00:00:00.000Z" }],
    ["thread.turn.start", { message: { messageId: "m", text: "hi", attachments: [] }, executable: "/bin/sh", createdAt: "2026-09-29T00:00:00.000Z" }],
  ])("refuses a %s carrying a path-like extra field", async (type, fields) => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    const answer = await raw(agent.engine.port, {
      _tag: "Request",
      id: "1",
      tag: "orchestration.dispatchCommand",
      payload: { type, commandId: randomUUID(), projectId: PROJECT, threadId: type === "thread.create" ? "fresh" : chatId, ...fields },
      headers: [],
    });
    expect(answer.exit._tag).toBe("Failure");
    expect(JSON.stringify(answer.exit)).toContain("bad_request");
    const chat = (await agent.watch(chatId)).chat();
    expect(chat.messages).toEqual([]);
  });
});
