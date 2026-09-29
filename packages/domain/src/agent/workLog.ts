/**
 * The work log (spec 08, after t3code's `deriveWorkLogEntries`): a turn's tool calls, merged
 * by tool call id into rows with a label, a tone and a lifecycle state, consecutive rows
 * folded into a group whose summary counts what was done, sub-agents folded into one row
 * per spawn, and errors standing alone. Also the activity line's words for what the agent
 * is doing now.
 */
import type { ChatActivity } from "./chatModel.ts";

export type WorkTone = "thinking" | "tool" | "info" | "error";
export type WorkState = "inProgress" | "completed" | "failed" | "declined" | "stopped";
/** What a row counts as in its group's summary. */
export type WorkAction = "read" | "change" | "command" | "web" | "code" | "tool" | "canvas" | "browser";

export interface WorkRow {
  readonly kind: "row";
  readonly id: string;
  readonly turnId: string | null;
  readonly label: string;
  readonly tone: WorkTone;
  readonly state: WorkState;
  readonly action: WorkAction;
  readonly command?: string;
  readonly detail?: string;
  readonly changedFiles?: ReadonlyArray<string>;
  readonly image?: string;
}

export interface SubagentTask {
  readonly taskId: string;
  readonly title: string;
  readonly state: "working" | "completed" | "failed";
  readonly durationMs?: number;
}

export interface SubagentRow {
  readonly kind: "subagents";
  readonly id: string;
  readonly turnId: string | null;
  readonly label: string;
  readonly status: string;
  readonly tasks: ReadonlyArray<SubagentTask>;
}

export interface WorkGroup {
  readonly kind: "group";
  readonly id: string;
  readonly turnId: string | null;
  readonly summary: string;
  readonly rows: ReadonlyArray<WorkRow>;
}

export type WorkEntry = WorkGroup | WorkRow | SubagentRow;

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value : undefined);

const UNFRAMED = "mcp__unframed__";

/** Unframed's own tool, by its short name, else undefined. */
const unframedTool = (name: string): string | undefined => (name.startsWith(UNFRAMED) ? name.slice(UNFRAMED.length) : undefined);

