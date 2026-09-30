import { describe, expect, it } from "vitest";
import { codexApprovalAnswer, codexUserInputAnswer, mapCodexNotification, readCodexRequest } from "../../src/index.ts";

const TURN = "turn:1";

describe("Codex notification mapping", () => {
  it("maps the thread and turn lifecycle", () => {
    expect(mapCodexNotification("thread/started", { thread: { id: "th_1" } }, undefined)).toEqual([{ type: "thread.started", payload: { providerThreadId: "th_1" } }]);
    expect(mapCodexNotification("turn/started", { threadId: "th_1", turn: { id: "cx_1" } }, TURN)).toEqual([{ type: "turn.started", turnId: TURN, payload: {} }]);
    expect(mapCodexNotification("turn/completed", { threadId: "th_1", turn: { id: "cx_1", status: "completed" } }, TURN)).toEqual([
      { type: "turn.completed", turnId: TURN, payload: { state: "completed" } },
    ]);
    expect(mapCodexNotification("turn/completed", { turn: { status: "interrupted" } }, TURN)[0]?.payload).toEqual({ state: "interrupted" });
  });

  it("maps a failed turn onto the failure sentences, and a usage-limit failure onto a rejected notice", () => {
    expect(mapCodexNotification("turn/completed", { turn: { status: "failed", error: { message: "Turn exceeded max turns" } } }, TURN)).toEqual([
      {
        type: "turn.completed",
        turnId: TURN,
        payload: { state: "failed", errorMessage: "The agent reached its limit of steps for one turn and stopped. Ask again, more narrowly — one change at a time." },
      },
    ]);
    expect(mapCodexNotification("turn/completed", { turn: { status: "failed", error: { message: "stream disconnected" } } }, TURN)[0]?.payload).toEqual({
      state: "failed",
      errorMessage: "The agent failed: stream disconnected.",
    });
    expect(mapCodexNotification("turn/completed", { turn: { status: "failed", error: { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" } } }, TURN).map((event) => event.type)).toEqual([
      "account.rate-limits.updated",
      "turn.completed",
    ]);
  });

  it("maps items and their deltas", () => {
    expect(mapCodexNotification("item/started", { item: { type: "commandExecution", id: "i1", command: "ls -la", status: "inProgress" } }, TURN)).toEqual([
      { type: "item.started", turnId: TURN, itemId: "i1", payload: { itemType: "command_execution", status: "inProgress", title: "ls -la", data: { type: "commandExecution", id: "i1", command: "ls -la", status: "inProgress" } } },
    ]);
    expect(mapCodexNotification("item/completed", { item: { type: "mcpToolCall", id: "i2", server: "unframed", tool: "canvas_read", status: "completed" } }, TURN)[0]).toMatchObject({
      type: "item.completed",
      payload: { itemType: "mcp_tool_call", status: "completed", title: "mcp__unframed__canvas_read" },
    });
    expect(mapCodexNotification("item/completed", { item: { type: "fileChange", id: "i3", status: "declined" } }, TURN)[0]?.payload).toMatchObject({ status: "declined" });
    expect(mapCodexNotification("item/agentMessage/delta", { itemId: "m1", delta: "Hello" }, TURN)).toEqual([
      { type: "content.delta", turnId: TURN, itemId: "m1", payload: { streamKind: "assistant_text", delta: "Hello" } },
    ]);
    expect(mapCodexNotification("item/reasoning/textDelta", { itemId: "r1", delta: "think" }, TURN)[0]?.payload).toEqual({ streamKind: "reasoning_text", delta: "think" });
    expect(mapCodexNotification("item/reasoning/summaryTextDelta", { itemId: "r1", delta: "sum" }, TURN)[0]?.payload).toEqual({ streamKind: "reasoning_summary_text", delta: "sum" });
    expect(mapCodexNotification("item/commandExecution/outputDelta", { itemId: "i1", delta: "a.txt" }, TURN)[0]?.payload).toEqual({ streamKind: "command_output", delta: "a.txt" });
    expect(mapCodexNotification("item/completed", { item: { type: "agentMessage", id: "m1", text: "Hello there" } }, TURN)).toEqual([
      { type: "item.completed", turnId: TURN, itemId: "m1", payload: { itemType: "assistant_message", status: "completed", text: "Hello there" } },
    ]);
    expect(mapCodexNotification("item/started", { item: { type: "userMessage", id: "u1" } }, TURN)).toEqual([]);
  });

  it("maps the plan: steps, deltas and a completed plan item as the proposed plan", () => {
    expect(mapCodexNotification("turn/plan/updated", { plan: [{ step: "Read", status: "completed" }, { step: "Write", status: "inProgress" }, { step: "Check", status: "pending" }] }, TURN)).toEqual([
      { type: "turn.plan.updated", turnId: TURN, payload: { plan: [{ step: "Read", status: "completed" }, { step: "Write", status: "inProgress" }, { step: "Check", status: "pending" }] } },
    ]);
    expect(mapCodexNotification("item/plan/delta", { itemId: "p1", delta: "# Pl" }, TURN)[0]).toMatchObject({ type: "turn.proposed.delta", payload: { delta: "# Pl" } });
    expect(mapCodexNotification("item/completed", { item: { type: "plan", id: "p1", text: "# Plan" } }, TURN)).toEqual([
      { type: "turn.proposed.completed", turnId: TURN, itemId: "p1", payload: { planMarkdown: "# Plan" } },
    ]);
  });

  it("maps token usage, rate limits and errors", () => {
    expect(
      mapCodexNotification(
        "thread/tokenUsage/updated",
        { tokenUsage: { total: { inputTokens: 900, outputTokens: 100, cachedInputTokens: 400, reasoningOutputTokens: 30, totalTokens: 1000 }, last: { totalTokens: 600 }, modelContextWindow: 272000 } },
        TURN,
      ),
    ).toEqual([
      {
        type: "thread.token-usage.updated",
        turnId: TURN,
        payload: { usage: { usedTokens: 600, maxTokens: 272000, inputTokens: 900, outputTokens: 100, cachedInputTokens: 400, reasoningTokens: 30 } },
      },
    ]);
    expect(mapCodexNotification("account/rateLimits/updated", { rateLimits: { primary: { usedPercent: 85, resetsAt: 1790000000 } } }, TURN)[0]?.payload).toEqual({
      status: "allowed_warning",
      resetsAt: new Date(1790000000 * 1000).toISOString(),
    });
    expect(mapCodexNotification("account/rateLimits/updated", { rateLimits: { primary: { usedPercent: 100 } } }, TURN)[0]?.payload).toEqual({ status: "rejected" });
    expect(mapCodexNotification("error", { error: { message: "reconnecting" }, willRetry: true }, TURN)[0]).toMatchObject({ type: "runtime.warning", payload: { message: "reconnecting" } });
    expect(mapCodexNotification("error", { error: { message: "gave up" }, willRetry: false }, TURN)[0]).toMatchObject({ type: "runtime.error" });
  });
});

describe("Codex server requests", () => {
  it("reads approvals, questions and elicitations, and anything else as unknown", () => {
    expect(readCodexRequest("item/commandExecution/requestApproval", { command: "rm -rf build", cwd: "/p" })).toMatchObject({
      kind: "approval",
      requestType: "command_execution_approval",
      detail: "rm -rf build",
    });
    expect(readCodexRequest("item/fileChange/requestApproval", { itemId: "f1", reason: "write a.html" })).toMatchObject({ kind: "approval", requestType: "file_change_approval" });
    expect(
      readCodexRequest("item/tool/requestUserInput", {
        questions: [{ id: "look", header: "Look", question: "Which look?", options: [{ label: "Warm", description: "Cream" }], isOther: true }],
      }),
    ).toEqual({
      kind: "question",
      questions: [{ id: "look", header: "Look", question: "Which look?", options: [{ label: "Warm", description: "Cream" }], allowCustomAnswer: true, multiSelect: false }],
    });
    expect(readCodexRequest("mcpServer/elicitation/request", { serverName: "unframed" })).toEqual({ kind: "elicitation", server: "unframed" });
    expect(readCodexRequest("account/chatgptAuthTokens/refresh", {})).toEqual({ kind: "unknown" });
  });

  it("answers a decision as it is, and a question's answers as lists", () => {
    expect(codexApprovalAnswer("acceptForSession")).toEqual({ decision: "acceptForSession" });
    expect(codexUserInputAnswer({ look: "Warm", sections: ["Hero", "Gallery"] })).toEqual({ answers: { look: { answers: ["Warm"] }, sections: { answers: ["Hero", "Gallery"] } } });
  });
});
