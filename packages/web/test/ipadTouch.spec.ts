import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { IPAD_DOTENV, openDevice, testIpad, touchHold, type DeviceClient } from "./ipad.ts";
import { pngBytes } from "./images.ts";
import { filledMedia } from "./media.ts";
import { KEY, startSettingsEngine } from "./settings.ts";
import { openRail, promptBox, scriptFolder, startAgentEngine } from "./agent.ts";
import { FIXTURE_KEY } from "./fixtures.ts";

const say = async (page: Page, rail: Locator): Promise<void> => {
  await promptBox(rail).click();
  await page.keyboard.type("say hello");
  await page.keyboard.press("Enter");
  await expect(rail.locator("[data-role='assistant']")).toHaveCount(1);
};

const actionOpacity = async (rail: Locator): Promise<string> => {
  const action = rail.locator("[data-role='user']").last().getByRole("button", { name: "Edit from here" });
  await expect(action).toBeAttached();
  return action.evaluate((element) => getComputedStyle(element.parentElement as HTMLElement).opacity);
};

const menuLabels = async (page: Page): Promise<string[]> =>
  page
    .getByTestId("context-menu")
    .locator(":scope > * [role='menuitem'], :scope > [role='menuitem']")
    .evaluateAll((elements) => elements.map((element) => element.querySelector(".tlui-button__label")?.textContent ?? element.textContent ?? ""));

test("a long press on the device opens the right-click menu, and a tap does not", async ({ page }) => {
  const { engine } = await startSettingsEngine({ env: testIpad(), dotenv: `OPENROUTER_API_KEY=${KEY}\n${IPAD_DOTENV}` });
  let device: DeviceClient | undefined;
  try {
    const project = await openCanvas(page, engine);
    await filledMedia(engine, {
      id: "shape:pic",
      type: "image",
      ref: "pic",
      at: { x: 0, y: 0 },
      bytes: pngBytes(40, 30),
      name: "pic.png",
      mime: "image/png",
      natural: { w: 40, h: 30 },
      project,
    });
    device = await openDevice(engine, project);
    const shape = shapeOnScreen(device.page, "shape:pic");
    await expect(shape).toBeVisible({ timeout: 20_000 });
    const at = await centre(shape);

    await touchHold(device.page, at, 150);
    await device.page.waitForTimeout(600);
    await expect(device.page.getByTestId("context-menu")).toHaveCount(0);

    await touchHold(device.page, at, 560);
    await expect(device.page.getByTestId("context-menu")).toBeVisible();
    expect(await menuLabels(device.page)).toContain("Copy as image");
  } finally {
    await device?.close();
    await engine.dispose();
  }
});

test("a control that waits for a hover on the Mac is already there on the device", async ({ page }) => {
  const engine = await startAgentEngine({
    script: await scriptFolder({ hello: { when: ".", turns: [{ text: "Hello back." }] } }),
    env: testIpad(),
    dotenv: `OPENROUTER_API_KEY=${FIXTURE_KEY}\n${IPAD_DOTENV}`,
  });
  let device: DeviceClient | undefined;
  try {
    await openCanvas(page, engine);
    device = await openDevice(engine);

    const onMac = await openRail(page);
    await say(page, onMac);
    expect(await actionOpacity(onMac)).toBe("0");

    const onDevice = await openRail(device.page);
    await say(device.page, onDevice);
    expect(await actionOpacity(onDevice)).toBe("1");
  } finally {
    await device?.close();
    await engine.dispose();
  }
});