const program = (command: string): string => {
  const first = command.trim().split(/\s+/)[0] ?? "";
  return first.split(/[\\/]/).pop() ?? first;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const artifactTitle = (input: Record<string, unknown>, result: Record<string, unknown>, kind: string): string =>
  text(input.title) ?? text(result.title) ?? text(input.shapeId) ?? text(result.shapeId) ?? kind;

const pathsOf = (input: Record<string, unknown>, data: Record<string, unknown>): string[] => {
  const paths: string[] = [];
  for (const value of [input.file_path, input.path, input.notebook_path]) if (typeof value === "string" && value !== "") paths.push(value);
  for (const change of Array.isArray(data.changes) ? data.changes : []) {
    const path = record(change).path;
    if (typeof path === "string" && path !== "" && !paths.includes(path)) paths.push(path);
  }
  return paths;
};

interface Described {
  readonly label: string;
  readonly action: WorkAction;
  readonly command?: string;
  readonly detail?: string;
  readonly changedFiles?: ReadonlyArray<string>;
  readonly image?: string;
}

/** A tool call's label and what it counts as, for the state it is in. */
export const describeTool = (input: { readonly toolName: string; readonly itemType: string; readonly toolInput: Record<string, unknown>; readonly data: Record<string, unknown>; readonly result: Record<string, unknown>; readonly state: WorkState }): Described => {
  const { toolName, itemType, toolInput, data, result, state } = input;
  const own = unframedTool(toolName);
  if (own !== undefined) {
    switch (own) {
      case "canvas_read":
        return { label: "Read the canvas", action: "tool" };
      case "canvas_write": {
        const ops = Array.isArray(toolInput.ops) ? toolInput.ops.length : 0;
        return { label: `Changed the canvas (${plural(ops, "change")})`, action: "canvas" };
      }
      case "page_write":
        return { label: `Wrote page ${artifactTitle(toolInput, result, "page")}`, action: "canvas" };
      case "page_read":
        return { label: `Read page ${artifactTitle(toolInput, result, "page")}`, action: "read" };
      case "motion_write":
        return { label: `Wrote motion ${artifactTitle(toolInput, result, "motion")}`, action: "canvas" };
      case "motion_read":
        return { label: `Read motion ${artifactTitle(toolInput, result, "motion")}`, action: "read" };
      default:
        if (own.startsWith("preview")) return { label: `Looked at ${artifactTitle(toolInput, result, "the page")} in a browser`, action: "browser" };
        return { label: own, action: "tool" };
    }
  }
  const name = toolName.toLowerCase();
  const command = text(toolInput.command) ?? text(toolInput.cmd) ?? text(data.command);
  if (itemType === "command_execution" || command !== undefined) {
    const shown = command ?? toolName;
    const verb = state === "inProgress" ? "Running" : state === "failed" ? "Failed" : state === "declined" ? "Declined" : state === "stopped" ? "Stopped" : "Ran";
    return { label: `${verb} ${program(shown)}`, action: "command", command: shown };
  }
  if (itemType === "file_change") {
    const paths = pathsOf(toolInput, data);
    const label = paths.length === 0 ? toolName : paths.length === 1 ? paths[0]! : `${paths[0]} +${paths.length - 1} more`;
    return { label, action: "change", ...(paths.length > 0 ? { changedFiles: paths } : {}) };
  }
  if (itemType === "image_view") {
    const path = pathsOf(toolInput, data)[0];
    return { label: path === undefined ? "Viewed an image" : `Viewed ${path}`, action: "read", ...(path === undefined ? {} : { image: path }) };
  }
  if (itemType === "web_search" || name.includes("websearch")) {
    const query = text(toolInput.query);
    return { label: "Searched the web", action: "web", ...(query === undefined ? {} : { detail: query }) };
  }
  if (name.includes("webfetch") || name.includes("fetch")) {
    const url = text(toolInput.url);
    return { label: url === undefined ? "Fetched a page" : `Fetched ${url}`, action: "web" };
  }
  if (name === "grep" || name === "glob" || name === "ls" || name.includes("search")) {
    const pattern = text(toolInput.pattern) ?? text(toolInput.path);
    return { label: "Searched code", action: "code", ...(pattern === undefined ? {} : { detail: pattern }) };
  }
  if (name === "read" || name.includes("read")) {
    const path = pathsOf(toolInput, data)[0];
    return { label: path === undefined ? "Read a file" : `Read ${path}`, action: "read" };
  }
  return { label: toolName, action: "tool" };
};

const SUMMARY: Record<WorkAction, (n: number) => string> = {
  read: (n) => `Read ${plural(n, "file")}`,
  change: (n) => `Changed ${plural(n, "file")}`,
  command: (n) => `Ran ${plural(n, "command")}`,
  web: (n) => `Searched the web ${plural(n, "time")}`,
  code: (n) => `Searched code ${plural(n, "time")}`,
  tool: (n) => `Used ${plural(n, "tool")}`,
  canvas: (n) => `Changed the canvas ${plural(n, "time")}`,
  browser: (n) => `Used the browser ${plural(n, "time")}`,
};

/** A group's summary: what its rows did, counted, as one sentence ("Read 2 files, ran 3 commands, and changed 1 file"). */
export const workSummary = (rows: ReadonlyArray<Pick<WorkRow, "action">>): string => {
  const counts = new Map<WorkAction, number>();
  for (const row of rows) counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
  const parts = [...counts].map(([action, n], index) => {
    const part = SUMMARY[action](n);
    return index === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1);
  });
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
};

