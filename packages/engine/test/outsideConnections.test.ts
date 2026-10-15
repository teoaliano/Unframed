import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir, startEngine, type TestEngine } from "./harness.ts";

const mcpPost = (token: string | undefined, body: unknown, extra: Record<string, string | undefined> = {}) => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: token === undefined ? undefined : `Bearer ${token}`,
    ...extra,
  },
  body: JSON.stringify(body),
});

const rpcBody = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id, method, params });

/** Makes a connection over RPC and returns its token and the session an `initialize` opens. */
type Client = "claude-code" | "codex" | "claude-desktop" | "other";
const connect = async (engine: TestEngine, name = "Work laptop Claude Code", client: Client = "claude-code") => {
  const rpc = await engine.rpc();
  const made = await rpc.call("agentConnections.create", { name, client });
  return { rpc, connection: made.connection, token: made.token as string, setup: made.setup as Array<{ text: string; code?: string }> };
};

const openSession = async (engine: TestEngine, token: string): Promise<string> => {
  const answer = await engine.request("/mcp", mcpPost(token, rpcBody(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })));
  expect(answer.status).toBe(200);
  const session = answer.headers["mcp-session-id"];
  expect(session).toMatch(/^[0-9a-f-]{36}$/);
  return session as string;
};

describe("agent connections over RPC", () => {
  it("creates a connection, answers its token and setup once, and lists it with neither a token nor a hash", async () => {
    const engine = await startEngine({ env: { ELECTRON_RUN_AS_NODE: undefined } });
    const { rpc, connection, token, setup } = await connect(engine);
    expect(token).toMatch(/^ufx_[0-9a-f]{64}$/);
    expect(connection).toMatchObject({ name: "Work laptop Claude Code", client: "claude-code", lastUsedAt: null });
    expect(setup[0]!.code).toContain(`--env UNFRAMED_MCP_TOKEN=${token} unframed-app`);
    expect(setup[0]!.code).not.toContain("ELECTRON_RUN_AS_NODE");

    const listed = await rpc.call("agentConnections.list");
    expect(listed.connections).toEqual([connection]);
    expect(JSON.stringify(listed)).not.toContain(token);
  });

  it("adds ELECTRON_RUN_AS_NODE to the setup only when the engine runs as Node through Electron", async () => {
    const engine = await startEngine({ env: { ELECTRON_RUN_AS_NODE: "1" } });
    const made = await (await engine.rpc()).call("agentConnections.create", { name: "Hosted", client: "claude-code" });
    expect(made.setup[0]!.code).toContain(`--env UNFRAMED_MCP_TOKEN=${made.token} --env ELECTRON_RUN_AS_NODE=1 unframed-app`);
  });

  it("keeps only the token's hash in a 0600 file", async () => {
    const engine = await startEngine({ env: { ELECTRON_RUN_AS_NODE: undefined } });
    const { token } = await connect(engine, "Codex in the IDE", "codex");
    const path = join(engine.dataDir, "agent-connections.json");
    const text = await readFile(path, "utf8");
    expect(text).not.toContain(token);
    const stored = JSON.parse(text).connections[0];
    expect(stored.tokenSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("refuses a name that is empty or longer than 40 characters, and trims the rest", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await expect(rpc.call("agentConnections.create", { name: "  ", client: "other" })).rejects.toMatchObject({ code: "bad_request", message: "Name the connection." });
    await expect(rpc.call("agentConnections.create", { name: "x".repeat(41), client: "other" })).rejects.toMatchObject({
      code: "bad_request",
      message: "Keep the name to 40 characters.",
    });
    const { connection } = await connect(engine, "  Desk  ", "other");
    expect(connection.name).toBe("Desk");
  });

  it("answers not_found when revoking a connection that does not exist", async () => {
    const engine = await startEngine();
    await expect((await engine.rpc()).call("agentConnections.revoke", { id: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({
      code: "not_found",
      message: "That connection no longer exists.",
    });
  });

  it("names the Claude desktop config path and the Codex config file in their setups", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    const codex = await rpc.call("agentConnections.create", { name: "Codex", client: "codex" });
    expect(codex.setup.map((step: { text: string }) => step.text)).toContain("Or add this to ~/.codex/config.toml:");
    const desktop = await rpc.call("agentConnections.create", { name: "Desktop", client: "claude-desktop" });
    expect(desktop.setup[0]!.text).toContain("claude_desktop_config.json");
  });
});

describe("the MCP endpoint with a connection token", () => {
  it("refuses no token, a wrong token and a request without a session, and refuses a foreign Origin", async () => {
    const engine = await startEngine();
    const { token } = await connect(engine);
    expect((await engine.request("/mcp", mcpPost(undefined, rpcBody(1, "tools/list")))).status).toBe(401);
    expect((await engine.request("/mcp", mcpPost("ufx_" + "0".repeat(64), rpcBody(1, "tools/list")))).status).toBe(401);
    const noSession = await engine.request("/mcp", mcpPost(token, rpcBody(1, "tools/list")));
    expect(noSession.status).toBe(400);
    expect(noSession.json()).toEqual({ error: "Send the Mcp-Session-Id that initialize answered." });
    const foreign = await engine.request("/mcp", mcpPost(token, rpcBody(1, "tools/list"), { origin: "https://evil.example" }));
    expect(foreign.status).toBe(403);
  });

  it("answers the outside instructions and a fresh session id on each initialize", async () => {
    const engine = await startEngine();
    const { token } = await connect(engine);
    const first = await engine.request("/mcp", mcpPost(token, rpcBody(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {} })));
    const second = await engine.request("/mcp", mcpPost(token, rpcBody(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {} })));
    expect(first.json().result.instructions).toMatch(/^Unframed is the person's local canvas/);
    expect(first.headers["mcp-session-id"]).not.toBe(second.headers["mcp-session-id"]);
  });

  it("lists projects_list alone for now, and answers each project with its folder and the active one", async () => {
    const engine = await startEngine();
    const { token } = await connect(engine);
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "Zeta board" });
    await rpc.call("projects.create", { name: "Alpha board" });
    await rpc.call("preferences.set", { key: "project.active", value: "alpha-board" });
    const session = await openSession(engine, token);

    const listed = await engine.request("/mcp", mcpPost(token, rpcBody(2, "tools/list"), { "mcp-session-id": session }));
    expect(listed.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual(["projects_list"]);

    const called = await engine.request("/mcp", mcpPost(token, rpcBody(3, "tools/call", { name: "projects_list", arguments: {} }), { "mcp-session-id": session }));
    const payload = JSON.parse(called.json().result.content[0].text);
    expect(payload.projects.map((project: { name: string }) => project.name)).toEqual(["alpha-board", "zeta-board"]);
    expect(payload.projects[0]).toMatchObject({ active: true });
    expect(payload.projects[0].folder).toMatch(/alpha-board$/);
    expect(payload.projects[1]).toMatchObject({ active: false });
  });

  it("refuses a tool the outside list does not carry yet", async () => {
    const engine = await startEngine();
    const { token } = await connect(engine);
    const session = await openSession(engine, token);
    const answer = await engine.request("/mcp", mcpPost(token, rpcBody(2, "tools/call", { name: "canvas_read", arguments: {} }), { "mcp-session-id": session }));
    expect(answer.json().error).toMatchObject({ code: -32602 });
  });

  it("refuses a revoked connection with 401 on its next call, and the revoke leaves the store without it", async () => {
    const engine = await startEngine();
    const { rpc, connection, token } = await connect(engine);
    const session = await openSession(engine, token);
    await rpc.call("agentConnections.revoke", { id: connection.id });
    expect((await engine.request("/mcp", mcpPost(token, rpcBody(2, "tools/list"), { "mcp-session-id": session }))).status).toBe(401);
    expect(await rpc.call("agentConnections.list")).toEqual({ connections: [] });
  });

  it("keeps a connection and its session working across an engine restart", async () => {
    const dataDir = await makeTempDir();
    const first = await startEngine({ dataDir });
    const { token } = await connect(first);
    const session = await openSession(first, token);
    await first.stop("SIGTERM");

    const second = await startEngine({ dataDir });
    const listed = await listWith(second, token, session);
    expect(listed.status).toBe(200);
    expect(listed.json().result.tools[0].name).toBe("projects_list");
  });

  it("refuses every token and logs the line when agent-connections.json is unreadable, and the next create heals the file", async () => {
    const dataDir = await makeTempDir();
    await writeFile(join(dataDir, "agent-connections.json"), "{ not json");
    const engine = await startEngine({ dataDir });
    expect(engine.stderr()).toContain(
      "could not read agent-connections.json, so every outside connection is refused until one is made again.",
    );
    const rpc = await engine.rpc();
    expect(await rpc.call("agentConnections.list")).toEqual({ connections: [] });
    const { token } = await connect(engine);
    expect((await engine.request("/mcp", mcpPost(token, rpcBody(1, "tools/list")))).status).toBe(400);
    expect(JSON.parse(await readFile(join(dataDir, "agent-connections.json"), "utf8")).connections).toHaveLength(1);
  });
});

const listWith = (running: TestEngine, token: string, session: string) =>
  running.request("/mcp", mcpPost(token, rpcBody(9, "tools/list"), { "mcp-session-id": session }));

describe("the discovery file", () => {
  it("names the API port, the pid and the version, is owner-only, and is removed on SIGTERM", async () => {
    const engine = await startEngine();
    const path = join(engine.dataDir, "mcp-endpoint.json");
    const found = JSON.parse(await readFile(path, "utf8"));
    expect(found).toMatchObject({ port: engine.port, pid: engine.pid });
    expect(typeof found.version).toBe("string");
    expect(typeof found.startedAt).toBe("string");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await engine.stop("SIGTERM");
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes the new port when the engine starts again on another port", async () => {
    const dataDir = await makeTempDir();
    const first = await startEngine({ dataDir });
    await first.stop("SIGTERM");
    const second = await startEngine({ dataDir });
    expect(JSON.parse(await readFile(join(dataDir, "mcp-endpoint.json"), "utf8")).port).toBe(second.port);
  });
});

