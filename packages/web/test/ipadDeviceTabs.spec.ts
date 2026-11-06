import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { deviceCanvas, IPAD_DOTENV, openDevice, testIpad, type DeviceClient } from "./ipad.ts";
import { KEY, startSettingsEngine } from "./settings.ts";

const tabs = (page: Page) => page.locator("[role=tab]");
const active = (page: Page) => page.locator("[role=tab][data-active='true']");

const openInTab = async (page: Page, engine: TestEngine, name: string) => {
  await (await engine.rpc()).call("projects.create", { name });
  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name }).click();
  await expect(active(page)).toHaveText(name);
};

const macTabs = async (engine: TestEngine): Promise<unknown> =>
  (await (await engine.rpc()).call("preferences.get", { keys: ["project.tabs"] })).values["project.tabs"];

const ipadEngine = () => startSettingsEngine({ env: testIpad(), dotenv: `OPENROUTER_API_KEY=${KEY}\n${IPAD_DOTENV}` });

test("the device follows the Mac's tab, detaches on its own choice, and returns on the Mac's next switch", async ({ page }) => {
  const { engine } = await ipadEngine();
  let device: DeviceClient | undefined;
  try {
    await openCanvas(page, engine, "default");
    await openInTab(page, engine, "beta");
    device = await openDevice(engine, "beta");
    await expect(tabs(device.page)).toHaveText(["default", "beta"]);
    await expect(active(device.page)).toHaveText("beta");

    await tabs(device.page).filter({ hasText: "default" }).click();
    await expect(active(device.page)).toHaveText("default");
    await deviceCanvas(device.page, "default");
    await expect(active(page)).toHaveText("beta");
    expect(await macTabs(engine)).toEqual({ order: ["default", "beta"], active: "beta" });

    await tabs(page).filter({ hasText: "default" }).click();
    await expect(active(page)).toHaveText("default");
    await expect(active(device.page)).toHaveText("default");

    await tabs(page).filter({ hasText: "beta" }).click();
    await expect(active(device.page)).toHaveText("beta");
    await deviceCanvas(device.page, "beta");
    expect(await macTabs(engine)).toEqual({ order: ["default", "beta"], active: "beta" });
  } finally {
    await device?.close();
    await engine.dispose();
  }
});

test("a change to the Mac's tabs that leaves its active tab alone does not take the device back", async ({ page }) => {
  const { engine } = await ipadEngine();
  let device: DeviceClient | undefined;
  try {
    await openCanvas(page, engine, "default");
    await openInTab(page, engine, "beta");
    device = await openDevice(engine, "beta");

    await tabs(device.page).filter({ hasText: "default" }).click();
    await expect(active(device.page)).toHaveText("default");

    await (await engine.rpc()).call("preferences.set", { key: "project.tabs", value: { order: ["beta", "default"], active: "beta" } });
    await expect(tabs(device.page)).toHaveText(["beta", "default"]);
    await expect(active(device.page)).toHaveText("default");
  } finally {
    await device?.close();
    await engine.dispose();
  }
});

test("a project the Mac has not opened is one extra tab on the device alone", async ({ page }) => {
  const { engine } = await ipadEngine();
  let device: DeviceClient | undefined;
  try {
    await openCanvas(page, engine, "default");
    await (await engine.rpc()).call("projects.create", { name: "gamma" });
    device = await openDevice(engine, "default");
    await expect(tabs(device.page)).toHaveText(["default"]);

    await device.page.getByRole("button", { name: "All projects" }).click();
    await device.page.getByRole("menuitemradio", { name: "gamma" }).click();
    await expect(tabs(device.page)).toHaveText(["default", "gamma"]);
    await expect(active(device.page)).toHaveText("gamma");
    await deviceCanvas(device.page, "gamma");

    await expect(tabs(page)).toHaveText(["default"]);
    expect(await macTabs(engine)).toEqual({ order: ["default"], active: "default" });
  } finally {
    await device?.close();
    await engine.dispose();
  }
});

test("the device's strip has no close button and no tab menu, and keeps Add project", async ({ page }) => {
  const { engine } = await ipadEngine();
  let device: DeviceClient | undefined;
  try {
    await openCanvas(page, engine, "default");
    device = await openDevice(engine, "default");
    await expect(page.getByRole("button", { name: "Close default" })).toBeVisible();
    await expect(device.page.getByRole("button", { name: "Close default" })).toHaveCount(0);
    await expect(device.page.getByTestId("all-projects")).toBeVisible();

    await tabs(device.page).first().click({ button: "right" });
    await expect(device.page.getByTestId("tab-menu")).toHaveCount(0);
    await tabs(page).first().click({ button: "right" });
    await expect(page.getByTestId("tab-menu")).toBeVisible();
    await page.keyboard.press("Escape");

    await device.page.getByTestId("all-projects").getByRole("button").click();
    await expect(device.page.getByRole("menuitem", { name: "Add project" })).toBeVisible();
    await device.page.keyboard.press("Escape");

    await openInTab(page, engine, "beta");
    await expect(tabs(device.page)).toHaveText(["default", "beta"]);
    await device.page.locator("body").click({ position: { x: 5, y: 500 } });
    await device.page.keyboard.press("ControlOrMeta+w");
    await device.page.waitForTimeout(500);
    await expect(tabs(device.page)).toHaveText(["default", "beta"]);
    expect(await macTabs(engine)).toEqual({ order: ["default", "beta"], active: "beta" });
  } finally {
    await device?.close();
    await engine.dispose();
  }
});
