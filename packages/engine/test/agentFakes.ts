/**
 * Fake provider executables for the engine seam: small Node scripts standing in for
 * `claude`, `codex` and a login shell, so provider detection runs without a real CLI and
 * never spends anyone's quota. Each run appends one line to `FAKE_LOG` when it is set.
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const script = (body: string) => `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: require("node:path").basename(process.argv[1]), args }) + "\\n");
${body}
`;

const write = async (path: string, text: string) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
  await chmod(path, 0o755);
  return path;
};

/** A `claude` that prints a version and exits with `exitCode`. */
export const fakeClaude = (dir: string, options: { exitCode?: number } = {}) =>
  write(
    join(dir, "claude"),
    script(`
if (args[0] === "--version") { console.log("2.1.280 (Claude Code)"); process.exit(${options.exitCode ?? 0}); }
process.exit(${options.exitCode ?? 0});
`),
  );

/**
 * A `codex` whose `login status` prints `FAKE_CODEX_LOGIN` (default "Logged in using
 * ChatGPT"), and whose `app-server` answers `model/list` and `skills/list`.
 */
export const fakeCodex = (dir: string, name = "codex") =>
  write(
    join(dir, name),
    script(`
if (args[0] === "--version") { console.log("codex-cli 0.156.1"); process.exit(0); }
if (args[0] === "login" && args[1] === "status") { console.log(process.env.FAKE_CODEX_LOGIN ?? "Logged in using ChatGPT"); process.exit(0); }
if (args[0] === "app-server") {
  const rl = require("node:readline").createInterface({ input: process.stdin });
  const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
  rl.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    if (message.method === "initialize") send({ id: message.id, result: { userAgent: "fake" } });
    else if (message.method === "model/list" && !message.params.cursor)
      send({ id: message.id, result: { data: [{ id: "gpt-5.5-codex", model: "gpt-5.5-codex", displayName: "GPT-5.5 Codex", description: "", hidden: false, isDefault: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }] }], nextCursor: "page-2" } });
    else if (message.method === "model/list")
      send({ id: message.id, result: { data: [{ id: "gpt-6", model: "gpt-6", displayName: "GPT-6", description: "Newest", hidden: false, isDefault: true, defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }], nextCursor: null } });
    else if (message.method === "skills/list") send({ id: message.id, result: { data: [] } });
    else send({ id: message.id, error: { code: -32601, message: "method not found" } });
  });
  return;
}
process.exit(2);
`),
  );

/**
 * A `codex` whose `app-server` replays a recorded session: every message it receives is
 * logged to `FAKE_CODEX_MESSAGES` with its argv and the MCP token variable; a turn lists
 * the Unframed MCP tools with that token, streams a reply, asks for one command approval
 * and finishes with the decision it got. Threads it started are kept in `FAKE_CODEX_THREADS`
 * so a later process can resume them.
 */
