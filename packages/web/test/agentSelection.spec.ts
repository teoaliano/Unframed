import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";

const rpcBody = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id, method, params });

/** One client session of an outside connection (see agentOutsideRail.spec.ts). */
const session = async (engine: TestEngine, token: string) => {
  const answer = await engine.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(rpcBody(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {} })),
  });
  const id = answer.headers["mcp-session-id"] as string;
  return (name: string, args: Record<string, unknown>) =>
    engine
      .request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "mcp-session-id": id },
        body: JSON.stringify(rpcBody(2, "tools/call", { name, arguments: args })),
      })
      .then((reply) => JSON.parse(reply.json().result.content.at(-1).text) as Record<string, any>);
};

/** Two prompts made from outside: their ids as the canvas and the agent name them. */
const twoPrompts = async (engine: TestEngine, call: Awaited<ReturnType<typeof session>>) => {
  const made = await call("canvas_write", { project: "default", ops: [
    { type: "create", id: "new:a", kind: "prompt", x: 0, y: 0, props: { text: "first" } },
    { type: "create", id: "new:b", kind: "prompt", x: 400, y: 0, props: { text: "second" } },
  ] });
  const ids = made.ids as Record<string, string>;
  void engine;
  return { a: ids["new:a"]!, b: ids["new:b"]! };
};

test("a click in the app reaches the outside read, the most recently used window wins, and the window closing hands back the earlier one", async ({ page, agent }) => {
  await openCanvas(page, agent, "default");
  const rpc = await agent.rpc();
  const made = await rpc.call("agentConnections.create", { name: "Desk", client: "claude-code" });
  const call = await session(agent, made.token as string);
  const { a, b } = await twoPrompts(agent, call);
  await expect(shapeOnScreen(page, `shape:${a}`)).toBeVisible();
  await expect(shapeOnScreen(page, `shape:${b}`)).toBeVisible();

  await shapeOnScreen(page, `shape:${a}`).click();
  await expect.poll(async () => (await call("canvas_read", { project: "default" })).selection).toEqual([a]);

  const second = await page.context().newPage();
  await openCanvas(second, agent, "default");
  await shapeOnScreen(second, `shape:${b}`).click();
  await expect.poll(async () => (await call("canvas_read", { project: "default" })).selection).toEqual([b]);

  await second.close();
  await expect.poll(async () => (await call("canvas_read", { project: "default" })).selection).toEqual([a]);
});

test("canvas_select sets the window's selection, and the window's report comes back as the answer", async ({ page, agent }) => {
  await openCanvas(page, agent, "default");
  const rpc = await agent.rpc();
  const made = await rpc.call("agentConnections.create", { name: "Desk", client: "claude-code" });
  const call = await session(agent, made.token as string);
  const { a, b } = await twoPrompts(agent, call);
  await expect(shapeOnScreen(page, `shape:${a}`)).toBeVisible();

  await shapeOnScreen(page, `shape:${a}`).click();
  await expect.poll(async () => (await call("canvas_read", { project: "default" })).selection).toEqual([a]);

  const answered = await call("canvas_select", { project: "default", shapeIds: [b, "not-a-shape"] });
  expect(answered).toEqual({ selection: [b], missing: ["not-a-shape"] });
  await expect(shapeOnScreen(page, `shape:${b}`)).toBeVisible();
  await expect.poll(async () => (await call("canvas_read", { project: "default" })).selection).toEqual([b]);
});
