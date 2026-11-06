import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, instructionBox, openComposer, pressSend, startGeneration, test } from "./generation.ts";
import { IPAD_DOTENV, openDevice, penStroke, testIpad, type DeviceClient } from "./ipad.ts";
import { KEY, startSettingsEngine } from "./settings.ts";

test("a paired iPad draws with the Pencil onto the Mac's canvas, and a result from the Mac lands on it", async ({ page }) => {
  const generation = await startGeneration({
    env: testIpad(),
    dotenv: "OPENROUTER_API_KEY=sk-or-v1-browser-test-0000\nIPAD_ACCESS=on\n",
  });
  const { engine } = generation;
  let device: DeviceClient | undefined;
  try {
    const project = await openCanvas(page, engine);
    device = await openDevice(engine);
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
    await device?.close();
    await engine.dispose();
  }
});

test("the device pans its own view and leaves the Mac's where it was", async ({ page }) => {
  const { engine } = await startSettingsEngine({ env: testIpad(), dotenv: `OPENROUTER_API_KEY=${KEY}\n${IPAD_DOTENV}` });
  let device: DeviceClient | undefined;
  try {
    const project = await openCanvas(page, engine);
    const starter = "shape:starter-scene";
    await expect(shapeOnScreen(page, starter)).toBeVisible();
    device = await openDevice(engine, project);
    await expect(shapeOnScreen(device.page, starter)).toBeVisible({ timeout: 20_000 });

    const macBefore = await centre(shapeOnScreen(page, starter));
    const deviceBefore = await centre(shapeOnScreen(device.page, starter));

    await device.page.mouse.move(600, 400);
    await device.page.mouse.wheel(0, 240);
    await expect.poll(async () => Math.round((await centre(shapeOnScreen(device.page, starter))).y)).not.toBe(Math.round(deviceBefore.y));

    const macAfter = await centre(shapeOnScreen(page, starter));
    expect(Math.round(macAfter.x)).toBe(Math.round(macBefore.x));
    expect(Math.round(macAfter.y)).toBe(Math.round(macBefore.y));
  } finally {
    await device?.close();
    await engine.dispose();
  }
});
