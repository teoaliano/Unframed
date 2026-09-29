import { describe, expect, it } from "vitest";
import { activityLabel, formatWorkDuration, workLog, workSummary, type ChatActivity, type WorkGroup, type WorkRow } from "../../src/index.ts";

let sequence = 0;
const activity = (kind: string, payload: Record<string, unknown>, fields: Partial<ChatActivity> = {}): ChatActivity => ({
  id: `a${++sequence}`,
  tone: kind.startsWith("tool") ? "tool" : "info",
  kind,
  summary: String(payload.title ?? kind),
  payload,
  turnId: "t1",
  sequence,
  createdAt: new Date(Date.UTC(2026, 8, 29, 10, 0, sequence)).toISOString(),
  ...fields,
});

/** One call's started and completed activities, as the runtime ingests them. */
const call = (itemId: string, toolName: string, input: Record<string, unknown>, end: { status?: string; itemType?: string; result?: unknown } = {}) => {
  const itemType = end.itemType ?? (toolName.startsWith("mcp__") ? "mcp_tool_call" : toolName === "Bash" ? "command_execution" : toolName === "Edit" ? "file_change" : "dynamic_tool_call");
  return [
    activity("tool.started", { itemId, itemType, status: "inProgress", title: toolName, data: { toolName, input } }),
    ...(end.status === "running" ? [] : [activity("tool.completed", { itemId, itemType, status: end.status ?? "completed", title: toolName, data: { toolName, ...(end.result === undefined ? {} : { result: end.result }) } })]),
  ];
};

