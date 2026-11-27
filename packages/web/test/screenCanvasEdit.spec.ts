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

const centreOf = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const frameScale = (page: Page) =>
  page.locator(SHOWN_FRAME).evaluate((frame) => frame.getBoundingClientRect().width / (frame as HTMLElement).offsetWidth);

const dragBy = async (page: Page, from: { readonly x: number; readonly y: number }, by: { readonly x: number; readonly y: number }, during?: () => Promise<void>) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) await page.mouse.move(from.x + (by.x * step) / 6, from.y + (by.y * step) / 6);
  await during?.();
  await page.mouse.up();
};

const computed = (page: Page, selector: string, property: string) => app(page).locator(selector).first().evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

const openDrafts = async (page: Page) => {
  await page.getByTestId("design-drafts-count").click();
  return page.getByRole("list", { name: "Changes" }).locator("[data-draft-row]");
};

test("dragging a padding bar and a gap bar sets them one to one and two to one, snapped to the scale with a live chip, as drafts the page shows", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await enterOn(page, "header h2");
      await expect(page.getByTestId("screen-design-title")).toHaveText("Header");
      const scale = await frameScale(page);

      await expect(overlay(page).locator('[data-design-padding="left"]')).toBeVisible();
      await expect(overlay(page).locator('[data-design-padding="top"]')).toHaveCount(0);
      await dragBy(page, await centreOf(page, '[data-design-padding="left"]'), { x: 6 * scale, y: 0 }, async () => {
        await expect(page.getByTestId("design-drag-chip")).toHaveText("20 · pl-5");
      });
      await expect.poll(() => computed(page, "header", "padding-left")).toBe("20px");

      await page.keyboard.press("Shift+Enter");
      await expect(page.getByTestId("screen-design-title")).toHaveText("App");
      await expect(overlay(page).locator("[data-design-gap]")).toHaveCount(1);
      await dragBy(page, await centreOf(page, "[data-design-gap]"), { x: 6 * scale, y: 0 }, async () => {
        await expect(page.getByTestId("design-drag-chip")).toHaveText("28 · gap-7");
        await expect(overlay(page).locator("[data-design-hatch]")).toHaveCount(1);
      });
      await expect.poll(() => computed(page, "main", "column-gap")).toBe("28px");

      await expect(page.getByTestId("design-drafts-count")).toHaveAccessibleName("2 changes");
      const rows = await openDrafts(page);
      await expect(rows.getByTestId("draft-line")).toHaveText(["Padding left 14 → 20 pl-5", "Gap 16 → 28 gap-7"]);
    },
    prepareReactApp,
  );
});

test("edge and corner handles resize with a live badge, the radius circle near a corner rounds it, and dragging an element in a flex row reorders it", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await enterOn(page, "li:nth-child(2) h3");
      await expect(page.getByTestId("screen-design-title")).toHaveText("Card");
      const scale = await frameScale(page);
      const before = Number.parseFloat(await computed(page, "li:nth-child(2)", "width"));

      await expect(overlay(page).locator('[data-design-edge="right"]')).toHaveClass(/cursor-ew-resize/);
      await expect(overlay(page).locator('[data-design-resize="se"]')).toHaveClass(/cursor-nwse-resize/);
      await dragBy(page, await centreOf(page, '[data-design-edge="right"]'), { x: -30 * scale, y: 0 }, async () => {
        await expect(badge(page)).toHaveText(/ × /);
      });
      await expect.poll(async () => Number.parseFloat(await computed(page, "li:nth-child(2)", "width"))).toBeLessThan(before - 25);

      const corner = await pointIn(page, "li:nth-child(2)", { x: 1, y: 1 });
      await page.mouse.move(corner.x - 16 * scale, corner.y - 16 * scale);
      await expect(overlay(page).locator('[data-design-radius="se"]')).toBeVisible();
      await dragBy(page, await centreOf(page, '[data-design-radius="se"]'), { x: -12 * scale, y: -12 * scale }, async () => {
        await expect(page.getByTestId("design-drag-chip")).toHaveText("Radius 20");
      });
      await expect.poll(() => computed(page, "li:nth-child(2)", "border-top-left-radius")).toBe("20px");

      await page.keyboard.press("Escape");
      const header = await pointIn(page, "header h2");
      await page.mouse.click(header.x, header.y);
      await expect(page.getByTestId("screen-design-title")).toHaveText("Header");
      const list = await pointIn(page, "ul", { x: 0.8, y: 0.2 });
      await dragBy(page, header, { x: list.x - header.x, y: list.y - header.y });
      await expect.poll(async () => (await app(page).locator("header").boundingBox())!.x > (await app(page).locator("ul").boundingBox())!.x).toBe(true);
      const rows = await openDrafts(page);
      await expect(rows.getByTestId("draft-line")).toContainText(["Moved after List"]);
    },
    prepareReactApp,
  );
});
