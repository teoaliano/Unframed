/**
 * The Claude adapter's pure half (spec 07): how the Agent SDK's messages become canonical
 * runtime events, as t3code maps them. A small state carries what one message needs from
 * the ones before it (the tool a result answers, whether text arrived as deltas).
 */
import { checkCanvasTools } from "./turnText.ts";
import { classifyToolItem, requestTarget, type ItemType, type RuntimeEventDraft } from "./runtimeEvents.ts";

export interface ClaudeMapState {
  /** The API message the partial stream events belong to. */
  readonly streamingMessageId: string | undefined;
  /** Text blocks that already streamed as deltas, by `<message id>:<index>`. */
  readonly streamedBlocks: ReadonlyArray<string>;
  /** Each open tool use: its item type and name. */
  readonly tools: Readonly<Record<string, { readonly itemType: ItemType; readonly toolName: string; readonly agentId?: string }>>;
  /** The session id, once a message reported it. */
  readonly sessionId: string | undefined;
  /** The last assistant message's uuid: where a resume picks up. */
  readonly lastAssistantUuid: string | undefined;
}

export const initialClaudeState = (): ClaudeMapState => ({ streamingMessageId: undefined, streamedBlocks: [], tools: {}, sessionId: undefined, lastAssistantUuid: undefined });

export interface ClaudeMapContext {
  /** The chat's turn these messages belong to. */
  readonly turnId: string | undefined;
  /** The names the Unframed MCP server registers. */
  readonly registeredTools: ReadonlyArray<string>;
}

export interface ClaudeMapped {
  readonly state: ClaudeMapState;
  readonly events: ReadonlyArray<RuntimeEventDraft>;
  /** The init check failed: the turn fails with this before the model speaks. */
  readonly toolsFailure?: string;
}

const obj = (value: unknown): Record<string, any> => (typeof value === "object" && value !== null ? (value as Record<string, any>) : {});

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** The result's usage as the sidecar and the context meter read it. */
export const claudeUsage = (result: Record<string, any>): Record<string, number> => {
  const usage = obj(result.usage);
  const out: Record<string, number> = {};
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cached = num(usage.cache_read_input_tokens);
  const created = num(usage.cache_creation_input_tokens);
  if (input !== undefined) out.inputTokens = input;
  if (output !== undefined) out.outputTokens = output;
  if (cached !== undefined) out.cachedInputTokens = cached;
  if (created !== undefined) out.cacheCreationInputTokens = created;
  return out;
};

/** The context window the result's model usage reports, the largest when there are several. */
const contextWindow = (result: Record<string, any>): number | undefined => {
  let largest: number | undefined;
  for (const entry of Object.values(obj(result.modelUsage))) {
    const window = num(obj(entry).contextWindow);
    if (window !== undefined && (largest === undefined || window > largest)) largest = window;
  }
  return largest;
};

const blockText = (block: Record<string, any>): string => (typeof block.text === "string" ? block.text : typeof block.thinking === "string" ? block.thinking : "");

const toolResultText = (content: unknown): unknown => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof obj(part).text === "string" ? obj(part).text : part));
  return content;
};

