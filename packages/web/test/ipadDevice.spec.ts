import { chromium, type Browser, type Page } from "@playwright/test";
import { TEST_NAME } from "../../engine/test/ipadClient.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, instructionBox, openComposer, pressSend, startGeneration, test } from "./generation.ts";

const IPAD_AGENT =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const ipadPort = async (engine: TestEngine): Promise<number> => {
  const status = await (await engine.rpc()).call("ipad.status");
  if (!status.listening) throw new Error("the iPad listener is not up");
  return status.port;
};

const openDevice = async (port: number, code: string): Promise<{ browser: Browser; page: Page }> => {
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
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible({ timeout: 30_000 });
  return { browser, page };
};

const penStroke = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
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

test("a paired iPad draws with the Pencil onto the Mac's canvas, and a result from the Mac lands on it", async ({ page }) => {
  const generation = await startGeneration({
    env: { UNFRAMED_TEST_IPAD: TEST_NAME, IPAD_PORT: "0" },
    dotenv: "OPENROUTER_API_KEY=sk-or-v1-browser-test-0000\nIPAD_ACCESS=on\n",
  });
  const { engine } = generation;
  let device: { browser: Browser; page: Page } | undefined;
  try {
    const project = await openCanvas(page, engine);
    const port = await ipadPort(engine);
    const started = await (await engine.rpc()).call("ipad.pairStart");
    device = await openDevice(port, started.code);
    expect((await (await engine.rpc()).call("ipad.devices")).devices).toHaveLength(1);

    await device.page.keyboard.press("d");
    await penStroke(device.page, { x: 420, y: 320 }, { x: 640, y: 440 });

    const drawn = await expect
      .poll(async () => (await roomShapes(engine, project, "draw")).at(0)?.id, { timeout: 20_000 })
      .toBeTruthy()
      .then(async () => (await roomShapes(engine, project, "draw"))[0]!);
    await expect(shapeOnScreen(page, drawn.id)).toBeVisible({ timeout: 20_000 });

    await page.mouse.click(200, 200);
    await page.keyboard.press("t");
    await page.mouse.click(200, 200);
    await page.keyboard.type("a lone red fox");
    await page.keyboard.press("Escape");
    await openComposer(page);
    await instructionBox(page).fill("paint it");
    await pressSend(page);

    const image = await expect
      .poll(async () => (await roomShapes(engine, project, "image")).find((shape) => shape.props.assetId)?.id, { timeout: 30_000 })
      .toBeTruthy()
      .then(async () => (await roomShapes(engine, project, "image")).find((shape) => shape.props.assetId)!);
    await expect(shapeOnScreen(device.page, image.id)).toBeVisible({ timeout: 20_000 });
  } finally {
    await device?.browser.close();
    await engine.dispose();
  }
});
