import { rm } from "node:fs/promises";
import { makeTempDir } from "../../engine/test/engineProcess.ts";
import { openCanvas, roomShapes, shapeOnScreen, toast } from "./canvas.ts";
import { expect, FIXTURE_KEY, startHostedEngine, test } from "./fixtures.ts";
import { deviceCanvas, IPAD_DOTENV, ipadPort, openDevice, penStroke, testIpad, type DeviceClient } from "./ipad.ts";

const LOST = "Lost the connection to the local server. Reconnecting…";
const DOTENV = `OPENROUTER_API_KEY=${FIXTURE_KEY}\n${IPAD_DOTENV}`;

test("a device says the connection is lost when the engine stops, and clears it when the engine comes back", async ({ page }) => {
  const dataDir = await makeTempDir();
  const first = await startHostedEngine({ dataDir, dotenv: DOTENV, env: testIpad() });
  let device: DeviceClient | undefined;
  let second: Awaited<ReturnType<typeof startHostedEngine>> | undefined;
  try {
    await openCanvas(page, first, "default");
    device = await openDevice(first, "default");
    const starter = "shape:starter-scene";
    await expect(shapeOnScreen(device.page, starter)).toBeVisible({ timeout: 20_000 });
    const apiPort = first.port;
    const listenerPort = await ipadPort(first);
    await expect(toast(device.page, LOST)).toHaveCount(0);

    await first.stop();
    await expect(toast(device.page, LOST)).toBeVisible({ timeout: 20_000 });

    second = await startHostedEngine({
      dataDir,
      dotenv: DOTENV,
      env: { ...testIpad({ IPAD_PORT: String(listenerPort) }), PORT: String(apiPort) },
    });
    await expect(toast(device.page, LOST)).toHaveCount(0, { timeout: 40_000 });
    await deviceCanvas(device.page, "default");

    await device.page.keyboard.press("d");
    await penStroke(device.page, { x: 420, y: 320 }, { x: 640, y: 440 });
    await expect.poll(async () => (await roomShapes(second!, "default", "draw")).length, { timeout: 20_000 }).toBe(1);
  } finally {
    await device?.close();
    await second?.dispose();
    await first.dispose();
    await rm(dataDir, { recursive: true, force: true });
  }
});