describe("the work log", () => {
  it("merges a call's lifecycle by its tool call id into one row with a state", () => {
    const [row] = workLog(call("i1", "Bash", { command: "rm -rf build" })) as WorkRow[];
    expect(row).toMatchObject({ kind: "row", id: "i1", label: "Ran rm", state: "completed", tone: "tool", command: "rm -rf build" });
  });

  it("labels a command by its program in every state", () => {
    const label = (end: Parameters<typeof call>[3], settled = false) => (workLog(call("i", "Bash", { command: "/usr/bin/git status" }, end), { settled })[0] as WorkRow).label;
    expect(label({ status: "running" })).toBe("Running git");
    expect(label({})).toBe("Ran git");
    expect(label({ status: "failed" })).toBe("Failed git");
    expect(label({ status: "declined" })).toBe("Declined git");
    expect((workLog(call("i", "Bash", { command: "ls" }, { status: "running" }), { settled: true })[0] as WorkRow).state).toBe("stopped");
  });

  it("labels an edit by its path, or its first path and how many more", () => {
    expect((workLog(call("i", "Edit", { file_path: "src/app.ts" }))[0] as WorkRow).label).toBe("src/app.ts");
    const codex = workLog([activity("tool.completed", { itemId: "c", itemType: "file_change", status: "completed", title: "file change", data: { changes: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }] } })]);
    expect(codex[0]).toMatchObject({ label: "a.ts +2 more", changedFiles: ["a.ts", "b.ts", "c.ts"] });
  });

  it("labels Unframed's own tools", () => {
    const labels = workLog([
      ...call("1", "mcp__unframed__canvas_read", {}),
      ...call("2", "mcp__unframed__canvas_write", { ops: [{ type: "move" }, { type: "update" }] }),
      ...call("3", "mcp__unframed__canvas_write", { ops: [{ type: "move" }] }),
      ...call("4", "mcp__unframed__page_write", { title: "Landing" }),
      ...call("5", "mcp__unframed__page_read", { shapeId: "p1" }, { result: { title: "Landing" } }),
      ...call("6", "mcp__unframed__motion_write", { title: "Intro" }),
      ...call("7", "mcp__unframed__motion_read", { shapeId: "m1" }, { result: { title: "Intro" } }),
      ...call("8", "mcp__unframed__preview_open", { title: "Landing" }),
    ]);
    expect((labels[0] as WorkGroup).rows.map((row) => row.label)).toEqual([
      "Read the canvas",
      "Changed the canvas (2 changes)",
      "Changed the canvas (1 change)",
      "Wrote page Landing",
      "Read page Landing",
      "Wrote motion Intro",
      "Read motion Intro",
      "Looked at Landing in a browser",
    ]);
    expect((labels[0] as WorkGroup).summary).toBe("Used 1 tool, changed the canvas 4 times, read 2 files, and used the browser 1 time");
  });

  it("folds consecutive calls into a group whose summary counts what they did", () => {
    const [group] = workLog([
      ...call("r1", "Read", { file_path: "a.md" }),
      ...call("c1", "Bash", { command: "ls" }),
      ...call("r2", "Read", { file_path: "b.md" }),
      ...call("c2", "Bash", { command: "pwd" }),
      ...call("c3", "Bash", { command: "date" }),
      ...call("e1", "Edit", { file_path: "c.md" }),
    ]) as WorkGroup[];
    expect(group!.kind).toBe("group");
    expect(group!.rows.map((row) => row.label)).toEqual(["Read a.md", "Ran ls", "Read b.md", "Ran pwd", "Ran date", "c.md"]);
    expect(group!.summary).toBe("Read 2 files, ran 3 commands, and changed 1 file");
  });

  it("writes the summaries in words", () => {
    expect(workSummary([{ action: "web" }, { action: "web" }])).toBe("Searched the web 2 times");
    expect(workSummary([{ action: "code" }, { action: "tool" }])).toBe("Searched code 1 time and used 1 tool");
    expect(workSummary([{ action: "browser" }, { action: "canvas" }, { action: "canvas" }])).toBe("Used the browser 1 time and changed the canvas 2 times");
  });

  it("keeps an error row on its own, never in a group", () => {
    const entries = workLog([
      ...call("c1", "Bash", { command: "ls" }),
      ...call("c2", "Bash", { command: "pwd" }),
      activity("runtime.error", { message: "The connection dropped." }, { tone: "error", summary: "Runtime error" }),
      ...call("c3", "Bash", { command: "date" }),
      ...call("c4", "Bash", { command: "whoami" }),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(["group", "row", "group"]);
    expect(entries[1]).toMatchObject({ tone: "error", label: "Runtime error", detail: "The connection dropped." });
  });

  it("folds sub-agents into one row per spawn, with their states and durations", () => {
    const task = (kind: string, taskId: string, title: string, status?: string) => activity(kind, { taskId, agentId: taskId, title, ...(status ? { status } : {}) });
    const entries = workLog([task("task.started", "a", "Read the brief"), task("task.started", "b", "Check the fonts"), task("task.completed", "a", "Read the brief", "completed")]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "subagents", label: "Kicked off 2 subagents", status: "1 working" });
    const done = workLog([task("task.started", "a", "A"), task("task.completed", "a", "A", "completed"), task("task.started", "b", "B"), task("task.completed", "b", "B", "failed")]);
    expect(done[0]).toMatchObject({ status: "1 failed", tasks: [{ taskId: "a", state: "completed", durationMs: 1000 }, { taskId: "b", state: "failed", durationMs: 1000 }] });
    expect(workLog([task("task.started", "a", "A"), task("task.completed", "a", "A", "completed")])[0]).toMatchObject({ status: "✓ completed", label: "Kicked off 1 subagent" });
  });

  it("formats durations as 1.2s, 12s and 1m 5s", () => {
    expect([formatWorkDuration(1_200), formatWorkDuration(12_000), formatWorkDuration(65_000), formatWorkDuration(4_000)]).toEqual(["1.2s", "12s", "1m 5s", "4s"]);
  });
});

describe("the activity line", () => {
  it("names the turn's latest tool, and keeps it after the tool returns", () => {
    expect(activityLabel(call("1", "mcp__unframed__canvas_read", {}, { status: "running" }), "t1")).toBe("Reading the canvas…");
    expect(activityLabel(call("2", "mcp__unframed__canvas_write", {}), "t1")).toBe("Changing the canvas…");
    expect(activityLabel(call("3", "Bash", { command: "ls" }), "t1")).toBe("Running a command…");
    expect(activityLabel(call("4", "Grep", { pattern: "x" }), "t1")).toBe("Searching…");
    expect(activityLabel(call("5", "WebSearch", { query: "x" }), "t1")).toBe("Searching the web…");
    expect(activityLabel(call("6", "Mystery", {}), "t1")).toBe("Working…");
  });

  it("says Thinking… before the turn's first tool", () => {
    expect(activityLabel([], "t1")).toBe("Thinking…");
    expect(activityLabel(call("7", "Read", {}), "t2")).toBe("Thinking…");
  });
});