export const fakeCodexAppServer = (dir: string) =>
  write(
    join(dir, "codex"),
    script(`
const fs = require("node:fs");
if (args[0] === "--version") { console.log("codex-cli 0.156.1"); process.exit(0); }
if (args[0] === "login" && args[1] === "status") { console.log("Logged in using ChatGPT"); process.exit(0); }
if (args[0] !== "app-server") process.exit(2);
const log = (entry) => fs.appendFileSync(process.env.FAKE_CODEX_MESSAGES, JSON.stringify(entry) + "\\n");
const threadsFile = process.env.FAKE_CODEX_THREADS;
const known = () => (fs.existsSync(threadsFile) ? fs.readFileSync(threadsFile, "utf8").split("\\n").filter(Boolean) : []);
const configArg = (key) => { for (let i = 0; i < args.length - 1; i++) if (args[i] === "-c" && args[i + 1].startsWith(key + "=")) return args[i + 1].slice(key.length + 1); };
log({ start: true, argv: args, token: process.env.UNFRAMED_MCP_TOKEN ?? null, cwd: process.cwd() });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let nextId = 1000;
const pending = new Map();
const request = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); send({ id, method, params }); });
const listTools = async () => {
  const url = configArg("mcp_servers.unframed.url");
  if (!url) return [];
  const answer = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.UNFRAMED_MCP_TOKEN }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
  if (answer.status !== 200) return ["status " + answer.status];
  return (await answer.json()).result.tools.map((tool) => tool.name);
};
let turns = 0;
const runId = Math.random().toString(16).slice(2, 8);
const runTurn = async (message) => {
  const threadId = message.params.threadId;
  turns++;
  const turnId = "cx-turn-" + runId + "-" + turns;
  send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
  send({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
  if (JSON.stringify(message.params.input).includes("crash now")) process.exit(3);
  const tools = await listTools();
  send({ method: "item/started", params: { threadId, turnId, item: { type: "agentMessage", id: "msg-" + runId + "-" + turns } } });
  send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "msg-" + runId + "-" + turns, delta: "Tools: " + tools.join(", ") + ". " } });
  send({ method: "item/started", params: { threadId, turnId, item: { type: "commandExecution", id: "cmd-" + runId + "-" + turns, command: "rm -rf build", status: "inProgress" } } });
  const answer = await request("item/commandExecution/requestApproval", { threadId, turnId, itemId: "cmd-" + runId + "-" + turns, command: "rm -rf build", cwd: process.cwd() });
  log({ approvalAnswer: answer });
  send({ method: "item/completed", params: { threadId, turnId, item: { type: "commandExecution", id: "cmd-" + runId + "-" + turns, command: "rm -rf build", status: answer.decision === "accept" || answer.decision === "acceptForSession" ? "completed" : "declined" } } });
  const text = "Tools: " + tools.join(", ") + ". Decision: " + answer.decision + ".";
  send({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", id: "msg-" + runId + "-" + turns, text } } });
  send({ method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage: { total: { inputTokens: 50, outputTokens: 10, totalTokens: 60 }, last: { totalTokens: 60 }, modelContextWindow: 272000 } } });
  send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  log({ message });
  if (message.method === undefined && pending.has(message.id)) { const resolve = pending.get(message.id); pending.delete(message.id); resolve(message.result); return; }
  if (message.id === undefined) return;
  switch (message.method) {
    case "initialize": return send({ id: message.id, result: { userAgent: "fake" } });
    case "model/list": return send({ id: message.id, result: { data: [{ id: "gpt-6", model: "gpt-6", displayName: "GPT-6", description: "", hidden: false, isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [] }], nextCursor: null } });
    case "skills/list": return send({ id: message.id, result: { data: [] } });
    case "thread/start": {
      const id = "th-" + Math.random().toString(16).slice(2, 10);
      fs.appendFileSync(threadsFile, id + "\\n");
      return send({ id: message.id, result: { thread: { id } } });
    }
    case "thread/resume":
      if (known().includes(message.params.threadId)) return send({ id: message.id, result: { thread: { id: message.params.threadId } } });
      return send({ id: message.id, error: { code: -32600, message: "no rollout found for thread id" } });
    case "mcpServerStatus/list": return send({ id: message.id, result: { data: [{ name: "unframed", tools: { canvas_read: {}, canvas_write: {} }, resources: [], resourceTemplates: [], authStatus: "unsupported" }] } });
    case "turn/start": return void runTurn(message);
    case "turn/interrupt": return send({ id: message.id, result: {} });
    case "thread/rollback": return send({ id: message.id, result: { thread: { id: message.params.threadId } } });
    default: return send({ id: message.id, error: { code: -32601, message: "method not found" } });
  }
});
`),
  );

/** Every message the fake app-server logged. */
export const fakeCodexMessages = async (log: string): Promise<any[]> =>
  (await readFile(log, "utf8").catch(() => ""))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));

export interface SignedInClaude {
  /** The SDK's `ModelInfo` rows the initialization reports. */
  readonly models?: ReadonlyArray<Record<string, unknown>>;
  readonly commands?: ReadonlyArray<{ name: string; description: string }>;
  readonly account?: Record<string, unknown>;
}

/**
 * A `claude` that answers the Agent SDK's initialization handshake as a signed-in CLI
 * would: the account, the supported models and the slash commands. It never runs a turn.
 */
export const fakeSignedInClaude = (dir: string, options: SignedInClaude = {}) =>
  write(
    join(dir, "claude"),
    script(`
if (args[0] === "--version") { console.log("2.1.280 (Claude Code)"); process.exit(0); }
const init = ${JSON.stringify({
      commands: options.commands ?? [],
      models: options.models ?? [],
      account: options.account ?? { email: "person@example.com", subscriptionType: "Max" },
    })};
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type !== "control_request") return;
  const response = message.request.subtype === "initialize" ? init : {};
  send({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response } });
});
rl.on("close", () => process.exit(0));
`),
  );

/** A login shell that answers `$SHELL -lc 'echo "$PATH"'` with `FAKE_SHELL_PATH`. */
export const fakeShell = (dir: string) => write(join(dir, "fake-shell"), `#!/bin/sh\necho "some profile banner"\necho "$FAKE_SHELL_PATH"\n`);

/** Every run the fakes logged. */
export const fakeRuns = async (log: string): Promise<Array<{ bin: string; args: string[] }>> =>
  (await readFile(log, "utf8").catch(() => ""))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
