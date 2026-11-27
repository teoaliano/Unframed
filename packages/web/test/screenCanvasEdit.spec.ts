import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { prepareReactApp } from "../../engine/test/reactFixture.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const SHOWN_FRAME = '[data-screen-of][style*="visibility: visible"] iframe[data-screen-frame]';
const app = (page: Page) => page.frameLocator(SHOWN_FRAME);
const overlay = (page: Page) => page.getByTestId("design-overlay");
const hoverChip = (page: Page) => page.getByTestId("design-hover-chip");
const badge = (page: Page) => page.getByTestId("design-size-badge");
const panel = (page: Page) => page.getByTestId("screen-design-panel");

const openReact = async (page: Page, engine: TestEngine, project: string) => {
  const [first] = await screenShapes(engine, project);
  await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/react", w: 960, h: 600 } }]);
  await expect(page.locator(`[data-shape-id="${first.id}"] [data-testid=screen]`)).toHaveAttribute("data-route", "/react");
  await clickShape(page, first.id);
  await expect(page.locator(`[data-shape-id="${first.id}"] [data-testid=screen]`)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
  await expect(app(page).getByRole("heading", { name: "Agent" })).toBeVisible({ timeout: 30_000 });
  return first.id as string;
};

const pointIn = async (page: Page, selector: string, at: { readonly x: number; readonly y: number } = { x: 0.5, y: 0.5 }) => {
  const outer = await page.locator(SHOWN_FRAME).evaluate((frame) => {
    const rect = frame.getBoundingClientRect();
    return { x: rect.x, y: rect.y, scale: rect.width / (frame as HTMLElement).offsetWidth };
  });
  const inner = await app(page)
    .locator(selector)
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    });
  return { x: outer.x + (inner.x + inner.w * at.x) * outer.scale, y: outer.y + (inner.y + inner.h * at.y) * outer.scale };
};

const enterOn = async (page: Page, selector: string) => {
  const at = await pointIn(page, selector);
  await expect(async () => {
    await page.mouse.dblclick(at.x, at.y);
    await expect(overlay(page)).toBeAttached({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.locator(SHOWN_FRAME)).toHaveAttribute("data-interactive", "true", { timeout: 10_000 });
};

test("a double-click on a selected Screen enters design mode: hover shows a chip, a click selects with corner handles, a size badge and the parent dashed; Escape clears it and a click on empty canvas leaves", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      const id = await openReact(page, engine, project);
      await enterOn(page, "header");
      await expect(panel(page)).toBeVisible();
      await expect(overlay(page).locator('[data-design-outline="selected"]')).toHaveCount(1, { timeout: 10_000 });
      await expect(page.getByTestId("screen-design-title")).toHaveText("Header");

      const second = await pointIn(page, "li:nth-child(2) h3");
      await page.mouse.move(second.x, second.y);
      await expect(hoverChip(page)).toHaveText(/^Card \d+×\d+$/);

      await page.mouse.click(second.x, second.y);
      await expect(page.getByTestId("screen-design-title")).toHaveText("Card");
      await expect(overlay(page).locator("[data-design-corner]")).toHaveCount(4);
      await expect(badge(page)).toHaveText(/^\d+(\.\d)? × \d+(\.\d)?$/);
      await expect(overlay(page).locator('[data-design-outline="parent"]')).toHaveCount(1);

      await page.keyboard.press("Escape");
      await expect(overlay(page).locator('[data-design-outline="selected"]')).toHaveCount(0);
      await expect(overlay(page)).toBeAttached();
      expect(await screenShapes(engine, project)).toHaveLength(1);

      const screen = (await page.locator(`[data-shape-id="${id}"]`).boundingBox())!;
      await page.mouse.click(screen.x / 2, screen.y + screen.height / 2);
      await expect(overlay(page)).toHaveCount(0);
      await expect(panel(page)).toHaveCount(0);
      expect((await screenShapes(engine, project)).map((shape) => shape.id)).toEqual([id]);
    },
    prepareReactApp,
  );
});
