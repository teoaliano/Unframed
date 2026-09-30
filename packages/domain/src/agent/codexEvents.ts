/**
 * The Codex adapter's pure half (spec 07): how `codex app-server` notifications and server
 * requests become canonical runtime events, as t3code maps them, and what the person's
 * answers become on the wire.
 */
import type { ApprovalDecision } from "./chatModel.ts";
import { codexFailureSentence } from "./turnText.ts";
import type { ItemType, RequestType, RuntimeEventDraft, UserQuestion } from "./runtimeEvents.ts";

const obj = (value: unknown): Record<string, any> => (typeof value === "object" && value !== null ? (value as Record<string, any>) : {});

const ITEM_TYPES: Readonly<Record<string, ItemType>> = {
  commandExecution: "command_execution",
  fileChange: "file_change",
  mcpToolCall: "mcp_tool_call",
  dynamicToolCall: "dynamic_tool_call",
  collabAgentToolCall: "collab_agent_tool_call",
  collabToolCall: "collab_agent_tool_call",
  webSearch: "web_search",
  imageView: "image_view",
  agentMessage: "assistant_message",
  reasoning: "reasoning",
  plan: "plan",
  contextCompaction: "context_compaction",
};

/** A Codex item's canonical type; `undefined` for items the chat does not show (the person's own message). */
export const codexItemType = (type: unknown): ItemType | undefined => (typeof type === "string" ? ITEM_TYPES[type] : undefined);

const itemTitle = (item: Record<string, any>, itemType: ItemType): string => {
  if (itemType === "command_execution") return typeof item.command === "string" ? item.command : "command";
  if (itemType === "mcp_tool_call") return `mcp__${String(item.server ?? "")}__${String(item.tool ?? "")}`;
  if (itemType === "file_change") return "file change";
  return String(item.type ?? itemType);
};

const itemStatus = (item: Record<string, any>, completed: boolean): string => {
  const status = String(item.status ?? "");
  if (status === "failed" || status === "declined") return status;
  return completed ? "completed" : "inProgress";
};

/** Rate-limit windows as a status: at or over the limit is rejected, near it a warning. */
export const codexRateLimitStatus = (rateLimits: unknown): { status: "allowed" | "allowed_warning" | "rejected"; resetsAt?: string } => {
  const windows = [obj(obj(rateLimits).primary), obj(obj(rateLimits).secondary)];
  let status: "allowed" | "allowed_warning" | "rejected" = "allowed";
  let resetsAt: string | undefined;
  for (const window of windows) {
    const used = typeof window.usedPercent === "number" ? window.usedPercent : undefined;
    if (used === undefined) continue;
    const reset = typeof window.resetsAt === "number" ? new Date(window.resetsAt * 1000).toISOString() : undefined;
    if (used >= 100) {
      status = "rejected";
      resetsAt = reset;
    } else if (used >= 80 && status === "allowed") {
      status = "allowed_warning";
      resetsAt = reset;
    }
  }
  return { status, ...(resetsAt === undefined ? {} : { resetsAt }) };
};

const isUsageLimit = (error: Record<string, any>): boolean => {
  const info = error.codexErrorInfo;
  return info === "usageLimitExceeded" || typeof obj(info).usageLimitExceeded === "object" || /usage limit/i.test(String(error.message ?? ""));
};

