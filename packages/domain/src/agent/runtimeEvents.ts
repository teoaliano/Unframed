/**
 * The canonical runtime events (spec 07, t3code's names and fields, the subset Unframed
 * consumes). Every provider adapter translates its native protocol into these, so the chat
 * store never knows which provider runs a chat.
 */

export type RuntimeProvider = "claude" | "codex" | "scripted";

export type RuntimeEventType =
  | "session.started"
  | "session.configured"
  | "session.state.changed"
  | "session.exited"
  | "thread.started"
  | "thread.token-usage.updated"
  | "turn.started"
  | "turn.completed"
  | "turn.aborted"
  | "turn.plan.updated"
  | "turn.proposed.delta"
  | "turn.proposed.completed"
  | "item.started"
  | "item.updated"
  | "item.completed"
  | "content.delta"
  | "request.opened"
  | "request.resolved"
  | "user-input.requested"
  | "user-input.resolved"
  | "task.started"
  | "task.progress"
  | "task.completed"
  | "account.rate-limits.updated"
  | "runtime.retry"
  | "runtime.warning"
  | "runtime.error";

export type ItemType =
  | "command_execution"
  | "file_change"
  | "mcp_tool_call"
  | "dynamic_tool_call"
  | "collab_agent_tool_call"
  | "web_search"
  | "image_view"
  | "assistant_message"
  | "reasoning"
  | "plan"
  | "context_compaction"
  | "error";

export type RequestType =
  | "command_execution_approval"
  | "file_read_approval"
  | "file_change_approval"
  | "mcp_elicitation_approval"
  | "permission_approval"
  | "dynamic_tool_call";

export type StreamKind = "assistant_text" | "reasoning_text" | "reasoning_summary_text" | "plan_text" | "command_output" | "file_change_output";

export type TurnOutcome = "completed" | "failed" | "interrupted" | "cancelled";

export interface RuntimeEvent {
  readonly type: RuntimeEventType;
  readonly eventId: string;
  readonly provider: RuntimeProvider;
  /** The chat. */
  readonly threadId: string;
  readonly createdAt: string;
  readonly turnId?: string;
  readonly itemId?: string;
  readonly requestId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** An event before its adapter stamps the id, provider, chat and time. */
export interface RuntimeEventDraft {
  readonly type: RuntimeEventType;
  readonly turnId?: string;
  readonly itemId?: string;
  readonly requestId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** A user-input question, as the person answers it. The SDK matches answers by question text, so `id` is the text. */
export interface UserQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>;
  readonly allowCustomAnswer?: boolean;
  readonly multiSelect: boolean;
}

/** The item type of a tool by its name (t3code's classification). */
export const classifyToolItem = (toolName: string, input: Readonly<Record<string, unknown>> = {}): ItemType => {
  const name = toolName.toLowerCase();
  if ((name === "read" || name === "read file") && typeof (input.file_path ?? input.path) === "string") {
    const path = String(input.file_path ?? input.path).toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/.test(path)) return "image_view";
  }
  if (name.startsWith("mcp__")) return "mcp_tool_call";
  // Claude's to-do list writes no file.
  if (name === "todowrite") return "dynamic_tool_call";
  if (name === "task" || name.includes("agent")) return "collab_agent_tool_call";
  if (name.includes("bash") || name.includes("command") || name.includes("shell") || name.includes("terminal")) return "command_execution";
  if (
    name.includes("edit") ||
    name.includes("write") ||
    name.includes("patch") ||
    name.includes("replace") ||
    name.includes("create") ||
    name.includes("delete") ||
    name.includes("file")
  ) {
    return "file_change";
  }
  if (name.includes("websearch") || name.includes("web search")) return "web_search";
  if (name.includes("image")) return "image_view";
  return "dynamic_tool_call";
};

const READ_ONLY = (name: string) =>
  name === "read" || name.includes("read file") || name.includes("view") || name.includes("grep") || name.includes("glob") || name.includes("search") || name === "ls";

/** The request type a tool's approval opens: read-only, shell-like, file-writing, else a dynamic tool call. */
export const classifyRequest = (toolName: string): RequestType => {
  const name = toolName.toLowerCase();
  if (READ_ONLY(name)) return "file_read_approval";
  const item = classifyToolItem(toolName);
  return item === "command_execution" ? "command_execution_approval" : item === "file_change" ? "file_change_approval" : "dynamic_tool_call";
};

/** The target a request is about, in full: the command, path, pattern or URL. */
export const requestTarget = (toolName: string, input: Readonly<Record<string, unknown>>): string => {
  for (const key of ["command", "cmd", "file_path", "path", "notebook_path", "pattern", "url", "query"]) {
    const value = input[key];
    if (typeof value === "string" && value !== "") return value;
  }
  try {
    return `${toolName} ${JSON.stringify(input)}`;
  } catch {
    return toolName;
  }
};
