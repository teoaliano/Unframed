import { expect, test } from "./fixtures.ts";
import { openCanvas } from "./canvas.ts";
import { platformOf } from "./platform.ts";

const tabs = (page: import("@playwright/test").Page) => page.locator("[role=tab]");
const active = (page: import("@playwright/test").Page) => page.locator("[role=tab][data-active='true']");

/** Opens a project in a new tab through the engine, then the page activates it through the list. */
const openInTab = async (page: import("@playwright/test").Page, engine: import("../../engine/test/engineProcess.ts").TestEngine, name: string) => {
  await (await engine.rpc()).call("projects.create", { name });
  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name }).click();
  await expect(active(page)).toHaveText(name);
};

test("the strip opens projects as tabs; the active tab is the canvas on screen; a background tab leaves it alone", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await expect(tabs(page)).toHaveText(["default"]);
  await openInTab(page, engine, "beta");
  await expect(tabs(page)).toHaveText(["default", "beta"]);
  await expect(page.locator("[data-canvas-project]")).toHaveCount(1);
  await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible();
});

test("Ctrl+Tab cycles the tabs; Cmd+1 and Cmd+9 jump to a tab and to the last", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await openInTab(page, engine, "beta");
  await openInTab(page, engine, "gamma");
  await page.locator("body").click({ position: { x: 5, y: 500 } });
  await page.keyboard.press("Control+Tab");
  await expect(active(page)).toHaveText("default");
  await page.keyboard.press("Control+Shift+Tab");
  await expect(active(page)).toHaveText("gamma");
  await page.keyboard.press("ControlOrMeta+1");
  await expect(active(page)).toHaveText("default");
  await page.keyboard.press("ControlOrMeta+9");
  await expect(active(page)).toHaveText("gamma");
});

test("Cmd+W closes the active tab onto its neighbour, and Cmd+Shift+T reopens it", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await openInTab(page, engine, "beta");
  await openInTab(page, engine, "gamma");
  await page.locator("body").click({ position: { x: 5, y: 500 } });
  await page.keyboard.press("ControlOrMeta+1");
  await page.keyboard.press("ControlOrMeta+2");
  await expect(active(page)).toHaveText("beta");
  await page.keyboard.press("ControlOrMeta+w");
  await expect(tabs(page)).toHaveText(["default", "gamma"]);
  await expect(active(page)).toHaveText("gamma");
  await page.keyboard.press("ControlOrMeta+Shift+t");
  await expect(tabs(page)).toHaveText(["default", "gamma", "beta"]);
  await expect(active(page)).toHaveText("beta");
});

test("closing the last tab shows the start state, and the window stays open; Open project opens the list", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await page.getByRole("button", { name: "Close default" }).click();
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.locator("[data-canvas-project]")).toHaveCount(0);
  await expect(page.getByText("No project is open.")).toBeVisible();
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(page.getByRole("menuitemradio", { name: "default" })).toBeVisible();
});

test("Settings sits at the far right on macOS and Linux and at the far left on Windows", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  const os = await platformOf(page);
  const settings = page.getByRole("button", { name: /^(Settings|Add your API key)$/ });
  const box = (await settings.boundingBox())!;
  const viewport = page.viewportSize()!;
  if (os.name === "win32") expect(box.x).toBeLessThan(viewport.width / 2);
  else expect(box.x).toBeGreaterThan(viewport.width / 2);
});

test("the strip is the kit's underline tabs: the active tab carries the indicator and the foreground colour", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await openInTab(page, engine, "beta");
  const list = page.locator("[data-slot=tabs-list][data-variant=underline]");
  await expect(list).toHaveCount(1);
  await expect(page.locator("[data-slot=tabs-indicator]")).toHaveCount(1);
  const tab = active(page);
  await expect(tab).toHaveAttribute("data-slot", "tabs-tab");
  const colour = await tab.evaluate((element) => getComputedStyle(element).color);
  const idle = await page.locator("[role=tab]:not([data-active='true'])").first().evaluate((element) => getComputedStyle(element).color);
  expect(colour).not.toBe(idle);
});

test("the open tabs and their order come back after a reload, with the same one active", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await openInTab(page, engine, "beta");
  await openInTab(page, engine, "gamma");
  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name: "beta" }).click();
  await expect(active(page)).toHaveText("beta");
  // The tab order is saved in the background; wait until the engine holds it before the page reloads.
  await expect.poll(async () => (await (await engine.rpc()).call("preferences.get", { keys: ["project.tabs"] })).values["project.tabs"]).toEqual(expect.objectContaining({ order: ["default", "beta", "gamma"], active: "beta" }));
  await page.reload();
  await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(tabs(page)).toHaveText(["default", "beta", "gamma"]);
  await expect(active(page)).toHaveText("beta");
});
