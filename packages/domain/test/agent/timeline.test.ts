import { describe, expect, it } from "vitest";
import { buildTimeline, type Chat, type ChatActivity, type ChatMessage, type WorkRow } from "../../src/index.ts";

const at = (ms: number) => new Date(Date.UTC(2026, 8, 29, 10, 0, 0, ms)).toISOString();

const message = (id: string, role: ChatMessage["role"], createdAt: string, text = id): ChatMessage => ({
  id,
  role,
  text,
  turnId: "t1",
  streaming: false,
  createdAt,
  updatedAt: createdAt,
});

const tool = (kind: "tool.started" | "tool.completed", itemId: string, sequence: number, createdAt: string): ChatActivity => ({
  id: `${kind}:${itemId}`,
  tone: "tool",
  kind,
  summary: kind,
  payload: { itemId, itemType: "mcp_tool_call", status: kind === "tool.started" ? "inProgress" : "completed", data: { toolName: "mcp__unframed__canvas_write" } },
  turnId: "t1",
  sequence,
  createdAt,
});

const chat = (messages: ChatMessage[], activities: ChatActivity[]): Chat => ({
  id: "chat-1",
  projectId: "p",
  createdAt: at(0),
  updatedAt: at(0),
  deletedAt: null,
  title: "",
  titledBy: null,
  tags: [],
  modelSelection: { provider: "claude", model: "", traits: {} },
  runtimeMode: "full-access",
  interactionMode: "default",
  lastClock: null,
  latestTurn: null,
  session: null,
  messages,
  activities,
  proposedPlans: [],
  turns: [
    { turnId: "t1", turnCount: 1, state: "completed", requestedAt: at(0), startedAt: at(1), completedAt: at(40), pendingMessageId: "u1", assistantMessageId: "a1" },
  ],
});

const blocks = (value: Chat) => buildTimeline(value)[0]!.blocks.map((block) => (block.kind === "message" ? block.message.id : block.kind === "work" ? (block.entries as WorkRow[]).map((row) => `${row.id}:${row.state}`).join(" ") : block.kind));

describe("the transcript's timeline", () => {
  it("keeps a tool call whole when its end is stamped in the same millisecond as the reply that follows it", () => {
    const value = chat([message("u1", "user", at(0)), message("a1", "assistant", at(38))], [tool("tool.started", "item-5", 16, at(22)), tool("tool.completed", "item-5", 18, at(38))]);
    expect(blocks(value)).toEqual(["u1", "item-5:completed", "a1"]);
  });

  it("keeps a call whole even when its end is stamped after the reply began", () => {
    const value = chat([message("u1", "user", at(0)), message("a1", "assistant", at(30))], [tool("tool.started", "item-5", 16, at(22)), tool("tool.completed", "item-5", 18, at(31))]);
    expect(blocks(value)).toEqual(["u1", "item-5:completed", "a1"]);
  });

  it("still splits the work around a message between two calls", () => {
    const value = chat(
      [message("u1", "user", at(0)), message("a1", "assistant", at(20)), message("a2", "assistant", at(40))],
      [tool("tool.started", "item-1", 10, at(10)), tool("tool.completed", "item-1", 11, at(12)), tool("tool.started", "item-2", 12, at(30)), tool("tool.completed", "item-2", 13, at(32))],
    );
    expect(blocks(value)).toEqual(["u1", "item-1:completed", "a1", "item-2:completed", "a2"]);
  });
});
