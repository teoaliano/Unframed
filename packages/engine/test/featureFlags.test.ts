import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, UNFRAMED_TOOLS } from "./agent.ts";
import { scriptedSession, seed } from "./agentCanvas.ts";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { makeRepo, repoEngineEnv } from "./gitRepos.ts";
import { makeTempDir, startEngine } from "./harness.ts";
import { screenShape } from "./canvasRecords.ts";

const listTools = (token: string) => ({
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});

const NODES_OFF = { code: "unavailable", message: "Nodes are not available in this build." };
const EDITING_OFF = { code: "unavailable", message: "Element editing is not available in this build." };
const REPOSITORIES_OFF = { code: "unavailable", message: "Repositories are not available in this build." };

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
    ["all", ["nodes", "element-editing", "repositories"]],
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

  it("with repositories off, says nothing of Screens in the canvas and preview tools", async () => {
    const { tools } = await toolsOf("nodes");
    const description = (name: string) => tools.find((tool) => tool.name === name)!.description;
    expect(description("canvas_read")).not.toMatch(/screen/i);
    expect(description("canvas_write")).not.toMatch(/screen/i);
    expect(description("preview_open")).not.toMatch(/Screen/);
    expect(tools.map((tool) => tool.name).filter((name) => name.startsWith("instance_") || name === "screen_state" || name === "flow_create" || name === "screen_element")).toEqual([]);

    const { tools: allTools } = await toolsOf("all");
    expect(allTools.find((tool) => tool.name === "canvas_read")!.description).toContain("a screen shows one state of one Instance");
    expect(allTools.find((tool) => tool.name === "preview_open")!.description).toContain("shapeId may also name a Screen");
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

  it("with repositories off, leaves a Screen's element chips out of the preamble", async () => {
    const chip = { shapeId: "shape:sc1", elementId: null, selector: "body > button", tag: "button", label: "save", excerpt: "<button>Save</button>" };
    const script = JSON.stringify({ when: "^screen", turns: [{ text: "Nothing pointed at.", expectPreamble: "^(?![\\s\\S]*the running app)" }] });
    const agent = await startAgentEngine({ script: await scriptFolder({ screen: script }), env: { UNFRAMED_FEATURES: undefined } });
    await seed(agent, [screenShape("sc1", { title: "trunk", route: "/app" })]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "screen: make it red", { selection: ["shape:sc1"], elements: [chip] });
    const chat = await agent.settled(chatId, 1);
    expect(chat.messages.some((message) => message.text === "Nothing pointed at.")).toBe(true);
  });

  it("with repositories off, refuses every Repository RPC and never opens the picker", async () => {
    const engine = await startEngine({ env: { UNFRAMED_FEATURES: undefined, UNFRAMED_TEST_PICK_FOLDER: "/Users/someone/app" } });
    const rpc = await engine.rpc();
    await expect(rpc.call("repositories.pickFolder")).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("repositories.add", { path: engine.dataDir })).rejects.toMatchObject(REPOSITORIES_OFF);
    const instance = { project: "app", id: "a1b2c3d4" };
    await expect(rpc.call("instances.create", { project: "app" })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("instances.remove", instance)).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("instances.list", { project: "app" })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("instances.status", instance)).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("instances.start", instance)).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("instances.stop", instance)).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("instances.demand", { project: "app", client: "window-1", ids: [instance.id] })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("instances.branches", { project: "app" })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("instances.diff", instance)).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("instances.gitAction", { ...instance, action: "commit" })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("repositories.read", { project: "app" })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("repositories.locate", { project: "app", path: engine.dataDir })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("repositories.setup", { project: "app" })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("screens.stateToken", { project: "app", instance: instance.id, steps: [], mocks: [{ url: "/api" }] })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("screens.capture", { project: "app", shape: "shape:sc1", w: 1280, h: 800, html: "<p>copy</p>", parts: [] })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("repositories.confirmLogin", { project: "app" })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("screens.inspect", { project: "app", instance: instance.id, file: "src/App.tsx", line: 1, col: 1 })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("screens.apply", { project: "app", instance: instance.id, changes: [] })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("screens.revert", { project: "app", apply: "a" })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("repositories.setupVerdict", { project: "app", accepted: true })).rejects.toMatchObject(REPOSITORIES_OFF);
    const states = rpc.subscribe("instances.subscribe", { project: "app" });
    await expect(states.next()).rejects.toMatchObject(REPOSITORIES_OFF);
    expect(await engine.nativeLog()).toEqual([]);
    expect((await rpc.call("projects.list")).projects).toEqual([]);
  });

  it("with repositories off, opens an existing Repository on its Screens' pictures and starts no Instance or Setup", { timeout: 90_000 }, async () => {
    const root = await makeRepo("shop");
    const dataDir = await makeTempDir();
    const on = await startEngine({ dataDir, env: await repoEngineEnv({ UNFRAMED_TEST_CANVAS: "1", UNFRAMED_TEST_RENDERER: "ok" }) });
    const onRpc = await on.rpc();
    const added = await onRpc.call("repositories.add", { path: root });
    const placed = ((await onRpc.call("testCanvas.read", { project: "shop" })).records as any[]).find((record) => record.type === "screen");
    const held = { route: "/app", state: "the menu open", steps: [{ action: "click", target: { role: "button", name: "Menu" } }], mocks: [{ url: "/api/items", fail: true }] };
    await onRpc.call("testCanvas.apply", { project: "shop", change: { put: [{ ...placed, props: { ...placed.props, ...held } }], remove: [] }, origin: { kind: "server", id: "test" } });
    for (let tries = 0; (await onRpc.call("instances.status", { project: "shop", id: added.instance.id })).state !== "stopped"; tries++) {
      if (tries > 200) throw new Error("the Instance never settled");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await onRpc.call("instances.demand", { project: "shop", client: "window-1", ids: [added.instance.id] });
    let picture: string | undefined;
    for (let tries = 0; picture === undefined; tries++) {
      if (tries > 600) throw new Error("the Screen was never pictured");
      await new Promise((resolve) => setTimeout(resolve, 100));
      picture = ((await onRpc.call("testCanvas.read", { project: "shop" })).records as any[]).find((record) => record.id === placed.id)?.props.picture;
    }
    await on.stop("SIGTERM");

    const off = await startEngine({ dataDir, env: await repoEngineEnv({ UNFRAMED_FEATURES: undefined, UNFRAMED_TEST_CANVAS: "1", UNFRAMED_TEST_RENDERER: "ok" }) });
    const rpc = await off.rpc();
    expect((await rpc.call("projects.list")).kinds).toMatchObject({ shop: "repository" });
    const records = (await rpc.call("testCanvas.read", { project: "shop" })).records as Array<{ type?: string; id: string; props?: { instance?: string } }>;
    const screen = records.find((record) => record.type === "screen")!;
    expect(screen.props?.instance).toBe(added.instance.id);
    expect(screen.props).toMatchObject(held);
    expect(screen.props).toMatchObject({ picture });
    for (const name of [`${picture}.png`, `${picture}.w384.png`, `${picture}.w128.png`, `${picture}.html`]) expect((await off.request(`/api/pictures/shop/${name}`)).status).toBe(200);
    await expect(rpc.call("screens.capture", { project: "shop", shape: screen.id, w: 1280, h: 800, html: "<p>copy</p>", parts: [] })).rejects.toMatchObject(REPOSITORIES_OFF);
    await expect(rpc.call("instances.demand", { project: "shop", client: "window-1", ids: [added.instance.id] })).rejects.toMatchObject(REPOSITORIES_OFF);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pids = join(dataDir, "instance-pids");
    expect(existsSync(pids) ? await readdir(pids) : []).toEqual([]);
    const chats = rpc.subscribe("orchestration.subscribeShell", { projectId: "shop" });
    const shell = await chats.next();
    expect(shell.kind === "snapshot" ? shell.chats.map((chat) => chat.title) : undefined).toEqual(["Setup"]);
  });
});
