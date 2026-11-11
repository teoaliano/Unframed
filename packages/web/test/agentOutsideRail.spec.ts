import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas, roomShapes } from "./canvas.ts";
import { expect, openRail, rail, tabs, test } from "./agent.ts";

const rpcBody = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id, method, params });

/** One client session of an outside connection: opened with `initialize`, then its calls and its end. */
const session = async (engine: TestEngine, token: string) => {
  const answer = await engine.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(rpcBody(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {} })),
  });
  const id = answer.headers["mcp-session-id"] as string;
  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = await engine.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "mcp-session-id": id },
      body: JSON.stringify(rpcBody(2, "tools/call", { name, arguments: args })),
    });
    return reply.json();
  };
  const end = () => engine.request("/mcp", { method: "DELETE", headers: { authorization: `Bearer ${token}`, "mcp-session-id": id } });
  return { call, end };
};

/** A tab's running spinner, read from inside the tab. */
const DOT = "[data-testid='chat-status'][data-status='running']";

test("two sessions of one connection share a tab, which settles with its recap and revert when the last ends, and a later session reopens it", async ({ page, agent }) => {
  await openCanvas(page, agent, "default");
  const rpc = await agent.rpc();
  const made = await rpc.call("agentConnections.create", { name: "Laptop Claude", client: "claude-code" });
  const one = await session(agent, made.token as string);
  const two = await session(agent, made.token as string);
  await one.call("canvas_read", { project: "default" });
  await two.call("canvas_write", { project: "default", ops: [{ type: "create", id: "new:note", kind: "prompt", x: 0, y: 0, props: { text: "from the second session" } }] });

  const panel = await openRail(page);
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toContainText("Laptop Claude");
  await expect(tabs(page).first()).not.toContainText("·");
  await tabs(page).first().click();
  await expect(panel.getByText("Working from outside Unframed…")).toBeVisible();
  await expect(panel.getByTestId("outside-line")).toContainText("works from outside Unframed. Talk to it where it runs.");
  await expect(panel.getByTestId("outside-line").getByRole("button", { name: "New chat" })).toBeVisible();

  await two.end();
  await expect(tabs(page).first().locator(DOT)).toHaveCount(1);
  await one.end();
  await expect(tabs(page).first().locator(DOT)).toHaveCount(0);
  await expect(panel.getByText("This session ended.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Revert this turn" })).toBeVisible();
  await panel.getByRole("button", { name: "Revert this turn" }).click();
  await expect(panel.getByText("Reverted", { exact: true })).toBeVisible();
  await expect.poll(async () => JSON.stringify(await roomShapes(agent, "default", "prompt"))).not.toContain("from the second session");

  const three = await session(agent, made.token as string);
  await three.call("canvas_read", { project: "default" });
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first().locator(DOT)).toHaveCount(1);
  await expect(panel.getByText("This session ended.")).toHaveCount(0);
});

test("a revoked connection's open chat says it is disconnected", async ({ page, agent }) => {
  await openCanvas(page, agent, "default");
  const rpc = await agent.rpc();
  const made = await rpc.call("agentConnections.create", { name: "Desk", client: "codex" });
  const link = await session(agent, made.token as string);
  await link.call("canvas_read", { project: "default" });
  const panel = await openRail(page);
  await expect(panel.getByTestId("chat-status")).toHaveCount(1);

  const connections = (await rpc.call("agentConnections.list")).connections;
  await rpc.call("agentConnections.revoke", { id: connections[0]!.id });
  await tabs(page).first().click();
  await expect(panel.getByText("Disconnected. This connection was revoked in Settings.")).toBeVisible();
});
