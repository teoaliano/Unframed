import { describe, expect, it } from "vitest";
import { initialClaudeState, mapClaudeMessage, type ClaudeMapState, type RuntimeEventDraft } from "../../src/index.ts";

const context = { turnId: "turn:1", registeredTools: ["canvas_read", "canvas_write"] };

/** Maps a recorded SDK session, in order. */
const replay = (messages: unknown[], state: ClaudeMapState = initialClaudeState()) => {
  const events: RuntimeEventDraft[] = [];
  let failure: string | undefined;
  for (const message of messages) {
    const mapped = mapClaudeMessage(state, message, context);
    state = mapped.state;
    events.push(...mapped.events);
    failure ??= mapped.toolsFailure;
  }
  return { events, state, failure };
};

const SESSION = "5f2c0f0e-1111-4222-8333-944445555666";

const init = (tools: string[]) => ({
  type: "system",
  subtype: "init",
  session_id: SESSION,
  tools,
  model: "claude-opus-5-5",
  permissionMode: "bypassPermissions",
  cwd: "/projects/board",
  mcp_servers: [{ name: "unframed", status: "connected" }],
  apiKeySource: "none",
});

describe("Claude event mapping", () => {
  it("maps init to session.configured, runs the canvas tools check and reports foreign MCP tools", () => {
    const ok = replay([init(["Read", "Bash", "mcp__unframed__canvas_read", "mcp__unframed__canvas_write", "mcp__github__search"])]);
    expect(ok.events).toEqual([
      { type: "thread.started", payload: { providerThreadId: SESSION } },
      {
        type: "session.configured",
        payload: {
          tools: ["Read", "Bash", "mcp__unframed__canvas_read", "mcp__unframed__canvas_write", "mcp__github__search"],
          foreign: ["mcp__github__search"],
          model: "claude-opus-5-5",
          permissionMode: "bypassPermissions",
          cwd: "/projects/board",
        },
      },
    ]);
    expect(ok.failure).toBeUndefined();
    expect(replay([init(["Read", "mcp__unframed__canvas_read"])]).failure).toBe(
      "The agent session started without the canvas tools (mcp__unframed__canvas_write). This is a bug in Unframed, not your setup.",
    );
  });

  it("streams partial text as assistant deltas and does not repeat it when the whole message arrives", () => {
    const { events } = replay([
      { type: "stream_event", session_id: SESSION, parent_tool_use_id: null, event: { type: "message_start", message: { id: "msg_1" } } },
      { type: "stream_event", session_id: SESSION, parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Hmm." } } },
      { type: "stream_event", session_id: SESSION, parent_tool_use_id: null, event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Set both " } } },
      { type: "stream_event", session_id: SESSION, parent_tool_use_id: null, event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "titles." } } },
      { type: "assistant", session_id: SESSION, uuid: "u1", parent_tool_use_id: null, message: { id: "msg_1", content: [{ type: "thinking", thinking: "Hmm." }, { type: "text", text: "Set both titles." }] } },
    ]);
    expect(events.slice(1)).toEqual([
      { type: "content.delta", turnId: "turn:1", itemId: "msg_1:0", payload: { streamKind: "reasoning_summary_text", delta: "Hmm." } },
      { type: "content.delta", turnId: "turn:1", itemId: "msg_1:1", payload: { streamKind: "assistant_text", delta: "Set both " } },
      { type: "content.delta", turnId: "turn:1", itemId: "msg_1:1", payload: { streamKind: "assistant_text", delta: "titles." } },
      { type: "item.completed", turnId: "turn:1", itemId: "msg_1:0", payload: { itemType: "reasoning", status: "completed" } },
      { type: "item.completed", turnId: "turn:1", itemId: "msg_1:1", payload: { itemType: "assistant_message", status: "completed" } },
    ]);
  });

  it("uses the assistant message's own text when there were no partial messages", () => {
    const { events, state } = replay([{ type: "assistant", uuid: "u9", parent_tool_use_id: null, message: { id: "msg_2", content: [{ type: "text", text: "Whole." }] } }]);
    expect(events[0]).toEqual({ type: "content.delta", turnId: "turn:1", itemId: "msg_2:0", payload: { streamKind: "assistant_text", delta: "Whole." } });
    expect(state.lastAssistantUuid).toBe("u9");
  });

  it("maps tool use to item.started by the tool's kind, and its result to item.completed, failed on an error", () => {
    const { events } = replay([
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          id: "msg_3",
          content: [
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
            { type: "tool_use", id: "t2", name: "mcp__unframed__canvas_read", input: {} },
            { type: "tool_use", id: "t3", name: "Read", input: { file_path: "/p/hero.png" } },
            { type: "tool_use", id: "t4", name: "Edit", input: { file_path: "/p/a.html" } },
            { type: "tool_use", id: "t5", name: "Task", input: { description: "look" } },
            { type: "tool_use", id: "t6", name: "WebSearch", input: { query: "fox" } },
            { type: "tool_use", id: "t7", name: "TodoWrite", input: {} },
          ],
        },
      },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "a.txt", is_error: false }, { type: "tool_result", tool_use_id: "t4", content: [{ type: "text", text: "nope" }], is_error: true }] } },
    ]);
    const started = events.filter((event) => event.type === "item.started").map((event) => [event.itemId, (event.payload as { itemType: string }).itemType]);
    expect(started).toEqual([
      ["t1", "command_execution"],
      ["t2", "mcp_tool_call"],
      ["t3", "image_view"],
      ["t4", "file_change"],
      ["t5", "collab_agent_tool_call"],
      ["t6", "web_search"],
      ["t7", "dynamic_tool_call"],
    ]);
    const completed = events.filter((event) => event.type === "item.completed");
    expect(completed.map((event) => [event.itemId, (event.payload as { status: string }).status, (event.payload as { itemType: string }).itemType])).toEqual([
      ["t1", "completed", "command_execution"],
      ["t4", "failed", "file_change"],
    ]);
    expect((completed[1]!.payload as { data: unknown }).data).toEqual({ toolName: "Edit", result: ["nope"] });
  });

  it("keeps a sub-agent's own tool blocks with its agent id and drops its text", () => {
    const { events } = replay([
      { type: "stream_event", parent_tool_use_id: "t5", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "sub-agent chatter" } } },
      { type: "assistant", parent_tool_use_id: "t5", message: { id: "msg_4", content: [{ type: "text", text: "sub-agent chatter" }, { type: "tool_use", id: "s1", name: "Grep", input: { pattern: "x" } }] } },
    ]);
    expect(events).toEqual([
      expect.objectContaining({ type: "item.started", itemId: "s1", payload: expect.objectContaining({ agentId: "t5", parentToolUseId: "t5", itemType: "dynamic_tool_call" }) }),
    ]);
  });

  it("maps api_retry, a rate limit event and the task messages", () => {
    const { events } = replay([
      { type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, retry_delay_ms: 4000, error_status: 529, error: "overloaded" },
      { type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", resetsAt: 1790000000 } },
      { type: "system", subtype: "task_started", task_id: "k1", tool_use_id: "t5", description: "Read the brief" },
      { type: "system", subtype: "task_progress", task_id: "k1", tool_use_id: "t5", description: "Read the brief", summary: "halfway" },
      { type: "system", subtype: "task_notification", task_id: "k1", tool_use_id: "t5", status: "failed", summary: "no brief" },
    ]);
    expect(events).toEqual([
      { type: "runtime.retry", turnId: "turn:1", payload: { attempt: 2, maxRetries: 10, delayMs: 4000, status: 529 } },
      { type: "account.rate-limits.updated", turnId: "turn:1", payload: { status: "allowed_warning", resetsAt: new Date(1790000000 * 1000).toISOString() } },
      { type: "task.started", turnId: "turn:1", payload: { taskId: "k1", agentId: "t5", title: "Read the brief", description: "Read the brief" } },
      { type: "task.progress", turnId: "turn:1", payload: { taskId: "k1", agentId: "t5", description: "Read the brief", summary: "halfway" } },
      { type: "task.completed", turnId: "turn:1", payload: { taskId: "k1", agentId: "t5", status: "failed", summary: "no brief" } },
    ]);
  });

  it("maps a success result to a completed turn with usage, cost, stop reason and the context window", () => {
    const { events } = replay([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Done.",
        stop_reason: "end_turn",
        total_cost_usd: 0.0123,
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 },
        modelUsage: { "claude-opus-5-5": { contextWindow: 200000 } },
      },
    ]);
    expect(events).toEqual([
      {
        type: "thread.token-usage.updated",
        turnId: "turn:1",
        payload: { usage: { usedTokens: 1125, maxTokens: 200000, totalProcessedTokens: 1125, inputTokens: 100, outputTokens: 20, cachedInputTokens: 1000, cacheCreationInputTokens: 5 } },
      },
      {
        type: "turn.completed",
        turnId: "turn:1",
        payload: { state: "completed", stopReason: "end_turn", usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 1000, cacheCreationInputTokens: 5 }, totalCostUsd: 0.0123 },
      },
    ]);
  });

  it("counts the context from the last top-level API call and reports the turn's sum as total processed", () => {
    const call = (id: string, usage: Record<string, number>, content: unknown[], parent: string | null = null) => ({
      type: "assistant",
      uuid: `u-${id}`,
      parent_tool_use_id: parent,
      message: { id, role: "assistant", content, usage },
    });
    const { events } = replay([
      call("msg_1", { input_tokens: 10, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 2_000, output_tokens: 300 }, [{ type: "tool_use", id: "t1", name: "Task", input: {} }]),
      call("msg_s", { input_tokens: 5, cache_read_input_tokens: 900_000, cache_creation_input_tokens: 0, output_tokens: 40 }, [{ type: "text", text: "sub" }], "t1"),
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
      call("msg_2", { input_tokens: 20, cache_read_input_tokens: 52_000, cache_creation_input_tokens: 400, output_tokens: 150 }, [{ type: "text", text: "Done." }]),
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Done.",
        usage: { input_tokens: 30, output_tokens: 450, cache_read_input_tokens: 102_000, cache_creation_input_tokens: 2_400 },
        modelUsage: { "claude-opus-5-5": { contextWindow: 1_000_000 } },
      },
    ]);
    expect(events.find((event) => event.type === "thread.token-usage.updated")).toEqual({
      type: "thread.token-usage.updated",
      turnId: "turn:1",
      payload: {
        usage: { usedTokens: 52_570, maxTokens: 1_000_000, totalProcessedTokens: 104_880, inputTokens: 30, outputTokens: 450, cachedInputTokens: 102_000, cacheCreationInputTokens: 2_400 },
      },
    });
  });

  it("keeps the last real call's context when a turn ends on an API error's stand-in message", () => {
    const zero = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const { events } = replay([
      { type: "assistant", uuid: "u-a", parent_tool_use_id: null, message: { id: "a", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t", name: "Read", input: {} }], usage: { input_tokens: 10, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 2_000, output_tokens: 300 } } },
      { type: "assistant", uuid: "u-s", parent_tool_use_id: null, message: { id: "s", model: "<synthetic>", content: [{ type: "text", text: "API Error: 500" }], usage: zero } },
      // A zero usage counts for nothing, whatever the model says.
      { type: "assistant", uuid: "u-z", parent_tool_use_id: null, message: { id: "z", model: "claude-opus-5-5", content: [], usage: zero } },
      { type: "result", subtype: "success", is_error: true, result: "API Error: 500", usage: { input_tokens: 10, output_tokens: 300, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 2_000 }, modelUsage: { "claude-opus-5-5": { contextWindow: 1_000_000 } } },
    ]);
    expect(events.find((event) => event.type === "thread.token-usage.updated")?.payload).toMatchObject({ usage: { usedTokens: 152_310, totalProcessedTokens: 152_310 } });
  });

  it("maps an error result to a failed turn with the SDK's subtype, and a success with API status 529 to a failure", () => {
    const failed = replay([{ type: "result", subtype: "error_max_turns", is_error: true, errors: [], usage: {}, total_cost_usd: 0 }]).events.at(-1);
    expect(failed).toMatchObject({ type: "turn.completed", payload: { state: "failed", errorSubtype: "error_max_turns" } });
    const overloaded = replay([{ type: "result", subtype: "success", is_error: false, api_error_status: 529, result: "", usage: {} }]).events.at(-1);
    expect(overloaded).toMatchObject({ type: "turn.completed", payload: { state: "failed", errorMessage: "Claude's API is overloaded (529). Try again shortly." } });
    expect(overloaded?.payload).not.toHaveProperty("errorSubtype");
  });
});
