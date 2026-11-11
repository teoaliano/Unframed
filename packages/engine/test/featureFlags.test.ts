import { describe, expect, it } from "vitest";
import { startAgentEngine, UNFRAMED_TOOLS } from "./agent.ts";
import { scriptedSession } from "./agentCanvas.ts";
import { startEngine } from "./engineProcess.ts";

const listTools = (token: string) => ({
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});

const NODES_OFF = { code: "unavailable", message: "Nodes are not available in this build." };
const EDITING_OFF = { code: "unavailable", message: "Element editing is not available in this build." };

const toolsOf = async (features: string | undefined) => {
  const agent = await startAgentEngine({ env: { UNFRAMED_FEATURES: features } });
  const chatId = await agent.createChat();
  await agent.send(chatId, "what is on the board?");
  await agent.settled(chatId, 1);
  const { url, token } = await scriptedSession(agent, chatId);
  const listed = await agent.engine.request(new URL(url).pathname, listTools(token));
  const tools = listed.json().result.tools as Array<{ name: string; description: string }>;
  return { agent, tools };
};

describe("UNFRAMED_FEATURES", () => {
  it.each([
    [undefined, []],
    ["element-editing,teleport", ["element-editing"]],
    ["all", ["nodes", "element-editing"]],
  ])("with UNFRAMED_FEATURES=%j, server.health reports %j", async (value, features) => {
    const engine = await startEngine({ env: { UNFRAMED_FEATURES: value } });
    expect((await (await engine.rpc()).call("server.health")).features).toEqual(features);
  });

  it("with nodes off, leaves node_run out of the agent's tools and nodes out of canvas_write", async () => {
    const { tools } = await toolsOf(undefined);
    expect(tools.map((tool) => tool.name)).toEqual(UNFRAMED_TOOLS.filter((name) => name !== "node_run"));
    const write = tools.find((tool) => tool.name === "canvas_write")!.description;
    expect(write).not.toContain("node_run");
    expect(write).toContain("A node or a wire already on the canvas can be moved, resized and deleted, never created or updated.");

    const { tools: allTools } = await toolsOf("all");
    expect(allTools.map((tool) => tool.name)).toContain("node_run");
  });

  it("with both off, refuses the RPC methods that run or save nodes and that edit an artifact's source", async () => {
    const { rpc } = await startAgentEngine({ env: { UNFRAMED_FEATURES: undefined } });
    const project = "board";
    await rpc.call("projects.create", { name: project }).catch(() => undefined);
    await expect(rpc.call("node.run", { project, shapeId: "shape:n" })).rejects.toMatchObject(NODES_OFF);
    await expect(rpc.call("chain.run", { project, shapeIds: ["shape:n"] })).rejects.toMatchObject(NODES_OFF);
    await expect(rpc.call("node.useVersion", { project, shapeId: "shape:n", versionId: "v1" })).rejects.toMatchObject(NODES_OFF);
    await expect(rpc.call("node.removeVersion", { project, shapeId: "shape:n", versionId: "v1" })).rejects.toMatchObject(NODES_OFF);
    await expect(rpc.call("flow.save", { project, shapeIds: ["shape:n"], name: "flow" })).rejects.toMatchObject(NODES_OFF);
    expect(await rpc.call("node.renders", { project, files: [] })).toEqual({ renders: {} });
    await expect(rpc.call("artifact.prepareEdit", { project, shapeId: "shape:p" })).rejects.toMatchObject(EDITING_OFF);
    await expect(rpc.call("artifact.edit", { project, shapeId: "shape:p", baseFile: "1-page.html", edits: [] })).rejects.toMatchObject(EDITING_OFF);
  });
});
