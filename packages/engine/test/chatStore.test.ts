import { randomUUID } from "node:crypto";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import type { ClientChatCommand } from "@unframed/contracts";
import { describe, expect, it } from "vitest";
import { PROJECT, shellChats, startAgentEngine, until, watchThread } from "./agent.ts";
import { makeTempDir, startEngine } from "./harness.ts";

const create = (threadId: string, commandId = randomUUID()): ClientChatCommand => ({
  type: "thread.create",
  commandId,
  projectId: PROJECT,
  threadId,
  modelSelection: { provider: "claude", model: "", traits: {} },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdAt: new Date().toISOString(),
});

describe("the event store and receipts", () => {
  it("answers the same {sequence} for one commandId dispatched twice, and records it once", async () => {
    const { rpc } = await startAgentEngine();
    const command = create("chat-a");
    const first = await rpc.call("orchestration.dispatchCommand", command);
    const again = await rpc.call("orchestration.dispatchCommand", command);
    expect(again).toEqual(first);
    const shell = rpc.subscribe("orchestration.subscribeShell", { projectId: PROJECT });
    await shell.next(0);
    expect(shellChats(shell.values).size).toBe(1);
  });

  it("answers the same rejection for a rejected commandId again, and changes nothing", async () => {
    const { rpc } = await startAgentEngine();
    await rpc.call("orchestration.dispatchCommand", create("chat-a"));
    const duplicate = create("chat-a");
    const refusal = { code: "conflict", message: "Thread 'chat-a' already exists and cannot be created twice." };
    await expect(rpc.call("orchestration.dispatchCommand", duplicate)).rejects.toMatchObject(refusal);
    await expect(rpc.call("orchestration.dispatchCommand", duplicate)).rejects.toMatchObject(refusal);
    const watched = watchThread(rpc.subscribe("orchestration.subscribeThread", { projectId: PROJECT, threadId: "chat-a" }));
    await watched.until(() => true);
    expect(watched.chat().messages).toEqual([]);
  });

  it("refuses a commandId reused for another chat", async () => {
    const { rpc } = await startAgentEngine();
    const commandId = randomUUID();
    await rpc.call("orchestration.dispatchCommand", create("chat-a", commandId));
    await expect(rpc.call("orchestration.dispatchCommand", create("chat-b", commandId))).rejects.toMatchObject({ code: "conflict" });
  });

  it("answers not_found for a chat that does not exist, and for an unknown project", async () => {
    const { rpc } = await startAgentEngine();
    await expect(
      rpc.call("orchestration.dispatchCommand", { type: "thread.delete", commandId: randomUUID(), projectId: PROJECT, threadId: "nope" }),
    ).rejects.toMatchObject({ code: "not_found", message: "Thread 'nope' does not exist." });
    await expect(rpc.call("orchestration.dispatchCommand", { ...create("x"), projectId: "no-such-project" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("subscriptions", () => {
  it("send a snapshot, synchronized, then live changes, on the shell and on a chat", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    const shell = agent.rpc.subscribe("orchestration.subscribeShell", { projectId: PROJECT });
    const thread = agent.rpc.subscribe("orchestration.subscribeThread", { projectId: PROJECT, threadId: chatId });
    expect((await shell.next(0)).kind).toBe("snapshot");
    expect((await shell.next(1)).kind).toBe("synchronized");
    expect((await thread.next(0)).kind).toBe("snapshot");
    expect((await thread.next(1)).kind).toBe("synchronized");

    await agent.dispatch({ type: "thread.meta.update", threadId: chatId, title: "Titles" });
    const upsert = await shell.next(2);
    expect(upsert).toMatchObject({ kind: "chat-upserted", chat: { id: chatId, title: "Titles", titledBy: "user" } });
    expect(await thread.next(2)).toMatchObject({ kind: "event", event: { type: "thread.meta-updated", aggregateId: chatId } });

    await agent.dispatch({ type: "thread.delete", threadId: chatId });
    await until(() => shell.values.some((item) => item.kind === "chat-removed" && item.id === chatId), "the removal");
  });

  it("replays only what was missed when resubscribing with afterSequence", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    const first = await agent.dispatch({ type: "thread.meta.update", threadId: chatId, title: "One" });
    await agent.dispatch({ type: "thread.meta.update", threadId: chatId, title: "Two" });
    const last = await agent.dispatch({ type: "thread.runtime-mode.set", threadId: chatId, runtimeMode: "auto" });

    const thread = agent.rpc.subscribe("orchestration.subscribeThread", { projectId: PROJECT, threadId: chatId, afterSequence: first.sequence });
    await thread.next(2);
    expect(thread.values.slice(0, 3).map((item) => (item.kind === "event" ? item.event.type : item.kind))).toEqual([
      "thread.meta-updated",
      "thread.runtime-mode-set",
      "synchronized",
    ]);
    const sequences = thread.values.flatMap((item) => (item.kind === "event" ? [item.event.sequence] : []));
    expect(sequences.every((sequence) => sequence > first.sequence && sequence <= last.sequence)).toBe(true);

    const other = await agent.createChat();
    const shell = agent.rpc.subscribe("orchestration.subscribeShell", { projectId: PROJECT, afterSequence: last.sequence });
    await shell.next(1);
    expect(shell.values.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: "chat-upserted", chat: expect.objectContaining({ id: other }) }),
      expect.objectContaining({ kind: "synchronized" }),
    ]);
  });
});

describe("chats live in the project", () => {
  it("reads a chat back identically after a restart, and from a copy of the project folder", async () => {
    const dataDir = await makeTempDir();
    const first = await startAgentEngine({ dataDir });
    const chatId = await first.createChat({ runtimeMode: "approval-required" });
    await first.dispatch({ type: "thread.meta.update", threadId: chatId, title: "Kept" });
    const before = (await first.watch(chatId)).chat();
    await first.engine.stop();

    const second = await startAgentEngine({ dataDir });
    expect((await second.watch(chatId)).chat()).toEqual(before);
    await second.engine.stop();

    const elsewhere = await makeTempDir();
    await cp(join(dataDir, "output", PROJECT), join(elsewhere, "output", "copied"), { recursive: true });
    const third = await startEngine({ dataDir: elsewhere, env: { UNFRAMED_TEST_AGENT_SCRIPT: join(import.meta.dirname, "../../../assets/fixtures") } });
    const rpc = await third.rpc();
    const shell = rpc.subscribe("orchestration.subscribeShell", { projectId: "copied" });
    const snapshot = await shell.next(0);
    expect(snapshot).toMatchObject({ kind: "snapshot", chats: [expect.objectContaining({ id: chatId, title: "Kept" })] });
  });
});
