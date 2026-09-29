import { describe, expect, it } from "vitest";
import { startAgentEngine } from "./agent.ts";
import { scriptedSession } from "./agentCanvas.ts";

const listTools = (headers: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});

describe("the Unframed MCP server", () => {
  it("refuses no token, a revoked token and a non-loopback Origin, and lists the two canvas tools with a session's token", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    await agent.send(chatId, "what is on the board?");
    const chat = await agent.settled(chatId, 1);
    expect(chat.latestTurn?.state).toBe("completed");
    const { url, token } = await scriptedSession(agent, chatId);
    const path = new URL(url).pathname;
    expect(path).toBe("/mcp");

    expect((await agent.engine.request(path, listTools({}))).status).toBe(401);
    expect((await agent.engine.request(path, listTools({ authorization: "Bearer not-a-token" }))).status).toBe(401);
    const foreign = await agent.engine.request(path, listTools({ authorization: `Bearer ${token}`, origin: "https://evil.example" }));
    expect(foreign.status).toBe(403);

    const listed = await agent.engine.request(path, listTools({ authorization: `Bearer ${token}` }));
    expect(listed.status).toBe(200);
    const tools = listed.json().result.tools as Array<{ name: string; description: string; inputSchema: unknown }>;
    expect(tools.map((tool) => tool.name)).toEqual(["canvas_read", "canvas_write"]);
    expect(tools[0]!.description).toMatch(/^Read the whole canvas/);

    await agent.dispatch({ type: "thread.session.stop", threadId: chatId });
    const watched = await agent.watch(chatId);
    await watched.until((current) => current.session?.status === "stopped", "the session to stop");
    expect((await agent.engine.request(path, listTools({ authorization: `Bearer ${token}` }))).status).toBe(401);
  });

  it("runs the canvas tools check on turn 1 and reports it on the session event", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    await agent.send(chatId, "what is on the board?");
    const chat = await agent.settled(chatId, 1);
    const configured = chat.activities.find((activity) => activity.kind === "session.configured");
    expect(configured?.payload).toMatchObject({ tools: ["mcp__unframed__canvas_read", "mcp__unframed__canvas_write"], foreign: [] });
  });
});
