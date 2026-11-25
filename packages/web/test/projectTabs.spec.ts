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

test("a switch still happens within its two-second cap when the window stops drawing frames, as a hidden or minimized window does", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await openInTab(page, engine, "beta");
  await page.getByRole("tab", { name: "default", exact: true }).click();
  await expect(page.locator("[data-canvas-project='default'] .tl-canvas")).toBeVisible();
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.getByRole("tab", { name: "beta", exact: true }).click();
  await expect(page.locator("[data-canvas-project='beta']")).toHaveCount(1, { timeout: 4000 });
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

test("Settings sits at the far right on macOS and Linux and on the left, after the logo, on Windows", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  const os = await platformOf(page);
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  const box = (await settings.boundingBox())!;
  const viewport = page.viewportSize()!;
  if (os.name === "win32") expect(box.x).toBeLessThan(viewport.width / 2);
  else expect(box.x).toBeGreaterThan(viewport.width / 2);
});

test("the strip is the bar's own project tabs: full height, a divider before and after each, the bar's bottom border under each, the active one on the accent fill, a 14 px close 8 px in, the plus 8 px after", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await openInTab(page, engine, "beta");
  await expect(page.locator("[data-slot=tabs-list], [data-slot=tabs-indicator]")).toHaveCount(0);
  const list = page.locator("[data-slot=project-tabs-list]");
  expect(await list.evaluate((element) => getComputedStyle(element).borderLeftWidth)).toBe("1px");
  const tab = active(page);
  await expect(tab).toHaveAttribute("data-slot", "project-tab");
  const idleTab = page.locator("[role=tab]:not([data-active='true'])").first();
  const look = (element: Element) => ({
    height: element.getBoundingClientRect().height,
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
    divider: getComputedStyle(element.parentElement!).borderRightWidth,
    bottom: getComputedStyle(element.parentElement!).borderBottomWidth,
    full: element.parentElement!.getBoundingClientRect().height,
    weight: getComputedStyle(element).fontWeight,
  });
  await expect.poll(() => idleTab.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  const [on, off] = [await tab.evaluate(look), await idleTab.evaluate(look)];
  const accent = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--project-tab-active-surface)";
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  });
  expect([on.full, off.full, on.height, off.height, on.divider, off.divider, on.bottom, off.bottom]).toEqual([36, 36, 35, 35, "1px", "1px", "1px", "1px"]);
  expect([on.weight, off.weight]).toEqual(["500", "400"]);
  expect(on.background).toBe(accent);
  expect(off.background).toBe("rgba(0, 0, 0, 0)");
  expect(on.color).not.toBe(off.color);
  const name = await tab.locator("span").first().boundingBox();
  const box = (await tab.boundingBox())!;
  expect(name!.x - box.x).toBe(8);
  const close = (await page.getByRole("button", { name: `Close ${await tab.textContent()}` }).boundingBox())!;
  expect([close.width, box.x + box.width - (close.x + close.width)]).toEqual([14, 8]);
  const glyph = await page.getByRole("button", { name: `Close ${await tab.textContent()}` }).locator("svg").evaluate((element) => ({
    size: element.getBoundingClientRect().width,
    stroke: getComputedStyle(element.querySelector("path")!).strokeWidth,
    effect: getComputedStyle(element.querySelector("path")!).vectorEffect,
  }));
  expect(glyph).toEqual({ size: 12, stroke: "1.3333px", effect: "non-scaling-stroke" });
  const plus = (await page.getByTestId("all-projects").getByRole("button").boundingBox())!;
  const strip = (await list.boundingBox())!;
  expect([plus.x - (strip.x + strip.width), plus.y]).toEqual([8, 6]);
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
