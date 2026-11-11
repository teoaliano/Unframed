import { describe, expect, it } from "vitest";
import { startAgentEngine, UNFRAMED_TOOLS } from "./agent.ts";
import { scriptedSession } from "./agentCanvas.ts";

const listTools = (headers: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});

describe("the Unframed MCP server", () => {
  it("refuses no token, a revoked token and a non-loopback Origin, and lists every Unframed tool with a session's token", async () => {
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
    expect(tools.map((tool) => tool.name)).toEqual(UNFRAMED_TOOLS);
    expect(tools[0]!.description).toMatch(/^Read the whole canvas/);

    await agent.dispatch({ type: "thread.session.stop", threadId: chatId });
    const watched = await agent.watch(chatId);
    await watched.until((current) => current.session?.status === "stopped", "the session to stop");
    expect((await agent.engine.request(path, listTools({ authorization: `Bearer ${token}` }))).status).toBe(401);
  });

  it("tells the agent, in the tool descriptions, about element ids, locks, components and parameters", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    await agent.send(chatId, "what is on the board?");
    await agent.settled(chatId, 1);
    const { url, token } = await scriptedSession(agent, chatId);
    const listed = await agent.engine.request(new URL(url).pathname, listTools({ authorization: `Bearer ${token}` }));
    const described = new Map((listed.json().result.tools as Array<{ name: string; description: string }>).map((tool) => [tool.name, tool.description]));

    const page = described.get("page_write")!;
    expect(page).toContain("The engine stamps every element with a data-hf-id on each write");
    expect(page).toContain("Keep data-uf-name and data-uf-hidden on the element they belong to");
    expect(page).toContain("a write that changes one is refused");
    expect(page).toContain("assign its value straight to it (`el.style.color = v.accent`, `el.style.fontSize = v.size + \"px\"`)");
    expect(page).toContain("Use instances of the project's components instead of copying their markup");

    const motion = described.get("motion_write")!;
    expect(motion).toContain("The engine stamps every element with a data-hf-id on each write");
    expect(motion).toContain("a write that changes one is refused");
    expect(motion).toContain("except the engine's component pins");
    expect(motion).toContain("animate an instance as one element or through a custom property it exposes");
    expect(motion).toContain("never chained onto `gsap.timeline()`");

    expect(described.get("canvas_read")).toContain("lockedElements");
    expect(described.get("canvas_read")).toContain("components");
    expect(described.get("canvas_write")).toContain("lockedElements belongs to the person");
    expect(described.get("canvas_write")).toContain("and components with component_write, not here");
  });

  it("runs the canvas tools check on turn 1 and reports it on the session event", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    await agent.send(chatId, "what is on the board?");
    const chat = await agent.settled(chatId, 1);
    const configured = chat.activities.find((activity) => activity.kind === "session.configured");
    expect(configured?.payload).toMatchObject({ tools: UNFRAMED_TOOLS.map((name) => `mcp__unframed__${name}`), foreign: [] });
  });
});
