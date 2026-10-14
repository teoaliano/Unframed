import { describe, expect, it } from "vitest";
import { continuableChat, emptyProjectChats, OUTSIDE_CHAT_REFUSAL, type RailChat } from "../../src/index.ts";
import { chatOf, created, decideOn, NOW, run } from "./chatFixtures.ts";

const OUTSIDE = { connectionId: "conn-1", sessionId: "sess-1", client: "claude-code" as const };

/** An outside chat with its first turn open. */
const outsideChat = (turnId = "t1") => {
  const model = run(emptyProjectChats("board"), {
    type: "thread.outside.create",
    threadId: "chat-o",
    title: "Claude Code · 3:42 pm",
    outside: OUTSIDE,
    createdAt: NOW,
  });
  return run(model, { type: "thread.outside.turn.begin", threadId: "chat-o", turnId, createdAt: NOW });
};

/** Settles the chat's open outside turn the way the engine does: the turn, then the session. */
const settled = (model: ReturnType<typeof outsideChat>, turnCount: number) => {
  const turned = run(model, { type: "thread.turn.settle", threadId: "chat-o", turnCount, clock: 7 });
  const files = run(turned, { type: "thread.turn.files.complete", threadId: "chat-o", turnCount, files: [] });
  return run(files, { type: "thread.session.set", threadId: "chat-o", session: { status: "ready", activeTurnId: null, lastError: null } });
};

describe("an outside chat", () => {
  it("is made with its provider outside, its connection and session, and its title", () => {
    const chat = chatOf(outsideChat(), "chat-o");
    expect(chat.modelSelection).toEqual({ provider: "outside", model: "", traits: {} });
    expect(chat.outside).toEqual(OUTSIDE);
    expect(chat.title).toBe("Claude Code · 3:42 pm");
    expect(chat.titledBy).toBe("user");
    expect(chat.messages).toEqual([]);
  });

  it("opens a running turn with no message, numbered after the kept turns, with the session running", () => {
    const chat = chatOf(outsideChat("t1"), "chat-o");
    expect(chat.latestTurn).toMatchObject({ turnId: "t1", turnCount: 1, state: "running" });
    expect(chat.turns[0]).toMatchObject({ turnId: "t1", pendingMessageId: null, assistantMessageId: null });
    expect(chat.session).toEqual({ status: "running", activeTurnId: "t1", lastError: null });
  });

  it("refuses a second open turn while one runs, and numbers the next turn after a settled one", () => {
    const open = outsideChat("t1");
    expect(decideOn(open, { type: "thread.outside.turn.begin", threadId: "chat-o", turnId: "t2", createdAt: NOW })).toMatchObject({
      ok: false,
      rejection: { code: "conflict", message: "A turn is already open in this chat." },
    });
    const done = settled(open, 1);
    expect(chatOf(done, "chat-o").latestTurn?.state).toBe("completed");
    const next = run(done, { type: "thread.outside.turn.begin", threadId: "chat-o", turnId: "t2", createdAt: NOW });
    expect(chatOf(next, "chat-o").latestTurn).toMatchObject({ turnId: "t2", turnCount: 2, state: "running" });
  });

  it("is never made by a web command with provider outside", () => {
    expect(
      decideOn(created(), {
        type: "thread.create",
        threadId: "chat-x",
        modelSelection: { provider: "outside", model: "", traits: {} },
        createdAt: NOW,
      }),
    ).toMatchObject({ ok: false, rejection: { code: "bad_request", message: "Only an outside agent's first call makes an outside chat." } });
  });

  it.each([
    ["a turn", { type: "thread.turn.start", message: { messageId: "m", text: "hi", attachments: [] }, createdAt: NOW }],
    ["a model change", { type: "thread.meta.update", modelSelection: { provider: "claude", model: "", traits: {} } }],
    ["the runtime mode", { type: "thread.runtime-mode.set", runtimeMode: "auto" }],
    ["the interaction mode", { type: "thread.interaction-mode.set", interactionMode: "plan" }],
    ["a checkpoint revert", { type: "thread.checkpoint.revert", turnCount: 0, restoreCanvas: false }],
  ] as const)("refuses %s from the web", (_, command) => {
    const chat = settled(outsideChat(), 1);
    expect(decideOn(chat, { ...command, threadId: "chat-o" } as never)).toMatchObject({
      ok: false,
      rejection: { code: "conflict", message: OUTSIDE_CHAT_REFUSAL },
    });
  });

  it("still takes a title from the web", () => {
    const chat = settled(outsideChat(), 1);
    const renamed = run(chat, { type: "thread.meta.update", threadId: "chat-o", title: "Landing page" });
    expect(chatOf(renamed, "chat-o")).toMatchObject({ title: "Landing page", titledBy: "user" });
  });

  it("can be deleted when no turn is open, and not while one is", () => {
    const open = outsideChat();
    expect(decideOn(open, { type: "thread.delete", threadId: "chat-o" })).toMatchObject({
      ok: false,
      rejection: { code: "conflict" },
    });
    expect(decideOn(settled(open, 1), { type: "thread.delete", threadId: "chat-o" })).toMatchObject({ ok: true });
  });
});

describe("continuable chats exclude outside chats", () => {
  const rail = (id: string, outside?: typeof OUTSIDE): RailChat => ({
    id,
    title: id,
    preview: "",
    tags: [],
    status: "idle",
    createdAt: "2026-10-14T10:00:00.000Z",
    ...(outside === undefined ? {} : { outside }),
  });

  it("skips a newer outside chat and continues the in-app one", () => {
    const newer = { ...rail("outside", OUTSIDE), createdAt: "2026-10-14T11:00:00.000Z" };
    expect(continuableChat([rail("in-app"), newer], [])?.id).toBe("in-app");
  });

  it("answers nothing when only outside chats are left", () => {
    expect(continuableChat([rail("outside", OUTSIDE)], [])).toBeUndefined();
  });
});
