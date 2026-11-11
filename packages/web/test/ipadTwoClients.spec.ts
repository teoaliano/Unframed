import type { Locator } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { createChat, expect, openRail, openSheetRail, say, startAgentEngine, test } from "./agent.ts";
import { clickShape } from "./generation.ts";
import { FIXTURE_KEY } from "./fixtures.ts";
import { IPAD_DOTENV, openDevice, testIpad, type DeviceClient } from "./ipad.ts";

const SLOW = { timeout: 15_000 };

const reply = (panel: Locator) => panel.locator("[data-role='assistant']");

const ipadAgentEngine = () => startAgentEngine({ env: testIpad(), dotenv: `OPENROUTER_API_KEY=${FIXTURE_KEY}\n${IPAD_DOTENV}` });

const rpcBody = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id, method, params });

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
      .then((item) => JSON.parse(item.json().result.content.at(-1).text) as Record<string, any>);
};

test("an approval answered on the device closes on the Mac and lets the turn finish", async ({ page }) => {
  const engine = await ipadAgentEngine();
  let device: DeviceClient | undefined;
  try {
    await openCanvas(page, engine, "default");
    device = await openDevice(engine, "default");
    await createChat(engine, { runtimeMode: "approval-required", title: "Cleanup" });

    const mac = await openRail(page);
    const onDevice = await openSheetRail(device.page);
    await say(mac, "clean the build please");
    await expect(mac.getByTestId("approval-panel")).toBeVisible(SLOW);
    await expect(onDevice.getByTestId("approval-panel")).toBeVisible(SLOW);

    await onDevice.getByTestId("approval-panel").getByRole("button", { name: "Approve" }).click();
    await expect(onDevice.getByTestId("approval-panel")).toHaveCount(0);
    await expect(mac.getByTestId("approval-panel")).toHaveCount(0, SLOW);
    await expect(reply(mac).last()).toContainText("Removed the build folder.", SLOW);
    await expect(reply(onDevice).last()).toContainText("Removed the build folder.", SLOW);
  } finally {
    await device?.close();
    await engine.dispose();
  }
});

test("the live selection follows the device when it selects last, and the Mac again when the device goes", async ({ page }) => {
  const engine = await ipadAgentEngine();
  let device: DeviceClient | undefined;
  try {
    await openCanvas(page, engine, "default");
    const made = await (await engine.rpc()).call("agentConnections.create", { name: "Desk", client: "claude-code" });
    const call = await session(engine, made.token as string);
    const written = await call("canvas_write", {
      project: "default",
      ops: [
        { type: "create", id: "new:a", kind: "prompt", x: 0, y: 0, props: { text: "first" } },
        { type: "create", id: "new:b", kind: "prompt", x: 400, y: 0, props: { text: "second" } },
      ],
    });
    const ids = written.ids as Record<string, string>;
    const a = ids["new:a"]!;
    const b = ids["new:b"]!;
    await expect(shapeOnScreen(page, `shape:${a}`)).toBeVisible();

    await clickShape(page, `shape:${a}`);
    await expect.poll(async () => (await call("canvas_read", { project: "default" })).selection, SLOW).toEqual([a]);

    device = await openDevice(engine, "default");
    await expect(shapeOnScreen(device.page, `shape:${b}`)).toBeVisible(SLOW);
    await clickShape(device.page, `shape:${b}`);
    await expect(device.page.locator(`[data-shape-id="shape:${b}"]`)).toBeVisible();
    await expect.poll(async () => (await call("canvas_read", { project: "default" })).selection, SLOW).toEqual([b]);

    for (let step = 0; step < 12; step += 1) await page.mouse.move(300 + step * 10, 300 + step * 5);
    await page.waitForTimeout(1200);
    expect((await call("canvas_read", { project: "default" })).selection).toEqual([b]);

    await device.close();
    device = undefined;
    await expect.poll(async () => (await call("canvas_read", { project: "default" })).selection, SLOW).toEqual([a]);
  } finally {
    await device?.close();
    await engine.dispose();
  }
});
