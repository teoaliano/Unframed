import { describe, expect, it } from "vitest";
import {
  ACTIVITY_FAILED,
  ACTIVITY_LANDED,
  ACTIVITY_STARTED,
  decidePermission,
  describeTool,
  generationRecapLine,
  generationSpendOf,
  landedSummary,
  PLAN_NO_WRITES_MESSAGE,
  type ChatActivity,
} from "../../src/index.ts";

const generate = (runtimeMode: "approval-required" | "full-access", interactionMode: "default" | "plan" = "default") =>
  decidePermission({ runtimeMode, interactionMode, tool: "mcp__unframed__generate", input: { medium: "image", sources: ["shape:p1"] } });

const activity = (kind: string, turnId: string | null, payload: unknown): ChatActivity => ({
  id: `${kind}-${Math.random()}`,
  tone: "info",
  kind,
  summary: kind,
  payload,
  turnId,
  sequence: 0,
  createdAt: "2026-10-15T00:00:00.000Z",
});

describe("generate's permission (in-app agents)", () => {
  it("asks in Supervised mode, as a dynamic tool call the detail of which names the estimate", () => {
    expect(generate("approval-required")).toEqual({ kind: "ask", requestType: "dynamic_tool_call" });
  });

  it("runs at once in Full access", () => {
    expect(generate("full-access")).toEqual({ kind: "allow" });
  });

  it("is refused in plan mode, with the plan's no-writes sentence", () => {
    expect(generate("full-access", "plan")).toEqual({ kind: "deny", message: PLAN_NO_WRITES_MESSAGE });
  });
});

describe("the work log's row for a generation", () => {
  it.each([
    ["image", "Started an image generation"],
    ["video", "Started a video generation"],
    ["text", "Started a text generation"],
  ])("names a %s start", (medium, label) => {
    const described = describeTool({
      toolName: "mcp__unframed__generate",
      itemType: "mcp_tool_call",
      toolInput: { medium, sources: ["shape:p1"] },
      data: {},
      result: {},
      state: "inProgress",
    });
    expect(described).toEqual({ label, action: "tool" });
  });
});

describe("a turn's generation spend", () => {
  it("counts starts, landings and failures in its own turn only", () => {
    const activities = [
      activity(ACTIVITY_STARTED, "t1", { count: 2 }),
      activity(ACTIVITY_LANDED, "t1", { cost: 0.04 }),
      activity(ACTIVITY_LANDED, "t1", { cost: null }),
      activity(ACTIVITY_STARTED, "t2", { count: 5 }),
      activity(ACTIVITY_FAILED, "t1", { count: 0 }),
    ];
    expect(generationSpendOf(activities, "t1")).toEqual({ started: 2, landed: 2, failed: 0, spent: 0.04, running: 0 });
    expect(generationSpendOf(activities, "t2")).toEqual({ started: 5, landed: 0, failed: 0, spent: 0, running: 5 });
  });

  it("says what it spent, and how many are still running", () => {
    expect(generationRecapLine(generationSpendOf([activity(ACTIVITY_STARTED, "t1", { count: 1 }), activity(ACTIVITY_LANDED, "t1", { cost: 0.042 })], "t1"))).toBe(
      "Spent $0.04 on 1 generation.",
    );
    expect(
      generationRecapLine(generationSpendOf([activity(ACTIVITY_STARTED, "t1", { count: 3 }), activity(ACTIVITY_LANDED, "t1", { cost: 0.5 }), activity(ACTIVITY_FAILED, "t1", { count: 1 })], "t1")),
    ).toBe("Spent $0.50 on 1 generation, 1 still running.");
  });

  it("has no line for a turn that started no generation", () => {
    expect(generationRecapLine(generationSpendOf([], "t1"))).toBeUndefined();
  });

  it("writes a landing's summary with its cost to four places, or without one", () => {
    expect(landedSummary("image", 0.042)).toBe("Generated an image ($0.0420)");
    expect(landedSummary("video", null)).toBe("Generated a video");
    expect(landedSummary("text", 0.001)).toBe("Generated a text answer ($0.0010)");
  });
});
