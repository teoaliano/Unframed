import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

const tabs = (page: Page) => page.locator("[role=tab]");
const tab = (page: Page, name: string) => page.locator(`[role=tab][data-project="${name}"]`);
const item = (page: Page, name: string) => page.locator(`[data-tab-item="${name}"]`);
const active = (page: Page) => page.locator("[role=tab][data-active='true']");

const openTabs = async (page: Page, engine: TestEngine, names: ReadonlyArray<string>) => {
  await openCanvas(page, engine, "default");
  for (const name of names) {
    await (await engine.rpc()).call("projects.create", { name });
    await page.getByRole("button", { name: "All projects" }).click();
    await page.getByRole("menuitemradio", { name }).click();
    await expect(active(page)).toHaveText(name);
  }
};

const savedTabs = async (engine: TestEngine) => (await (await engine.rpc()).call("preferences.get", { keys: ["project.tabs"] })).values["project.tabs"];

const translateX = (page: Page, name: string) =>
  item(page, name).evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform === "none" ? undefined : getComputedStyle(element).transform).m41);

test("a dragged tab follows the pointer while the others slide aside, and it lands where it was dropped", async ({ page, engine }) => {
  await openTabs(page, engine, ["beta", "gamma"]);
  await expect(tabs(page)).toHaveText(["default", "beta", "gamma"]);
  const from = (await tab(page, "gamma").boundingBox())!;
  const target = (await tab(page, "default").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 - 2, from.y + from.height / 2);
  await expect(item(page, "gamma")).not.toHaveAttribute("data-dragging");
  const to = target.x + target.width / 2 + from.width / 2 - 10;
  await page.mouse.move(to, from.y + from.height / 2, { steps: 8 });
  await expect(item(page, "gamma")).toHaveAttribute("data-dragging", "");
  expect(await translateX(page, "gamma")).toBeCloseTo(to - (from.x + from.width / 2), 0);
  await expect.poll(() => translateX(page, "default")).toBeGreaterThan(20);
  await expect.poll(() => translateX(page, "beta")).toBeGreaterThan(20);
  await expect(tabs(page)).toHaveText(["default", "beta", "gamma"]);
  await page.mouse.up();
  await expect(tabs(page)).toHaveText(["gamma", "default", "beta"]);
  await expect(item(page, "gamma")).not.toHaveAttribute("data-dragging");
  await expect(active(page)).toHaveText("gamma");
  await expect.poll(() => savedTabs(engine)).toEqual(expect.objectContaining({ order: ["gamma", "default", "beta"] }));
});

test("Escape during a drag puts the tabs back, and a press without movement still activates the tab", async ({ page, engine }) => {
  await openTabs(page, engine, ["beta"]);
  const from = (await tab(page, "beta").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x - 40, from.y + from.height / 2, { steps: 6 });
  await expect(item(page, "beta")).toHaveAttribute("data-dragging", "");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(tabs(page)).toHaveText(["default", "beta"]);
  await expect(active(page)).toHaveText("beta");
  await tab(page, "default").click();
  await expect(active(page)).toHaveText("default");
});

test("Alt+ArrowLeft and Alt+ArrowRight move the focused tab", async ({ page, engine }) => {
  await openTabs(page, engine, ["beta", "gamma"]);
  await tab(page, "gamma").focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(tabs(page)).toHaveText(["default", "gamma", "beta"]);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(tabs(page)).toHaveText(["default", "beta", "gamma"]);
});

test("a pinned tab sits first, shows only its mark with no close button, survives Cmd+W, and comes back pinned after a reload", async ({ page, engine }) => {
  await openTabs(page, engine, ["beta", "gamma"]);
  await tab(page, "gamma").click({ button: "right" });
  const menu = page.getByTestId("tab-menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Pin tab", "Close", "Close all tabs", "Rename project", "Delete project"]);
  await menu.getByRole("menuitem", { name: "Pin tab" }).click();

  await expect(tabs(page)).toHaveText(["", "default", "beta"]);
  const pinned = tab(page, "gamma");
  await expect(pinned).toHaveAttribute("data-pinned", "true");
  await expect(pinned).toHaveAccessibleName("gamma");
  await expect(pinned).toHaveAttribute("title", "gamma");
  await expect(pinned.locator("[data-slot=top-bar-mark]")).toHaveAttribute("data-letter", "G");
  await expect(page.getByRole("button", { name: "Close gamma" })).toHaveCount(0);
  expect((await pinned.boundingBox())!.width).toBeLessThan(40);

  await pinned.click();
  await expect(active(page)).toHaveAttribute("data-project", "gamma");
  await page.locator("body").click({ position: { x: 5, y: 500 } });
  await page.keyboard.press("ControlOrMeta+w");
  await expect(tabs(page)).toHaveCount(3);
  await expect(active(page)).toHaveAttribute("data-project", "gamma");

  await expect.poll(() => savedTabs(engine)).toEqual(expect.objectContaining({ order: ["gamma", "default", "beta"], pinned: ["gamma"] }));
  await page.reload();
  await expect(page.locator("[data-canvas-project='gamma'] .tl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(tab(page, "gamma")).toHaveAttribute("data-pinned", "true");

  await tab(page, "gamma").click({ button: "right" });
  await page.getByTestId("tab-menu").getByRole("menuitem", { name: "Unpin tab" }).click();
  await expect(tabs(page)).toHaveText(["gamma", "default", "beta"]);
  await expect(tab(page, "gamma")).not.toHaveAttribute("data-pinned");
  await expect.poll(() => savedTabs(engine)).toEqual(expect.objectContaining({ pinned: [] }));
});

test("an unpinned tab cannot be dragged in front of a pinned one, and Alt+ArrowLeft stops at the pins", async ({ page, engine }) => {
  await openTabs(page, engine, ["beta"]);
  await tab(page, "beta").click({ button: "right" });
  await page.getByTestId("tab-menu").getByRole("menuitem", { name: "Pin tab" }).click();
  await expect(tab(page, "beta")).toHaveAttribute("data-pinned", "true");
  await (await engine.rpc()).call("projects.create", { name: "gamma" });
  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name: "gamma" }).click();
  await expect(page.locator("[role=tab]:not([data-pinned])")).toHaveText(["default", "gamma"]);

  const from = (await tab(page, "gamma").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(2, from.y + from.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("[role=tab]:not([data-pinned])")).toHaveText(["gamma", "default"]);
  expect(await page.locator("[role=tab]").first().getAttribute("data-project")).toBe("beta");

  await tab(page, "gamma").focus();
  await page.keyboard.press("Alt+ArrowLeft");
  expect(await page.locator("[role=tab]").first().getAttribute("data-project")).toBe("beta");
});
