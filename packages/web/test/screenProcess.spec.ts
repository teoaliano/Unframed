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
    const frame = page.frameLocator(`[data-screen-of="${first.id}"] iframe[data-screen-frame]`);
    await expect(frame.locator("#who")).toHaveText("session=signed-in; theme=dark", { timeout: 30_000 });
    const src = await page.locator(`[data-screen-of="${first.id}"] iframe[data-screen-frame]`).getAttribute("src");
    expect(new URL(src!).hostname).not.toBe(new URL(page.url()).hostname);
  });
});

test("a Screen's page loads once: zoom, a far pan, its editor tab and back, and a project tab switch all keep the same page", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    const screen = page.locator(`[data-shape-id="${first.id}"] [data-testid=screen]`);
    const frame = page.frameLocator(`[data-screen-of="${first.id}"] iframe[data-screen-frame]`);
    await expect(screen).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await frame.locator("body").evaluate(() => ((window as any).__kept = true));
    const kept = () => frame.locator("body").evaluate(() => (window as any).__kept === true);
    await page.mouse.move(640, 360);
    for (let step = 0; step < 15; step++) {
      await page.mouse.wheel(0, 120);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, 200);
      await page.keyboard.up("Control");
    }
    await pan(page, 6);
    await pan(page, -6);
    expect(await kept()).toBe(true);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Shift+2");
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Editor" }).click();
    await expect(page.getByTestId("screen-preview")).toHaveAttribute("data-painted", "true");
    expect(await kept()).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("artifact-editor")).toHaveCount(0);
    await expect(screen).toHaveAttribute("data-painted", "true");
    expect(await kept()).toBe(true);
    await page.getByTestId("tab-strip").getByRole("tab", { name: "default", exact: true }).click();
    await expect(page.locator("[data-canvas-project='default']")).toBeVisible();
    await page.getByTestId("tab-strip").getByRole("tab", { name: "my-app", exact: true }).click();
    await expect(screen).toHaveAttribute("data-painted", "true");
    expect(await kept()).toBe(true);
  });
});

test("a Screen's frame lies over its card on the canvas, and the selection toolbar stays above it when the Screen fills the view", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    const screen = page.locator(`[data-shape-id="${first.id}"] [data-testid=screen]`);
    await expect(screen).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await pan(page, 0.3);
    const card = (await page.locator(`[data-shape-id="${first.id}"] [data-screen-slot]`).boundingBox())!;
    const frame = (await page.locator(`[data-screen-of="${first.id}"]`).boundingBox())!;
    expect(Math.abs(frame.x - card.x)).toBeLessThan(1);
    expect(Math.abs(frame.y - card.y)).toBeLessThan(1);
    expect(Math.abs(frame.width - card.width)).toBeLessThan(1);
    await clickShape(page, first.id);
    await page.keyboard.press("Shift+2");
    await page.waitForTimeout(500);
    const toolbar = page.getByTestId("selection-toolbar");
    await expect(toolbar).toBeVisible();
    const box = (await toolbar.boundingBox())!;
    const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid=selection-toolbar]") !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(top).toBe(true);
  });
});
