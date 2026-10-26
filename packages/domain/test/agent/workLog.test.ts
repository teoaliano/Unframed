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
      ...call("9", "mcp__unframed__page_edit", { shapeId: "p1" }, { result: { title: "Landing" } }),
      ...call("10", "mcp__unframed__motion_edit", { shapeId: "m1", title: "Outro" }),
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
      "Edited page Landing",
      "Edited motion Outro",
    ]);
    expect((labels[0] as WorkGroup).summary).toBe("Used 1 tool, changed the canvas 6 times, read 2 files, and used the browser 1 time");
  });

  it("says what a refused Unframed tool call tried, by the shape's title, and opens to the error the agent received", () => {
    const refused = (itemId: string, toolName: string, input: Record<string, unknown>) => call(itemId, toolName, input, { status: "failed", result: { error: `${toolName} was refused` } });
    const titles: Record<string, string> = { pg1: "Landing", mo1: "Intro", st1: "Linear" };
    const entries = workLog(
      [
        ...refused("1", "mcp__unframed__page_edit", { shapeId: "pg1", edits: [] }),
        ...refused("2", "mcp__unframed__page_write", { shapeId: "pg1", html: "<p>" }),
        ...refused("3", "mcp__unframed__page_read", { shapeId: "pg1" }),
        ...refused("4", "mcp__unframed__motion_write", { title: "Outro" }),
        ...refused("5", "mcp__unframed__motion_edit", { shapeId: "mo1", edits: [] }),
        ...refused("6", "mcp__unframed__motion_read", { shapeId: "gone" }),
        ...refused("7", "mcp__unframed__style_read", { shapeId: "st1" }),
        ...refused("8", "mcp__unframed__style_write", { shapeId: "st1", markdown: "" }),
        ...refused("9", "mcp__unframed__style_edit", { shapeId: "st1", edits: [] }),
        ...refused("10", "mcp__unframed__canvas_read", {}),
        ...refused("11", "mcp__unframed__canvas_write", { ops: [{ type: "move" }] }),
        ...refused("12", "mcp__unframed__canvas_select", { shapeIds: ["a", "b"] }),
        ...refused("13", "mcp__unframed__generate", { medium: "video" }),
        ...refused("14", "mcp__unframed__preview_open", { shapeId: "pg1" }),
      ],
      { titleOf: (id) => titles[id] },
    );
    const rows = (entries[0] as WorkGroup).rows;
    expect(rows.map((row) => row.label)).toEqual([
      "Couldn't edit page Landing",
      "Couldn't write page Landing",
      "Couldn't read page Landing",
      "Couldn't write motion Outro",
      "Couldn't edit motion Intro",
      "Couldn't read motion gone",
      "Couldn't read style Linear",
      "Couldn't write style Linear",
      "Couldn't edit style Linear",
      "Couldn't read the canvas",
      "Couldn't change the canvas",
      "Couldn't select 2 shapes",
      "Couldn't start a video generation",
      "Couldn't look at Landing in a browser",
    ]);
    expect(rows.every((row) => row.state === "failed")).toBe(true);
    expect(rows[0]!.detail).toBe("mcp__unframed__page_edit was refused");
    expect(rows[13]!.detail).toBe("mcp__unframed__preview_open was refused");
  });

  it("names a shape by its title when the call succeeded too, and reads a result the provider sent as text", () => {
    const [row] = workLog(call("1", "mcp__unframed__page_edit", { shapeId: "pg1" }), { titleOf: (id) => (id === "pg1" ? "Landing" : undefined) }) as WorkRow[];
    expect(row!.label).toBe("Edited page Landing");
    // Claude hands an MCP result over as its text parts: notes first, then the JSON.
    const [claude] = workLog(call("2", "mcp__unframed__page_edit", { shapeId: "pg9" }, { result: ["Note: the canvas changed.", '{"shapeId":"pg9","title":"Pricing"}'] })) as WorkRow[];
    expect(claude!.label).toBe("Edited page Pricing");
    const [refused] = workLog(call("3", "mcp__unframed__page_edit", { shapeId: "pg9" }, { status: "failed", result: ['{"error":"That text is not on the page."}'] })) as WorkRow[];
    expect(refused).toMatchObject({ label: "Couldn't edit page pg9", detail: "That text is not on the page." });
  });

  it("logs an outside chat's refused call, which ends as tool.failed", () => {
    const entries = workLog([
      activity("tool.started", { itemId: "o1", itemType: "mcp_tool_call", status: "inProgress", title: "mcp__unframed__page_edit", data: { toolName: "mcp__unframed__page_edit", input: { shapeId: "pg1" } } }),
      activity("tool.failed", { itemId: "o1", itemType: "mcp_tool_call", status: "failed", title: "mcp__unframed__page_edit", data: { toolName: "mcp__unframed__page_edit", input: { shapeId: "pg1" }, result: { error: "No such page." } } }),
    ], { settled: true });
    expect(entries[0]).toMatchObject({ state: "failed", detail: "No such page." });
  });

  it("opens any failed call to the error text it returned", () => {
    const [row] = workLog(call("1", "WebFetch", { url: "https://example.com" }, { status: "failed", result: "Request failed with status 404" })) as WorkRow[];
    expect(row).toMatchObject({ state: "failed", detail: "Request failed with status 404" });
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
    expect(activityLabel(call("7", "mcp__unframed__page_edit", {}), "t1")).toBe("Editing the page…");
    expect(activityLabel(call("8", "mcp__unframed__motion_edit", {}), "t1")).toBe("Editing the motion…");
  });

  it("says Thinking… before the turn's first tool", () => {
    expect(activityLabel([], "t1")).toBe("Thinking…");
    expect(activityLabel(call("7", "Read", {}), "t2")).toBe("Thinking…");
  });
});
