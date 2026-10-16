import { describe, expect, it } from "vitest";
import { PROJECT, startAgentEngine } from "./agent.ts";
import { makeTempDir } from "./harness.ts";
import { chatsIn, outsideLink as outside } from "./outsideCalls.ts";

const prompt = (id: string, text: string) => ({ type: "create", id, kind: "prompt", x: 0, y: 0, props: { text } });

/** Reads the canvas until it holds `count` shapes, for a change a reactor applies after its command answers. */
const waitForCount = async (agent: Awaited<ReturnType<typeof startAgentEngine>>, count: number) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await shapeIds(agent)).length === count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect((await shapeIds(agent)).length).toBe(count);
};

/** The canvas's shape ids right now, from the test-only read. */
const shapeIds = async (agent: Awaited<ReturnType<typeof startAgentEngine>>) => {
  const canvas = (await agent.rpc.call("testCanvas.read", { project: PROJECT })) as unknown as { records: Array<{ id: string; typeName: string }> };
  return canvas.records.filter((record) => record.typeName === "shape").map((record) => record.id);
};

const SHORT = { UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS: "300" };

describe("outside turns: revert, change notes, session end, revoke, restart and rename", () => {
  it("reverts a settled outside turn, taking its writes back off the canvas", async () => {
    const agent = await startAgentEngine({ env: SHORT });
    const link = await outside(agent);
    const session = await link.open();
    const written = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:a", "from outside")] });
    const [chat] = await chatsIn(agent);
    const created = (await shapeIds(agent)).length;
    await agent.settled(chat!.id, 1);

    await agent.dispatch({ type: "thread.turn.revert", threadId: chat!.id, turnCount: 1 });
    // The revert is applied by a reactor after the command answers, so the canvas is read until it lands.
    await waitForCount(agent, created - 1);
    expect(written.isError).toBe(false);
  });

  it("settles an open outside turn first, then reverts it", async () => {
    const agent = await startAgentEngine();
    const link = await outside(agent);
    const session = await link.open();
    await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:open", "still open")] });
    const [chat] = await chatsIn(agent);
    const before = (await shapeIds(agent)).length;

    await agent.dispatch({ type: "thread.turn.revert", threadId: chat!.id, turnCount: 1 });
    const after = await agent.settled(chat!.id, 1);
    expect(after.latestTurn).toMatchObject({ turnCount: 1, state: "completed" });
    expect(after.turns[0]!.reverted).toBeDefined();
    await waitForCount(agent, before - 1);
  });

  it("starts each outside call's result with the change note when someone else changed the canvas", async () => {
    const agent = await startAgentEngine();
    const link = await outside(agent);
    const session = await link.open();
    await link.call(session, "canvas_read", { project: PROJECT });
    const quiet = await link.call(session, "canvas_read", { project: PROJECT });
    expect(quiet.content).toHaveLength(1);

    // Another outside chat (another connection's session) changes the canvas: the first chat's next result says so.
    const other = await outside(agent, "Second laptop");
    const otherSession = await other.open();
    await other.call(otherSession, "canvas_write", { project: PROJECT, ops: [prompt("new:elsewhere", "from another chat")] });
    const changed = await link.call(session, "canvas_read", { project: PROJECT });
    expect(changed.content).toHaveLength(2);
    expect(changed.content[0]).not.toMatch(/^\{/);
    expect(JSON.parse(changed.content[1]!).shapes).toEqual(expect.any(Array));
  });

  it("ends a session's open turns and tells its chats, leaving another session's turn open", async () => {
    const agent = await startAgentEngine();
    const link = await outside(agent);
    const one = await link.open();
    const two = await link.open();
    await link.call(one, "canvas_read", { project: PROJECT });
    await link.call(two, "canvas_read", { project: PROJECT });
    const chats = await chatsIn(agent);
    const oneChat = chats.find((chat) => chat.outside?.sessionId === one)!;
    const twoChat = chats.find((chat) => chat.outside?.sessionId === two)!;

    expect(await link.end(one)).toBe(200);
    const ended = await agent.settled(oneChat.id, 1);
    expect(ended.latestTurn?.state).toBe("completed");
    expect(ended.activities.some((activity) => activity.kind === "outside.session-ended")).toBe(true);
    const stillOpen = await agent.watch(twoChat.id);
    const open = await stillOpen.until((chat) => chat.latestTurn?.state === "running", "the other turn to stay open");
    await stillOpen.close();
    expect(open.latestTurn?.state).toBe("running");
  });

  it("refuses a revoked connection and settles its chats' open turns, which say they are disconnected", async () => {
    const agent = await startAgentEngine();
    const link = await outside(agent);
    const session = await link.open();
    await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:kept", "stays after revoke")] });
    const [chat] = await chatsIn(agent);
    const connections = (await agent.rpc.call("agentConnections.list")).connections as unknown as Array<{ id: string }>;
    await agent.rpc.call("agentConnections.revoke", { id: connections[0]!.id });

    const settled = await agent.settled(chat!.id, 1);
    expect(settled.latestTurn?.state).toBe("completed");
    expect(settled.activities.some((activity) => activity.kind === "outside.disconnected")).toBe(true);
    expect(JSON.stringify(await agent.rpc.call("testCanvas.read", { project: PROJECT }))).toContain("stays after revoke");
    expect((await link.raw(session, { jsonrpc: "2.0", id: 9, method: "tools/list" })).status).toBe(401);
  });

  it("keeps an outside turn cut off by a quit as completed, and the session's next call opens turn 2 in the same chat", async () => {
    const dataDir = await makeTempDir();
    const first = await startAgentEngine({ dataDir });
    const link = await outside(first);
    const session = await link.open();
    await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:quit", "written before the quit")] });
    const [chat] = await chatsIn(first);
    await first.engine.stop("SIGKILL");

    const second = await startAgentEngine({ dataDir });
    const restored = await second.settled(chat!.id, 1);
    expect(restored.latestTurn).toMatchObject({ turnCount: 1, state: "completed" });
    expect(restored.latestTurn?.state).not.toBe("error");
    expect(JSON.stringify(await second.rpc.call("testCanvas.read", { project: PROJECT }))).toContain("written before the quit");

    await second.engine.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${link.token}`, "mcp-session-id": session },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "canvas_read", arguments: { project: PROJECT } } }),
    });
    const watched = await second.watch(chat!.id);
    const turnTwo = await watched.until((current) => current.latestTurn?.turnCount === 2, "turn 2");
    await watched.close();
    expect(turnTwo.latestTurn?.state).toBe("running");
    expect((await chatsIn(second)).map((item) => item.id)).toEqual([chat!.id]);
  });

  it("settles an open outside turn when its project is renamed, and finds the same chat under the new name", async () => {
    const agent = await startAgentEngine();
    const link = await outside(agent);
    const session = await link.open();
    await link.call(session, "canvas_read", { project: PROJECT });
    const [chat] = await chatsIn(agent);

    await agent.rpc.call("projects.rename", { name: PROJECT, to: "Renamed board" });
    // The chat now lives under the new name, so its turn is watched there.
    const subscription = agent.rpc.subscribe("orchestration.subscribeThread", { projectId: "renamed-board", threadId: chat!.id });
    const snapshot = await subscription.next(0) as { snapshot: { thread: { latestTurn: { state: string } | null } } };
    await subscription.close();
    expect(snapshot.snapshot.thread.latestTurn?.state).toBe("completed");

    const again = await link.call(session, "canvas_read", { project: "Renamed board" });
    expect(again.isError).toBe(false);
    expect((await chatsIn(agent, "renamed-board")).map((item) => item.id)).toEqual([chat!.id]);
    const old = await link.call(session, "canvas_read", { project: PROJECT });
    expect(old.value).toEqual({ error: `no project named "${PROJECT}"; call projects_list for the names` });
  });
});
