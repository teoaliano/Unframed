import { describe, expect, it } from "vitest";
import { chatSummary } from "../../src/index.ts";
import { chatOf, NOW, run, started } from "./chatFixtures.ts";

const delta = (text: string) => ({ type: "thread.message.assistant.delta" as const, messageId: "assistant:i1", turnId: "turn:m1", delta: text });
const session = (status: "running" | "ready" | "idle" | "error" | "interrupted" | "stopped", lastError: string | null = null) => ({
  type: "thread.session.set" as const,
  session: { status, activeTurnId: status === "running" ? "turn:m1" : null, lastError },
});

describe("streaming messages", () => {
  it("appends each delta and ties the reply to its turn", () => {
    const model = run(run(started(), delta("Set both ")), delta("titles."));
    const chat = chatOf(model);
    expect(chat.messages.at(-1)).toMatchObject({ id: "assistant:i1", role: "assistant", text: "Set both titles.", streaming: true });
    expect(chat.latestTurn?.assistantMessageId).toBe("assistant:i1");
  });

  it("replaces the text on completion when the completion has text, and keeps it otherwise", () => {
    const streamed = run(started(), delta("draft"));
    expect(chatOf(run(streamed, { type: "thread.message.assistant.complete", messageId: "assistant:i1", turnId: "turn:m1", text: "Final." })).messages.at(-1)).toMatchObject({
      text: "Final.",
      streaming: false,
    });
    expect(chatOf(run(streamed, { type: "thread.message.assistant.complete", messageId: "assistant:i1", turnId: "turn:m1" })).messages.at(-1)).toMatchObject({
      text: "draft",
      streaming: false,
    });
  });
});

describe("turns settle when the session leaves running", () => {
  it.each([
    ["ready", "completed"],
    ["idle", "completed"],
    ["error", "error"],
    ["interrupted", "interrupted"],
    ["stopped", "interrupted"],
  ] as const)("session %s settles the turn %s", (status, state) => {
    const model = run(run(started(), session("running")), session(status));
    expect(chatOf(model).latestTurn).toMatchObject({ state, completedAt: NOW });
    expect(chatOf(model).turns[0]?.state).toBe(state);
  });

  it("keeps the turn running while the session runs, and stamps when it started", () => {
    const chat = chatOf(run(started(), session("running")));
    expect(chat.latestTurn).toMatchObject({ state: "running", startedAt: NOW, completedAt: null });
  });

  it("marks the chat failed in its summary after an error, running while it runs", () => {
    expect(chatSummary(chatOf(started())).status).toBe("running");
    expect(chatSummary(chatOf(run(started(), session("error", "boom")))).status).toBe("failed");
    expect(chatSummary(chatOf(run(started(), session("ready")))).status).toBe("idle");
  });

  it("stamps lastClock when the turn settles", () => {
    expect(chatOf(run(run(started(), session("ready")), { type: "thread.turn.settle", turnCount: 1, clock: 42 })).lastClock).toBe(42);
  });
});

describe("reverting to a checkpoint", () => {
  it("keeps the turns up to the count and their messages, activities and plans, and drops the rest", () => {
    let model = run(started(), session("ready"));
    model = run(model, { type: "thread.turn.start", message: { messageId: "m2", text: "now blue", attachments: [] }, createdAt: NOW });
    model = run(model, { type: "thread.message.assistant.delta", messageId: "assistant:i2", turnId: "turn:m2", delta: "Blue." });
    model = run(model, {
      type: "thread.activity.append",
      activity: { id: "a2", tone: "tool", kind: "tool.completed", summary: "canvas_write", payload: {}, turnId: "turn:m2", createdAt: NOW },
    });
    model = run(model, { type: "thread.proposed-plan.upsert", planId: "plan:chat-1:turn:2", turnId: "turn:m2", planMarkdown: "# Plan" });
    model = run(model, session("ready"));
    const chat = chatOf(run(model, { type: "thread.checkpoint.revert", turnCount: 1, restoreCanvas: false }));
    expect(chat.turns.map((turn) => turn.turnCount)).toEqual([1]);
    expect(chat.messages.map((message) => message.id)).toEqual(["m1"]);
    expect(chat.activities).toEqual([]);
    expect(chat.proposedPlans).toEqual([]);
    expect(chat.latestTurn?.turnId).toBe("turn:m1");
  });
});

describe("pending requests come from activities", () => {
  it("opens with a requested activity and closes with the resolved one", () => {
    const requested = run(started(), {
      type: "thread.activity.append",
      activity: { id: "r", tone: "approval", kind: "approval.requested", summary: "", payload: { requestId: "req-1" }, turnId: "turn:m1", createdAt: NOW },
    });
    expect(chatSummary(chatOf(requested)).hasPendingApproval).toBe(true);
    const resolved = run(requested, {
      type: "thread.activity.append",
      activity: { id: "s", tone: "approval", kind: "approval.resolved", summary: "", payload: { requestId: "req-1", decision: "accept" }, turnId: "turn:m1", createdAt: NOW },
    });
    expect(chatSummary(chatOf(resolved)).hasPendingApproval).toBe(false);
  });
});

describe("the summary", () => {
  it("previews the first message in 80 characters and counts turns", () => {
    const summary = chatSummary(chatOf(started(undefined, "p".repeat(100))));
    expect(summary.preview).toBe("p".repeat(80));
    expect(summary.turnCount).toBe(1);
  });
});
