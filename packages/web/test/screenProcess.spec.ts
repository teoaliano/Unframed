import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";

const pan = async (page: Page, widths: number) => {
  const width = page.viewportSize()!.width;
  await page.mouse.move(640, 360);
  for (let step = 0; step < Math.abs(widths) * 10; step++) {
    await page.mouse.wheel(Math.sign(widths) * (width / 10), 0);
    await page.waitForTimeout(16);
  }
};

test("a Screen loads from the other loopback host, so it runs outside the canvas's process, and cookies set by its server and by its script still hold", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/whoami?login", w: 640, h: 480 } }]);
    await clickShape(page, first.id);
    const frame = page.frameLocator(`[data-shape-id="${first.id}"] iframe[data-screen-frame]`);
    await expect(frame.locator("#who")).toHaveText("session=signed-in; theme=dark", { timeout: 30_000 });
    const src = await page.locator(`[data-shape-id="${first.id}"] iframe[data-screen-frame]`).getAttribute("src");
    expect(new URL(src!).hostname).not.toBe(new URL(page.url()).hostname);
  });
});

test("a live Screen keeps its page when the canvas narrows, when panned far away and back, and when parked and selected again", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    const screen = page.locator(`[data-shape-id="${first.id}"] [data-testid=screen]`);
    const frame = page.frameLocator(`[data-shape-id="${first.id}"] iframe[data-screen-frame]`);
    await clickShape(page, first.id);
    await expect(screen).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await frame.locator("body").evaluate(() => ((window as any).__kept = true));
    const kept = () => frame.locator("body").evaluate(() => (window as any).__kept === true);
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: Math.round(size.width * 0.6), height: size.height });
    await page.waitForTimeout(300);
    await page.setViewportSize(size);
    expect(await kept()).toBe(true);
    await pan(page, 6);
    await page.waitForTimeout(300);
    await pan(page, -6);
    await expect(screen).toHaveAttribute("data-painted", "true");
    expect(await kept()).toBe(true);
    await page.keyboard.press("Escape");
    await expect(screen).toHaveAttribute("data-tier", "parked");
    await clickShape(page, first.id);
    await expect(screen).toHaveAttribute("data-painted", "true");
    expect(await kept()).toBe(true);
  });
});