/** A duration as 1.2s, 12s, 1m 5s. */
export const formatWorkDuration = (ms: number): string => {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return `${(Math.round(seconds * 10) / 10).toFixed(1).replace(/\.0$/, "")}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
};

const TOOL_KINDS = new Set(["tool.started", "tool.updated", "tool.completed"]);
const TASK_KINDS = new Set(["task.started", "task.progress", "task.completed"]);

const stateOf = (status: unknown, kind: string): WorkState => {
  if (status === "failed") return "failed";
  if (status === "declined") return "declined";
  if (status === "completed" || kind === "tool.completed") return "completed";
  return "inProgress";
};

/**
 * The work log of a stretch of activities, in order. With `settled`, a call still in
 * progress is shown as stopped: its turn is over.
 */
export const workLog = (activities: ReadonlyArray<ChatActivity>, options: { readonly settled?: boolean } = {}): WorkEntry[] => {
  const ordered = [...activities].sort((a, b) => a.sequence - b.sequence);
  const turnsWithTasks = new Set(ordered.filter((activity) => TASK_KINDS.has(activity.kind)).map((activity) => activity.turnId));

  type Pending = { kind: "tool"; id: string; turnId: string | null; toolName: string; itemType: string; input: Record<string, unknown>; data: Record<string, unknown>; result: Record<string, unknown>; status: unknown; last: string; detail?: string } | { kind: "row"; row: WorkRow } | { kind: "spawn"; key: string };
  const items: Pending[] = [];
  const tools = new Map<string, Extract<Pending, { kind: "tool" }>>();
  const spawns = new Map<string, { turnId: string | null; id: string; tasks: Map<string, { title: string; started: number; ended?: number; failed: boolean; done: boolean }> }>();

  for (const activity of ordered) {
    const payload = record(activity.payload);
    if (TOOL_KINDS.has(activity.kind)) {
      const itemType = String(payload.itemType ?? "");
      if (itemType === "collab_agent_tool_call" && turnsWithTasks.has(activity.turnId)) continue;
      const data = record(payload.data);
      const toolName = String(data.toolName ?? payload.title ?? itemType);
      const key = `${activity.turnId ?? ""}\u0000${String(payload.itemId ?? activity.id)}`;
      let tool = tools.get(key);
      if (!tool) {
        tool = { kind: "tool", id: String(payload.itemId ?? activity.id), turnId: activity.turnId, toolName, itemType, input: {}, data: {}, result: {}, status: undefined, last: activity.kind };
        tools.set(key, tool);
        items.push(tool);
      }
      if (Object.keys(record(data.input)).length > 0) tool.input = record(data.input);
      tool.data = { ...tool.data, ...data };
      if (data.result !== undefined) tool.result = record(data.result);
      tool.status = payload.status ?? tool.status;
      tool.last = activity.kind;
      if (typeof payload.detail === "string" && payload.detail !== "") tool.detail = payload.detail;
      continue;
    }
    if (TASK_KINDS.has(activity.kind)) {
      const spawnKey = `spawn\u0000${activity.turnId ?? ""}`;
      let spawn = spawns.get(spawnKey);
      if (!spawn) {
        spawn = { turnId: activity.turnId, id: activity.id, tasks: new Map() };
        spawns.set(spawnKey, spawn);
        items.push({ kind: "spawn", key: spawnKey });
      }
      const taskId = String(payload.taskId ?? activity.id);
      const at = Date.parse(activity.createdAt);
      const task = spawn.tasks.get(taskId) ?? { title: String(payload.title ?? payload.description ?? "Sub-agent"), started: at, failed: false, done: false };
      if (activity.kind === "task.completed") {
        task.done = true;
        task.failed = payload.status === "failed";
        task.ended = at;
      }
      spawn.tasks.set(taskId, task);
      continue;
    }
    if (activity.tone === "error" && activity.kind !== "rate-limit") {
      const message = text(payload.message) ?? text(payload.errorMessage);
      items.push({
        kind: "row",
        row: { kind: "row", id: activity.id, turnId: activity.turnId, label: activity.summary, tone: "error", state: "failed", action: "tool", ...(message === undefined ? {} : { detail: message }) },
      });
    }
  }

  const entries: WorkEntry[] = [];
  let run: WorkRow[] = [];
  const flush = () => {
    if (run.length === 1) entries.push(run[0]!);
    else if (run.length > 1) entries.push({ kind: "group", id: `group:${run[0]!.id}`, turnId: run[0]!.turnId, summary: workSummary(run), rows: run });
    run = [];
  };
  for (const item of items) {
    if (item.kind === "tool") {
      let state = stateOf(item.status, item.last);
      if (state === "inProgress" && options.settled) state = "stopped";
      const described = describeTool({ toolName: item.toolName, itemType: item.itemType, toolInput: item.input, data: item.data, result: item.result, state });
      const detail = described.detail ?? (state === "declined" || state === "failed" ? item.detail : undefined);
      if (run.length > 0 && run[0]!.turnId !== item.turnId) flush();
      run.push({ kind: "row", id: item.id, turnId: item.turnId, tone: "tool", state, ...described, ...(detail === undefined ? {} : { detail }) });
      continue;
    }
    flush();
    if (item.kind === "row") {
      entries.push(item.row);
      continue;
    }
    const spawn = spawns.get(item.key)!;
    const tasks: SubagentTask[] = [...spawn.tasks].map(([taskId, task]) => ({
      taskId,
      title: task.title,
      state: task.done ? (task.failed ? "failed" : "completed") : "working",
      ...(task.ended === undefined ? {} : { durationMs: task.ended - task.started }),
    }));
    const working = tasks.filter((task) => task.state === "working").length;
    const failed = tasks.filter((task) => task.state === "failed").length;
    entries.push({
      kind: "subagents",
      id: spawn.id,
      turnId: spawn.turnId,
      label: `Kicked off ${plural(tasks.length, "subagent")}`,
      status: working > 0 ? `${working} working` : failed > 0 ? `${failed} failed` : "✓ completed",
      tasks,
    });
  }
  flush();
  return entries;
};

// ---------------------------------------------------------------------------------------
// The activity line.

const ACTIVITY_BY_TOOL: ReadonlyArray<readonly [RegExp, string]> = [
  [/^mcp__unframed__canvas_read$/, "Reading the canvas…"],
  [/^mcp__unframed__canvas_write$/, "Changing the canvas…"],
  [/^mcp__unframed__page_write$/, "Writing the page…"],
  [/^mcp__unframed__page_read$/, "Reading the page…"],
  [/^mcp__unframed__motion_write$/, "Writing the motion…"],
  [/^mcp__unframed__motion_read$/, "Reading the motion…"],
  [/^read$/i, "Reading a file…"],
  [/^write$/i, "Writing a file…"],
  [/^(edit|multiedit|notebookedit)$/i, "Editing a file…"],
  [/(bash|shell|command|terminal)/i, "Running a command…"],
  [/^(glob|ls)$/i, "Looking for files…"],
  [/^grep$/i, "Searching…"],
  [/webfetch/i, "Fetching a page…"],
  [/websearch/i, "Searching the web…"],
  [/^(task|agent)$/i, "Working on a sub-task…"],
  [/(exitplanmode|todowrite|plan)/i, "Planning…"],
  [/toolsearch/i, "Looking for a tool…"],
];

/**
 * What the activity line says while a turn runs: the label for the latest tool call of the
 * turn (kept after it returns, since the gap after a tool is where the model thinks), else
 * "Thinking…".
 */
export const activityLabel = (activities: ReadonlyArray<ChatActivity>, turnId: string | null): string => {
  let latest: ChatActivity | undefined;
  for (const activity of activities) {
    if (activity.turnId !== turnId || !TOOL_KINDS.has(activity.kind)) continue;
    if (!latest || activity.sequence > latest.sequence) latest = activity;
  }
  if (!latest) return "Thinking…";
  const payload = record(latest.payload);
  const toolName = String(record(payload.data).toolName ?? payload.title ?? "");
  if (payload.itemType === "command_execution") return "Running a command…";
  return ACTIVITY_BY_TOOL.find(([pattern]) => pattern.test(toolName))?.[1] ?? "Working…";
};