/** Maps one SDK message. */
export const mapClaudeMessage = (state: ClaudeMapState, message: unknown, context: ClaudeMapContext): ClaudeMapped => {
  const m = obj(message);
  const events: RuntimeEventDraft[] = [];
  const turn = context.turnId === undefined ? {} : { turnId: context.turnId };
  let next: ClaudeMapState = state;
  let toolsFailure: string | undefined;
  if (typeof m.session_id === "string" && m.session_id !== state.sessionId) {
    next = { ...next, sessionId: m.session_id };
    events.push({ type: "thread.started", payload: { providerThreadId: m.session_id } });
  }

  switch (m.type) {
    case "system": {
      switch (m.subtype) {
        case "init": {
          const tools: string[] = Array.isArray(m.tools) ? m.tools.filter((tool: unknown): tool is string => typeof tool === "string") : [];
          const check = checkCanvasTools(context.registeredTools, tools);
          events.push({
            type: "session.configured",
            payload: {
              tools,
              foreign: check.foreign,
              ...(typeof m.model === "string" ? { model: m.model } : {}),
              ...(typeof m.permissionMode === "string" ? { permissionMode: m.permissionMode } : {}),
              ...(typeof m.cwd === "string" ? { cwd: m.cwd } : {}),
            },
          });
          if (check.failure) toolsFailure = check.failure;
          break;
        }
        case "api_retry":
          events.push({
            type: "runtime.retry",
            ...turn,
            payload: { attempt: num(m.attempt) ?? 0, maxRetries: num(m.max_retries) ?? 0, delayMs: num(m.retry_delay_ms) ?? 0, status: m.error_status ?? null },
          });
          break;
        case "task_started":
          events.push({
            type: "task.started",
            ...turn,
            payload: { taskId: String(m.task_id), agentId: String(m.tool_use_id ?? m.task_id), title: String(m.description ?? ""), description: String(m.description ?? "") },
          });
          break;
        case "task_progress":
          events.push({
            type: "task.progress",
            ...turn,
            payload: { taskId: String(m.task_id), agentId: String(m.tool_use_id ?? m.task_id), description: String(m.description ?? ""), ...(typeof m.summary === "string" ? { summary: m.summary } : {}) },
          });
          break;
        case "task_notification":
          events.push({
            type: "task.completed",
            ...turn,
            payload: { taskId: String(m.task_id), agentId: String(m.tool_use_id ?? m.task_id), status: String(m.status ?? "completed"), ...(typeof m.summary === "string" ? { summary: m.summary } : {}) },
          });
          break;
        default:
          break;
      }
      break;
    }

    case "rate_limit_event": {
      const info = obj(m.rate_limit_info);
      const resetsAt = num(info.resetsAt);
      events.push({
        type: "account.rate-limits.updated",
        ...turn,
        payload: { status: String(info.status ?? "allowed"), ...(resetsAt === undefined ? {} : { resetsAt: new Date(resetsAt * 1000).toISOString() }) },
      });
      break;
    }

    case "stream_event": {
      // A sub-agent's own text never reaches the chat.
      if (m.parent_tool_use_id) break;
      const event = obj(m.event);
      if (event.type === "message_start") {
        next = { ...next, streamingMessageId: String(obj(event.message).id ?? "") };
        break;
      }
      if (event.type !== "content_block_delta") break;
      const delta = obj(event.delta);
      const itemId = `${next.streamingMessageId ?? "message"}:${num(event.index) ?? 0}`;
      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text !== "") {
        if (!next.streamedBlocks.includes(itemId)) next = { ...next, streamedBlocks: [...next.streamedBlocks, itemId] };
        events.push({ type: "content.delta", ...turn, itemId, payload: { streamKind: "assistant_text", delta: delta.text } });
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking !== "") {
        if (!next.streamedBlocks.includes(itemId)) next = { ...next, streamedBlocks: [...next.streamedBlocks, itemId] };
        events.push({ type: "content.delta", ...turn, itemId, payload: { streamKind: "reasoning_summary_text", delta: delta.thinking } });
      }
      break;
    }

    case "assistant": {
      const body = obj(m.message);
      const agentId = typeof m.parent_tool_use_id === "string" ? m.parent_tool_use_id : undefined;
      if (typeof m.uuid === "string" && agentId === undefined) next = { ...next, lastAssistantUuid: m.uuid };
      const content: unknown[] = Array.isArray(body.content) ? body.content : [];
      for (const [index, raw] of content.entries()) {
        const block = obj(raw);
        const itemId = `${String(body.id ?? "message")}:${index}`;
        if (block.type === "tool_use") {
          const toolName = String(block.name ?? "tool");
          const input = obj(block.input);
          const itemType = classifyToolItem(toolName, input);
          const id = String(block.id ?? itemId);
          next = { ...next, tools: { ...next.tools, [id]: { itemType, toolName, ...(agentId === undefined ? {} : { agentId }) } } };
          events.push({
            type: "item.started",
            ...turn,
            itemId: id,
            payload: {
              itemType,
              status: "inProgress",
              title: toolName,
              detail: requestTarget(toolName, input),
              data: { toolName, input },
              ...(agentId === undefined ? {} : { agentId, parentToolUseId: agentId }),
            },
          });
          continue;
        }
        if (agentId !== undefined) continue;
        if (block.type === "text" || block.type === "thinking") {
          const text = blockText(block);
          const streamed = next.streamedBlocks.includes(itemId);
          const reasoning = block.type === "thinking";
          if (!streamed && text !== "") {
            // An older CLI sends no partial messages: the whole block is the text.
            events.push({ type: "content.delta", ...turn, itemId, payload: { streamKind: reasoning ? "reasoning_summary_text" : "assistant_text", delta: text } });
          }
          events.push({ type: "item.completed", ...turn, itemId, payload: { itemType: reasoning ? "reasoning" : "assistant_message", status: "completed" } });
        }
      }
      break;
    }

    case "user": {
      const content: unknown[] = Array.isArray(obj(m.message).content) ? obj(m.message).content : [];
      for (const raw of content) {
        const block = obj(raw);
        if (block.type !== "tool_result") continue;
        const id = String(block.tool_use_id ?? "");
        const tool = next.tools[id];
        const itemType = tool?.itemType ?? "dynamic_tool_call";
        const { [id]: _done, ...rest } = next.tools;
        next = { ...next, tools: rest };
        events.push({
          type: "item.completed",
          ...turn,
          itemId: id,
          payload: {
            itemType,
            status: block.is_error === true ? "failed" : "completed",
            title: tool?.toolName ?? "tool",
            data: { toolName: tool?.toolName ?? "tool", result: toolResultText(block.content) },
            ...(tool?.agentId === undefined ? {} : { agentId: tool.agentId, parentToolUseId: tool.agentId }),
          },
        });
      }
      break;
    }

    case "result": {
      const overloaded = m.subtype === "success" && m.api_error_status === 529;
      const failed = m.subtype !== "success" || overloaded || m.is_error === true;
      const usage = claudeUsage(m);
      const window = contextWindow(m);
      const used = (usage.inputTokens ?? 0) + (usage.cachedInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0) + (usage.outputTokens ?? 0);
      events.push({
        type: "thread.token-usage.updated",
        ...turn,
        payload: { usage: { usedTokens: used, ...(window === undefined ? {} : { maxTokens: window }), ...usage } },
      });
      const errors: string[] = Array.isArray(m.errors) ? m.errors.filter((error: unknown): error is string => typeof error === "string") : [];
      events.push({
        type: "turn.completed",
        ...turn,
        payload: {
          state: failed ? "failed" : "completed",
          ...(typeof m.stop_reason === "string" ? { stopReason: m.stop_reason } : {}),
          usage,
          ...(num(m.total_cost_usd) === undefined ? {} : { totalCostUsd: m.total_cost_usd }),
          ...(failed && m.subtype !== "success" ? { errorSubtype: String(m.subtype) } : {}),
          ...(overloaded ? { errorMessage: "Claude's API is overloaded (529). Try again shortly." } : failed && errors[0] ? { errorMessage: errors[0] } : failed && typeof m.result === "string" && m.result !== "" ? { errorMessage: m.result } : {}),
        },
      });
      next = { ...next, streamedBlocks: [], streamingMessageId: undefined };
      break;
    }

    default:
      break;
  }
  return { state: next, events, ...(toolsFailure === undefined ? {} : { toolsFailure }) };
};
