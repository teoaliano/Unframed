import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir, sourceEntry, startEngine } from "./harness.ts";
import { chatsIn } from "./outsideCalls.ts";
import { PROJECT } from "./agent.ts";

/** Polls until a check gives a value. */
const waitFor = async <A>(check: () => Promise<A | undefined>, what: string): Promise<A> => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** The shim as a child process (spec 14, task 19): its lines on stdout, and a way to send it messages. */
const shimPath = join(sourceEntry, "..", "mcpShim.ts");

class Shim {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: string[] = [];
  readonly errors: string[] = [];
  private waiting: Array<(line: string) => void> = [];
  private buffered = "";

  constructor(dataDir: string, token: string | undefined) {
    this.child = spawn(process.execPath, [shimPath, "--data-dir", dataDir], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, UNFRAMED_MCP_TOKEN: token },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.errors.push(chunk));
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffered += chunk;
      let index = this.buffered.indexOf("\n");
      while (index !== -1) {
        const line = this.buffered.slice(0, index);
        this.buffered = this.buffered.slice(index + 1);
        this.lines.push(line);
        this.waiting.shift()?.(line);
        index = this.buffered.indexOf("\n");
      }
    });
  }

  send(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** The next line the shim writes. */
  next(timeoutMs = 10_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the shim wrote no line in time")), timeoutMs);
      this.waiting.push((line) => {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      });
    });
  }

  /** A request and its answer. */
  async request(id: number, method: string, params: unknown = {}): Promise<any> {
    this.send({ jsonrpc: "2.0", id, method, params });
    return this.next();
  }

  /** Closes stdin, as a client does when it ends the session, and waits for the exit. */
  close(): Promise<number | null> {
    return new Promise((resolve) => {
      this.child.once("exit", (code) => resolve(code));
      this.child.stdin.end();
    });
  }
}

const handshake = async (shim: Shim) => {
  const init = await shim.request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  shim.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return init;
};