/** Maps one notification. `turnId` is the chat's turn the Codex turn belongs to. */
export const mapCodexNotification = (method: string, params: unknown, turnId: string | undefined): RuntimeEventDraft[] => {
  const p = obj(params);
  const turn = turnId === undefined ? {} : { turnId };
  switch (method) {
    case "thread/started":
      return [{ type: "thread.started", payload: { providerThreadId: String(obj(p.thread).id ?? p.threadId ?? "") } }];
    case "turn/started":
      return [{ type: "turn.started", ...turn, payload: {} }];
    case "turn/completed":
    case "turn/aborted": {
      const codexTurn = obj(p.turn);
      const status = String(codexTurn.status ?? (method === "turn/aborted" ? "interrupted" : "completed"));
      const error = obj(codexTurn.error ?? p.error);
      if (status === "interrupted" || method === "turn/aborted") return [{ type: "turn.completed", ...turn, payload: { state: "interrupted" } }];
      if (status === "failed") {
        const events: RuntimeEventDraft[] = [];
        if (isUsageLimit(error)) events.push({ type: "account.rate-limits.updated", ...turn, payload: { status: "rejected" } });
        events.push({ type: "turn.completed", ...turn, payload: { state: "failed", errorMessage: codexFailureSentence(typeof error.message === "string" ? error.message : undefined) } });
        return events;
      }
      return [{ type: "turn.completed", ...turn, payload: { state: "completed" } }];
    }
    case "item/started":
    case "item/completed": {
      const item = obj(p.item);
      const itemType = codexItemType(item.type);
      if (itemType === undefined) return [];
      const completed = method === "item/completed";
      const itemId = String(item.id ?? "");
      if (itemType === "assistant_message") {
        return completed ? [{ type: "item.completed", ...turn, itemId, payload: { itemType, status: "completed", ...(typeof item.text === "string" ? { text: item.text } : {}) } }] : [];
      }
      if (itemType === "reasoning") return completed ? [{ type: "item.completed", ...turn, itemId, payload: { itemType, status: "completed" } }] : [];
      if (itemType === "plan") {
        return completed && typeof item.text === "string" ? [{ type: "turn.proposed.completed", ...turn, itemId, payload: { planMarkdown: item.text } }] : [];
      }
      return [
        {
          type: completed ? "item.completed" : "item.started",
          ...turn,
          itemId,
          payload: { itemType, status: itemStatus(item, completed), title: itemTitle(item, itemType), data: item },
        },
      ];
    }
    case "item/agentMessage/delta":
      return [{ type: "content.delta", ...turn, itemId: String(p.itemId ?? ""), payload: { streamKind: "assistant_text", delta: String(p.delta ?? "") } }];
    case "item/reasoning/textDelta":
      return [{ type: "content.delta", ...turn, itemId: String(p.itemId ?? ""), payload: { streamKind: "reasoning_text", delta: String(p.delta ?? "") } }];
    case "item/reasoning/summaryTextDelta":
      return [{ type: "content.delta", ...turn, itemId: String(p.itemId ?? ""), payload: { streamKind: "reasoning_summary_text", delta: String(p.delta ?? "") } }];
    case "item/commandExecution/outputDelta":
      return [{ type: "content.delta", ...turn, itemId: String(p.itemId ?? ""), payload: { streamKind: "command_output", delta: String(p.delta ?? "") } }];
    case "item/plan/delta":
      return [{ type: "turn.proposed.delta", ...turn, itemId: String(p.itemId ?? ""), payload: { delta: String(p.delta ?? "") } }];
    case "turn/plan/updated":
      return [
        {
          type: "turn.plan.updated",
          ...turn,
          payload: {
            plan: (Array.isArray(p.plan) ? p.plan : []).map((step: unknown) => ({
              step: String(obj(step).step ?? ""),
              status: obj(step).status === "completed" ? "completed" : obj(step).status === "inProgress" || obj(step).status === "in_progress" ? "inProgress" : "pending",
            })),
          },
        },
      ];
    case "thread/tokenUsage/updated": {
      const usage = obj(p.tokenUsage);
      const total = obj(usage.total);
      const last = obj(usage.last);
      return [
        {
          type: "thread.token-usage.updated",
          ...turn,
          payload: {
            usage: {
              usedTokens: Number(last.totalTokens ?? total.totalTokens ?? 0),
              ...(typeof usage.modelContextWindow === "number" ? { maxTokens: usage.modelContextWindow } : {}),
              ...(typeof total.inputTokens === "number" ? { inputTokens: total.inputTokens } : {}),
              ...(typeof total.outputTokens === "number" ? { outputTokens: total.outputTokens } : {}),
              ...(typeof total.cachedInputTokens === "number" ? { cachedInputTokens: total.cachedInputTokens } : {}),
              ...(typeof total.reasoningOutputTokens === "number" ? { reasoningTokens: total.reasoningOutputTokens } : {}),
            },
          },
        },
      ];
    }
    case "account/rateLimits/updated":
      return [{ type: "account.rate-limits.updated", ...turn, payload: codexRateLimitStatus(p.rateLimits) }];
    case "error": {
      const error = obj(p.error);
      const message = String(error.message ?? "Codex reported an error.");
      return [{ type: p.willRetry === true ? "runtime.warning" : "runtime.error", ...turn, payload: { message } }];
    }
    default:
      if (method.startsWith("collabAgent/")) {
        const agent = String(p.agentId ?? p.threadId ?? p.id ?? "");
        const done = /completed|finished|closed/i.test(method);
        return [{ type: done ? "task.completed" : method.endsWith("started") || method.endsWith("spawned") ? "task.started" : "task.progress", ...turn, payload: { taskId: agent, agentId: agent, ...(typeof p.status === "string" ? { status: p.status } : {}) } }];
      }
      return [];
  }
};

export type CodexRequest =
  | { readonly kind: "approval"; readonly requestType: RequestType; readonly detail: string; readonly args: Readonly<Record<string, unknown>> }
  | { readonly kind: "question"; readonly questions: ReadonlyArray<UserQuestion> }
  | { readonly kind: "elicitation"; readonly server: string }
  | { readonly kind: "unknown" };

/** What a server request asks. */
export const readCodexRequest = (method: string, params: unknown): CodexRequest => {
  const p = obj(params);
  switch (method) {
    case "item/commandExecution/requestApproval": {
      const command = typeof p.command === "string" ? p.command : Array.isArray(p.command) ? p.command.join(" ") : "";
      return { kind: "approval", requestType: "command_execution_approval", detail: command || String(p.reason ?? "a command"), args: { toolName: "command", input: p } };
    }
    case "item/fileChange/requestApproval":
      return { kind: "approval", requestType: "file_change_approval", detail: String(p.grantRoot ?? p.reason ?? "a file change"), args: { toolName: "file change", input: p } };
    case "item/tool/requestUserInput":
      return {
        kind: "question",
        questions: (Array.isArray(p.questions) ? p.questions : []).map((raw: unknown) => {
          const question = obj(raw);
          return {
            id: String(question.id ?? question.question ?? ""),
            header: String(question.header ?? ""),
            question: String(question.question ?? ""),
            options: (Array.isArray(question.options) ? question.options : []).map((option: unknown) => ({ label: String(obj(option).label ?? ""), description: String(obj(option).description ?? "") })),
            ...(question.isOther === true ? { allowCustomAnswer: true } : {}),
            multiSelect: false,
          };
        }),
      };
    case "mcpServer/elicitation/request":
      return { kind: "elicitation", server: String(p.serverName ?? p.server ?? "") };
    default:
      return { kind: "unknown" };
  }
};

/** The answer to an approval: Codex takes the person's decision as it is. */
export const codexApprovalAnswer = (decision: ApprovalDecision) => ({ decision });

/** The answer to a question: each question's chosen labels or typed text. */
export const codexUserInputAnswer = (answers: Readonly<Record<string, unknown>>) => ({
  answers: Object.fromEntries(
    Object.entries(answers).map(([id, value]) => [id, { answers: Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [String(value)] }]),
  ),
});
