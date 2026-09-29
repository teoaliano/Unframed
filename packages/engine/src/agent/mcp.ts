import { randomBytes } from "node:crypto";
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Route } from "../http/api.ts";
import { readJsonBody } from "../http/body.ts";
import { sendJson } from "../http/respond.ts";
import { ENGINE_VERSION } from "./version.ts";

export const MCP_PATH = "/mcp";
export const MCP_SERVER_NAME = "unframed";
const PROTOCOL_VERSION = "2025-06-18";

/** Who a session's token speaks for: one project and one chat. */
export interface McpBinding {
  readonly project: string;
  readonly chatId: string;
}

/**
 * The MCP bearer tokens: each provider session gets a fresh 256-bit token bound to one
 * project and one chat, revoked when the session closes.
 */
export class McpTokens {
  private readonly tokens = new Map<string, McpBinding>();

  issue(binding: McpBinding): string {
    const token = randomBytes(32).toString("hex");
    this.tokens.set(token, binding);
    return token;
  }

  resolve(token: string): McpBinding | undefined {
    if (token === "") return undefined;
    for (const [known, binding] of this.tokens) {
      const a = Buffer.from(known);
      const b = Buffer.from(token);
      if (a.length === b.length && timingSafeEqual(a, b)) return binding;
    }
    return undefined;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  revokeProject(project: string): void {
    for (const [token, binding] of this.tokens) if (binding.project === project) this.tokens.delete(token);
  }
}

/** A tool result: JSON text, marked as an error for a refusal. Never bytes. */
export interface ToolAnswer {
  readonly value: unknown;
  readonly isError?: boolean;
}

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly call: (binding: McpBinding, args: Record<string, unknown>) => Promise<ToolAnswer>;
}

/** The tools the Unframed server registers. Spec 09 adds its artifact and preview tools here. */
export class McpToolRegistry {
  private readonly tools = new Map<string, McpTool>();

  register(tool: McpTool): void {
    this.tools.set(tool.name, tool);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  get(name: string): McpTool | undefined {
    return this.tools.get(name);
  }

  list(): McpTool[] {
    return [...this.tools.values()];
  }
}

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };

const rpcResult = (id: JsonRpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const rpcError = (id: JsonRpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

const toolText = (answer: ToolAnswer) => ({
  content: [{ type: "text", text: JSON.stringify(answer.value) }],
  ...(answer.isError ? { isError: true } : {}),
});

/**
 * The Unframed MCP endpoint, streamable HTTP answered as plain JSON, on the engine's origin
 * behind the loopback guard. A request without a live session token is refused with 401
 * before any tool runs.
 */
export const mcpRoute =
  (tokens: McpTokens, registry: McpToolRegistry, onCall?: (binding: McpBinding) => void): Route =>
  async (req, res, url) => {
    if (url.pathname !== MCP_PATH) return false;
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    const binding = tokens.resolve(token);
    if (!binding) {
      req.resume();
      sendJson(res, 401, { error: "A valid session token is required." }, { "www-authenticate": "Bearer" });
      return true;
    }
    if (req.method === "DELETE") {
      req.resume();
      res.writeHead(200);
      res.end();
      return true;
    }
    if (req.method !== "POST") {
      req.resume();
      sendJson(res, 405, { error: "The Unframed MCP server answers POST only." }, { allow: "POST, DELETE" });
      return true;
    }
    const body = (await readJsonBody(req)) as JsonRpcRequest | JsonRpcRequest[];
    const batch = Array.isArray(body) ? body : [body];
    const answers: unknown[] = [];
    for (const message of batch) {
      const answer = await handle(message, binding, registry, onCall);
      if (answer !== undefined) answers.push(answer);
    }
    if (answers.length === 0) {
      res.writeHead(202);
      res.end();
      return true;
    }
    sendJson(res, 200, Array.isArray(body) ? answers : answers[0]);
    return true;
  };

const handle = async (
  message: JsonRpcRequest,
  binding: McpBinding,
  registry: McpToolRegistry,
  onCall: ((binding: McpBinding) => void) | undefined,
): Promise<unknown> => {
  if (typeof message !== "object" || message === null || typeof message.method !== "string") return rpcError(null, -32600, "Invalid request");
  const isNotification = message.id === undefined || message.id === null;
  switch (message.method) {
    case "initialize": {
      const asked = (message.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      return rpcResult(message.id, {
        protocolVersion: typeof asked === "string" ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: ENGINE_VERSION },
      });
    }
    case "ping":
      return rpcResult(message.id, {});
    case "tools/list":
      return rpcResult(message.id, {
        tools: registry.list().map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
      });
    case "tools/call": {
      const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
      const tool = typeof params.name === "string" ? registry.get(params.name) : undefined;
      if (!tool) return rpcError(message.id, -32602, `Unknown tool: ${String(params.name)}`);
      onCall?.(binding);
      const args = typeof params.arguments === "object" && params.arguments !== null ? (params.arguments as Record<string, unknown>) : {};
      let answer: ToolAnswer;
      try {
        answer = await tool.call(binding, args);
      } catch (error) {
        answer = { value: { error: error instanceof Error ? error.message : String(error) }, isError: true };
      }
      return rpcResult(message.id, toolText(answer));
    }
    default:
      if (isNotification) return undefined;
      return rpcError(message.id, -32601, `Method not found: ${message.method}`);
  }
};

/** A small MCP client over the same endpoint: the scripted agent reaches the tools exactly as a CLI does. */
export class McpClient {
  private nextId = 1;
  private readonly url: URL;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = new URL(url);
    this.token = token;
  }

  private post(body: unknown): Promise<{ status: number; json: any }> {
    const text = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: this.url.hostname,
          port: this.url.port,
          path: this.url.pathname,
          method: "POST",
          headers: {
            host: this.url.host,
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "content-length": Buffer.byteLength(text),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let json: unknown;
            try {
              json = raw === "" ? undefined : JSON.parse(raw);
            } catch {
              json = undefined;
            }
            resolve({ status: res.statusCode ?? 0, json });
          });
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  }

  async request(method: string, params?: unknown): Promise<any> {
    const answer = await this.post({ jsonrpc: "2.0", id: this.nextId++, method, ...(params === undefined ? {} : { params }) });
    if (answer.status !== 200) throw new Error(`MCP ${method} answered ${answer.status}`);
    if (answer.json?.error) throw new Error(String(answer.json.error.message));
    return answer.json?.result;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "unframed-scripted", version: ENGINE_VERSION } });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async listTools(): Promise<string[]> {
    const result = await this.request("tools/list", {});
    return Array.isArray(result?.tools) ? result.tools.map((tool: { name: string }) => tool.name) : [];
  }

  /** Calls a tool; answers its parsed JSON and whether it was an error. */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ value: unknown; isError: boolean }> {
    const result = await this.request("tools/call", { name, arguments: args });
    const text = result?.content?.[0]?.text;
    let value: unknown = text;
    try {
      value = typeof text === "string" ? JSON.parse(text) : text;
    } catch {
      // Plain text
    }
    return { value, isError: result?.isError === true };
  }
}
