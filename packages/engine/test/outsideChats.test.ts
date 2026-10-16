import { describe, expect, it } from "vitest";
import { PROJECT, startAgentEngine, UNFRAMED_TOOLS } from "./agent.ts";
import { chatsIn, outsideLink as outside } from "./outsideCalls.ts";

describe("outside chats and turns", () => {
  it("lists projects_list first, then every Unframed tool, each with a required project", async () => {
    const agent = await startAgentEngine();
    const link = await outside(agent);
    const session = await link.open();
    const tools = await link.list(session);
    expect(tools.map((tool) => tool.name)).toEqual(["projects_list", ...UNFRAMED_TOOLS, "canvas_select"]);
    for (const tool of tools.slice(1)) expect(tool.inputSchema.required).toContain("project");
  });

  it("makes one outside chat for a session's first call into a project, titled with the connection and the time, and reuses it", async () => {
    const agent = await startAgentEngine();
    const link = await outside(agent);
    const session = await link.open();

    const first = await link.call(session, "canvas_read", { project: PROJECT });
    expect(first.isError).toBe(false);
    expect(first.value.shapes).toEqual(expect.any(Array));
    expect(first.value.selection).toEqual([]);

    const chats = await chatsIn(agent);
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ provider: "outside", titledBy: "user", outside: { client: "claude-code" } });
    expect(chats[0]!.title).toMatch(/^Work laptop Claude Code · \d{1,2}:\d{2} (am|pm)$/);

    await link.call(session, "canvas_read", { project: PROJECT });
    const again = await chatsIn(agent);
    expect(again.map((chat) => chat.id)).toEqual([chats[0]!.id]);
  });

  it("records a read as a tool activity in the chat's work log, under the open turn", async () => {
    const agent = await startAgentEngine();
    const link = await outside(agent);
    const session = await link.open();
    await link.call(session, "canvas_read", { project: PROJECT });
    const [chat] = await chatsIn(agent);
    const watched = await agent.watch(chat!.id);
    const thread = await watched.until((current) => current.activities.some((row) => row.kind === "tool.completed"), "the read's activity");
    await watched.close();
    const row = thread.activities.find((activity) => activity.kind === "tool.completed")!;
    expect(row).toMatchObject({ tone: "tool", summary: "mcp__unframed__canvas_read", turnId: thread.latestTurn?.turnId });
    expect(row.payload).toMatchObject({ itemType: "mcp_tool_call", data: { toolName: "mcp__unframed__canvas_read" } });
  });

  it("gives a second session its own chat in the same project, and a second project its own chat for the same session", async () => {
    const agent = await startAgentEngine();
    await (await agent.engine.rpc()).call("projects.create", { name: "Second board" });
    const link = await outside(agent);
    const one = await link.open();
    const two = await link.open();

    await link.call(one, "canvas_read", { project: PROJECT });
    await link.call(two, "canvas_read", { project: PROJECT });
    await link.call(one, "canvas_read", { project: "Second board" });

    expect(await chatsIn(agent, PROJECT)).toHaveLength(2);
    expect(await chatsIn(agent, "second-board")).toHaveLength(1);
  });

  it("answers the refusal for a project that does not exist and makes no chat", async () => {
    const agent = await startAgentEngine();
    const link = await outside(agent);
    const session = await link.open();
    const refused = await link.call(session, "canvas_read", { project: "Nowhere" });
    expect(refused.isError).toBe(true);
    expect(refused.value).toEqual({ error: 'no project named "Nowhere"; call projects_list for the names' });
    expect(await chatsIn(agent)).toHaveLength(0);
  });

  it("writes from outside as one change, and settles the turn after the idle time with its files and no agent sidecar", async () => {
    const agent = await startAgentEngine({ env: { UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS: "300" } });
    const link = await outside(agent);
    const session = await link.open();

    const written = await link.call(session, "canvas_write", {
      project: PROJECT,
      ops: [{ type: "create", id: "new:note", kind: "prompt", x: 0, y: 0, props: { text: "from outside" } }],
    });
    expect(written.isError).toBe(false);
    expect(written.value.ok).toBe(true);
    const canvas = await agent.rpc.call("testCanvas.read", { project: PROJECT });
    expect(JSON.stringify(canvas)).toContain("from outside");

    const [chat] = await chatsIn(agent);
    const settled = await agent.settled(chat!.id, 1);
    expect(settled.latestTurn).toMatchObject({ turnCount: 1, state: "completed" });
    expect(settled.turns[0]!.files!.map((file) => file.kind)).toEqual(["prompt"]);
    expect(await agent.sidecars()).toEqual([]);

    await link.call(session, "canvas_read", { project: PROJECT });
    const watched = await agent.watch(chat!.id);
    const second = await watched.until((current) => current.latestTurn?.turnCount === 2, "turn 2 to open");
    await watched.close();
    expect(second.latestTurn).toMatchObject({ turnCount: 2, state: "running" });
  });

  it("replaces a deleted outside chat on the session's next call", async () => {
    const agent = await startAgentEngine({ env: { UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS: "300" } });
    const link = await outside(agent);
    const session = await link.open();
    await link.call(session, "canvas_read", { project: PROJECT });
    const [old] = await chatsIn(agent);
    await agent.settled(old!.id, 1);
    await agent.dispatch({ type: "thread.delete", threadId: old!.id });

    await link.call(session, "canvas_read", { project: PROJECT });
    const current = await chatsIn(agent);
    expect(current).toHaveLength(1);
    expect(current[0]!.id).not.toBe(old!.id);
  });
});


