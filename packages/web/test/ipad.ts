import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { TEST_NAME } from "../../engine/test/ipadClient.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { test } from "./fixtures.ts";

export { TEST_NAME };

export const IPAD_AGENT =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export const testIpad = (extra: Record<string, string> = {}): Record<string, string> => ({
  UNFRAMED_TEST_IPAD: TEST_NAME,
  IPAD_PORT: "0",
  ...extra,
});

export const IPAD_DOTENV = "IPAD_ACCESS=on\n";

export const ipadPort = async (engine: TestEngine): Promise<number> => {
  const status = await (await engine.rpc()).call("ipad.status");
  if (!status.listening) throw new Error("the iPad listener is not up");
  return status.port;
};

export interface DeviceClient {
  readonly browser: Browser;
  readonly page: Page;
  close(): Promise<void>;
}

export const openDevice = async (engine: TestEngine, project?: string): Promise<DeviceClient> => {
  const port = await ipadPort(engine);
  const started = await (await engine.rpc()).call("ipad.pairStart");
  const use = test.info().project.use;
  const launchOptions = use.launchOptions ?? {};
  const browser = await chromium.launch({
    ...launchOptions,
    ...(use.channel === undefined ? {} : { channel: use.channel }),
    headless: true,
    args: [...(launchOptions.args ?? []), `--host-resolver-rules=MAP ${TEST_NAME} 127.0.0.1`],
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    hasTouch: true,
    viewport: { width: 1180, height: 820 },
    userAgent: IPAD_AGENT,
  });
  const page = await context.newPage();
  await page.goto(`https://${TEST_NAME}:${port}/`);
  await expect(page.getByRole("heading", { name: "Pair with Unframed" })).toBeVisible();
  await page.getByLabel("Pairing code").fill(started.code);
  await page.getByRole("button", { name: "Pair" }).click();
  await deviceCanvas(page, project);
  return { browser, page, close: () => browser.close() };
};

export const deviceCanvas = async (page: Page, project?: string): Promise<void> => {
  const host = project === undefined ? page.locator("[data-canvas-project]") : page.locator(`[data-canvas-project="${project}"]`);
  await expect(host.locator(".tl-canvas")).toBeVisible({ timeout: 30_000 });
};

export const penStroke = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
  const cdp = await page.context().newCDPSession(page);
  const event = (type: "mousePressed" | "mouseMoved" | "mouseReleased", at: { x: number; y: number }, buttons: number) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x: at.x,
      y: at.y,
      button: buttons === 1 ? "left" : "none",
      buttons,
      clickCount: 1,
      pointerType: "pen",
      force: 0.6,
    });
  await event("mousePressed", from, 1);
  for (let step = 1; step <= 6; step += 1) {
    await event("mouseMoved", { x: from.x + ((to.x - from.x) * step) / 6, y: from.y + ((to.y - from.y) * step) / 6 }, 1);
  }
  await event("mouseReleased", to, 0);
  await cdp.detach();
};
