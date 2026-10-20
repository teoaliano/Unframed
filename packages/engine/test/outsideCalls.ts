/**
 * An outside client's side of outside connections, as the tests drive it: an outside connection, one client
 * session of it (opened with `initialize`), and the chats the project's shell lists.
 */
import type { ChatSummary, SpendLimit } from "@unframed/contracts";
import { PROJECT, shellChats, type AgentEngine } from "./agent.ts";

const rpcBody = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id, method, params });

export interface OutsideLink {
  readonly token: string;
  open(): Promise<string>;
  call(session: string, name: string, args: Record<string, unknown>): Promise<{ value: any; isError: boolean; content: string[] }>;
  list(session: string): Promise<Array<{ name: string; inputSchema: { required: string[] } }>>;
  end(session: string): Promise<number>;
  raw(session: string | undefined, body: unknown): Promise<{ status: number; headers: Record<string, unknown>; json(): any }>;
}

/** A connection made over RPC and its client, which can open sessions and make calls. */
export const outsideLink = async (agent: AgentEngine, name = "Work laptop Claude Code", spendLimit?: SpendLimit): Promise<OutsideLink> => {
  const made = await agent.rpc.call("agentConnections.create", { name, client: "claude-code", ...(spendLimit === undefined ? {} : { spendLimit }) });
  const token = made.token as string;
  const raw = (session: string | undefined, body: unknown) =>
    agent.engine.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "mcp-session-id": session },
      body: JSON.stringify(body),
    });
  return {
    token,
    async open() {
      const answer = await agent.engine.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(rpcBody(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {} })),
      });
      return answer.headers["mcp-session-id"] as string;
    },
    async call(session, toolName, args) {
      const answer = await raw(session, rpcBody(2, "tools/call", { name: toolName, arguments: args }));
      const result = answer.json().result as { content: Array<{ text: string }>; isError?: boolean };
      const content = result.content.map((item) => item.text);
      return { value: JSON.parse(content.at(-1)!), isError: result.isError === true, content };
    },
    async list(session) {
      const answer = await raw(session, rpcBody(3, "tools/list"));
      return answer.json().result.tools;
    },
    async end(session) {
      const answer = await agent.engine.request("/mcp", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, "mcp-session-id": session },
      });
      return answer.status;
    },
    raw: (session, body) => raw(session, body),
  };
};

/** The project's chats, from a fresh snapshot of its shell. */
export const chatsIn = async (agent: AgentEngine, project = PROJECT): Promise<ChatSummary[]> => {
  const shell = agent.rpc.subscribe("orchestration.subscribeShell", { projectId: project });
  await shell.next(0);
  const found = [...shellChats(shell.values).values()];
  await shell.close();
  return found;
};
