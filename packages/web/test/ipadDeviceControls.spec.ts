import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { IPAD_DOTENV, openDevice, testIpad, type DeviceClient } from "./ipad.ts";
import { pngBytes } from "./images.ts";
import { filledMedia } from "./media.ts";
import { KEY, openSettings, showSection, startSettingsEngine } from "./settings.ts";

const menuItems = async (page: Page, at: { x: number; y: number }): Promise<string[]> => {
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(100);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.waitForTimeout(200);
  return page
    .getByTestId("context-menu")
    .locator(":scope > * [role='menuitem'], :scope > [role='menuitem']")
    .evaluateAll((elements) => elements.map((element) => element.querySelector(".tlui-button__label")?.textContent ?? element.textContent ?? ""));
};

test("the settings controls only the Mac can run are absent on a device, and present on the Mac", async ({ page }) => {
  const { engine } = await startSettingsEngine({ env: testIpad(), dotenv: `OPENROUTER_API_KEY=${KEY}\n${IPAD_DOTENV}` });
  let device: DeviceClient | undefined;
  try {
    await openCanvas(page, engine);
    await (await engine.rpc()).call("agentConnections.create", { name: "Desk", client: "claude-code" });
    device = await openDevice(engine);

    const mac = await openSettings(page);
    await showSection(mac, "General");
    await expect(mac.getByRole("button", { name: /^Browse/ })).toBeVisible();
    await showSection(mac, "iPad");
    await expect(mac.getByTestId("ipad-section")).toBeVisible();
    await showSection(mac, "Connections");
    await expect(mac.getByRole("button", { name: "Connect an agent" })).toBeVisible();
    await expect(mac.getByTestId("outside-connection").getByRole("button", { name: "Revoke" })).toBeVisible();

    const onDevice = await openSettings(device.page);
    await expect(onDevice.getByRole("tab", { name: "iPad" })).toHaveCount(0);
    await showSection(onDevice, "General");
    await expect(onDevice.getByRole("heading", { name: "Output folder" })).toBeVisible();
    await expect(onDevice.getByRole("button", { name: /^Browse/ })).toHaveCount(0);
    await showSection(onDevice, "Connections");
    await expect(onDevice.getByTestId("outside-connection")).toBeVisible();
    await expect(onDevice.getByTestId("ipad-section")).toHaveCount(0);
    await expect(onDevice.getByRole("button", { name: "Connect an agent" })).toHaveCount(0);
    await expect(onDevice.getByRole("button", { name: "Revoke" })).toHaveCount(0);
    await expect(onDevice.getByRole("button", { name: "Limit" })).toBeVisible();
  } finally {
    await device?.close();
    await engine.dispose();
  }
});

test("a device's right-click menu on an image offers no Reveal and no Copy path", async ({ page }) => {
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
    await expect(shapeOnScreen(page, "shape:pic")).toBeVisible();
    device = await openDevice(engine, project);
    await expect(shapeOnScreen(device.page, "shape:pic")).toBeVisible({ timeout: 20_000 });

    const onMac = await menuItems(page, await centre(shapeOnScreen(page, "shape:pic")));
    expect(onMac).toContain("Copy path");
    expect(onMac.some((item) => /^(Reveal in Finder|Show in Explorer|Show in folder)/.test(item))).toBe(true);

    const onDevice = await menuItems(device.page, await centre(shapeOnScreen(device.page, "shape:pic")));
    expect(onDevice).not.toContain("Copy path");
    expect(onDevice.some((item) => /^(Reveal in Finder|Show in Explorer|Show in folder)/.test(item))).toBe(false);
    expect(onDevice).toContain("Copy as image");
  } finally {
    await device?.close();
    await engine.dispose();
  }
});

test("a keyless device is offered the paste field but not Connect OpenRouter", async ({ page }) => {
  const { engine } = await startSettingsEngine({ key: false, env: testIpad(), dotenv: IPAD_DOTENV });
  let device: DeviceClient | undefined;
  try {
    await openCanvas(page, engine);
    device = await openDevice(engine);
    const dialog = await openSettings(device.page);
    await expect(dialog.getByRole("button", { name: "Connect OpenRouter" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "or paste a key instead" }).click();
    await expect(dialog.getByLabel("API key", { exact: true })).toBeVisible();
    await expect((await openSettings(page)).getByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
  } finally {
    await device?.close();
    await engine.dispose();
  }
});