describe("the stdio shim", () => {
  it("relays a session to the engine, answers only JSON-RPC on stdout, and writes nothing for a notification", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: PROJECT });
    const made = await rpc.call("agentConnections.create", { name: "Relay", client: "claude-code" });
    const shim = new Shim(engine.dataDir, made.token as string);

    const init = await handshake(shim);
    expect(init.result.instructions).toMatch(/^Unframed is the person's local canvas/);
    const listed = await shim.request(2, "tools/list");
    expect(listed.result.tools[0].name).toBe("projects_list");
    expect(listed.result.tools.every((tool: { name: string; inputSchema: { required?: string[] } }) => tool.name === "projects_list" || tool.inputSchema.required?.includes("project"))).toBe(true);

    const projects = await shim.request(3, "tools/call", { name: "projects_list", arguments: {} });
    expect(JSON.parse(projects.result.content[0].text).projects.map((project: { name: string }) => project.name)).toEqual([PROJECT]);

    for (const line of shim.lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(shim.lines.length).toBe(3);
    await shim.close();
    await engine.stop("SIGTERM");
  });

  it("is one session: two shims with one token make two chats, and closing one ends only its session", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS: "60000" } });
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: PROJECT });
    const made = await rpc.call("agentConnections.create", { name: "Two", client: "claude-code" });
    const one = new Shim(engine.dataDir, made.token as string);
    const two = new Shim(engine.dataDir, made.token as string);
    await handshake(one);
    await handshake(two);
    await one.request(2, "tools/call", { name: "canvas_read", arguments: { project: PROJECT } });
    await two.request(2, "tools/call", { name: "canvas_read", arguments: { project: PROJECT } });
    expect(await chatsIn({ rpc: await engine.rpc() } as never, PROJECT)).toHaveLength(2);

    await one.close();
    // Each chat's thread, read whole: the one whose session closed says so, the other's turn stays open.
    const watcher = await engine.rpc();
    const snapshots = async () => {
      const found = [];
      for (const chat of await chatsIn({ rpc: watcher } as never, PROJECT)) {
        const sub = watcher.subscribe("orchestration.subscribeThread", { projectId: PROJECT, threadId: chat.id });
        const first = (await sub.next(0)) as unknown as { snapshot: { thread: { latestTurn: { state: string } | null; activities: Array<{ kind: string }> } } };
        await sub.close();
        found.push(first.snapshot.thread);
      }
      return found;
    };
    const after = await waitFor(async () => {
      const threads = await snapshots();
      return threads.some((thread) => thread.activities.some((row) => row.kind === "outside.session-ended")) ? threads : undefined;
    }, "the closed session to end");
    expect(after.filter((thread) => thread.activities.some((row) => row.kind === "outside.session-ended"))).toHaveLength(1);
    expect(after.filter((thread) => thread.latestTurn?.state === "running")).toHaveLength(1);
    await two.close();
    await engine.stop("SIGTERM");
  });

  it("answers the list from its own copy and every call with the not-open sentence while Unframed is closed", async () => {
    const dataDir = await makeTempDir();
    const shim = new Shim(dataDir, "ufx_" + "0".repeat(64));
    const init = await handshake(shim);
    expect(init.result.serverInfo.name).toBe("unframed");
    const listed = await shim.request(2, "tools/list");
    expect(listed.result.tools[0].name).toBe("projects_list");
    const called = await shim.request(3, "tools/call", { name: "canvas_read", arguments: { project: PROJECT } });
    expect(called.result.isError).toBe(true);
    expect(JSON.parse(called.result.content[0].text)).toEqual({ error: "Unframed is not open. Ask the person to open it, then try again." });
    await shim.close();
  });

  it("answers the not-open sentence for a discovery file whose process is gone", async () => {
    const dataDir = await makeTempDir();
    await writeFile(join(dataDir, "mcp-endpoint.json"), JSON.stringify({ port: 1, pid: 2147483646, version: "x", startedAt: "2026-10-14T00:00:00.000Z" }));
    const shim = new Shim(dataDir, "ufx_" + "0".repeat(64));
    await handshake(shim);
    const called = await shim.request(2, "tools/call", { name: "projects_list", arguments: {} });
    expect(JSON.parse(called.result.content[0].text)).toEqual({ error: "Unframed is not open. Ask the person to open it, then try again." });
    await shim.close();
  });

  it("answers the no-token sentence when started without a token, and the refused sentence for a revoked one", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    const made = await rpc.call("agentConnections.create", { name: "Gone", client: "codex" });
    const noToken = new Shim(engine.dataDir, undefined);
    await handshake(noToken);
    const bare = await noToken.request(2, "tools/call", { name: "projects_list", arguments: {} });
    expect(JSON.parse(bare.result.content[0].text)).toEqual({ error: "This Unframed connection has no token. Copy the setup from Unframed's Settings again." });
    await noToken.close();

    const connections = (await rpc.call("agentConnections.list")).connections;
    await rpc.call("agentConnections.revoke", { id: connections[0]!.id });
    const revoked = new Shim(engine.dataDir, made.token as string);
    await handshake(revoked);
    const refused = await revoked.request(2, "tools/call", { name: "projects_list", arguments: {} });
    expect(JSON.parse(refused.result.content[0].text)).toEqual({ error: "Unframed refused this connection. It was revoked or its token is wrong. The person can make a new one in Unframed's Settings." });
    await revoked.close();
    await engine.stop("SIGTERM");
  });

  it("starts with Unframed closed, then reaches the engine that opens on a new port with the same process", async () => {
    const dataDir = await makeTempDir();
    const first = await startEngine({ dataDir });
    const rpc = await first.rpc();
    await rpc.call("projects.create", { name: PROJECT });
    const made = await rpc.call("agentConnections.create", { name: "Later", client: "claude-code" });
    await first.stop("SIGTERM");

    const shim = new Shim(dataDir, made.token as string);
    await handshake(shim);
    const closed = await shim.request(2, "tools/call", { name: "projects_list", arguments: {} });
    expect(closed.result.isError).toBe(true);

    const second = await startEngine({ dataDir });
    const open = await shim.request(3, "tools/call", { name: "projects_list", arguments: {} });
    expect(open.result.isError).toBeUndefined();
    expect(JSON.parse(open.result.content[0].text).projects).toHaveLength(1);
    await shim.close();
    await second.stop("SIGTERM");
  });
});
