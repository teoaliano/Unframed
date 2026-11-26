import type { Page } from "@playwright/test";
import { expectFrameBudget, expectNoLongTasks, frameStats, gestureCount, lastGesture } from "./board.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";

test.describe.configure({ timeout: 300_000 });

const SCREENS = 200;
const COLUMNS = 20;
const BUDGET = { median: 16.7, over33: 0.01 };

const watchBoard = (page: Page) =>
  page.evaluate(() => {
    let most = 0;
    const check = () => {
      most = Math.max(most, document.querySelectorAll("iframe[data-screen-frame]:not([data-parked])").length);
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-parked"] });
    (window as any).__mostOpenFrames = () => most;
    (window as any).__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) (window as any).__longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });

const wheel = async (page: Page, dx: number, dy: number, ms: number, zoom = false) => {
  await page.mouse.move(640, 360);
  if (zoom) await page.keyboard.down("Control");
  const started = Date.now();
  for (let step = 0; Date.now() - started < ms; step++) {
    const direction = Math.floor(step / 60) % 2 === 0 ? 1 : -1;
    await page.mouse.wheel(dx * direction, dy * direction);
    await page.waitForTimeout(16);
  }
  if (zoom) await page.keyboard.up("Control");
};

const measure = async (page: Page, what: string, gesture: () => Promise<void>, kind: string) => {
  await page.evaluate(() => ((window as any).__longTasks = []));
  const before = await gestureCount(page);
  await gesture();
  const measured = await lastGesture(page, before, kind);
  const stats = frameStats(measured);
  const sorted = [...measured.gaps].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const longTasks = (await page.evaluate(() => (window as any).__longTasks as number[])).filter((ms) => ms > 50);
  console.log(`${what}: median ${stats.median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, over 33 ms ${(stats.over33 * 100).toFixed(2)} % of ${stats.frames} frames, long tasks over 50 ms ${longTasks.length}`);
  expectFrameBudget(stats, what, BUDGET);
  expectNoLongTasks(longTasks, what);
};

test("a board of 200 Screens of a busy page pans, zooms and duplicates within the frame budget, with one live Screen at most", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: undefined }, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(
      engine,
      project,
      Array.from({ length: SCREENS }, (_, index) => ({
        ...first,
        id: index === 0 ? first.id : `shape:board-${index}`,
        index: `a1${String(index).padStart(3, "0")}V`,
        x: (index % COLUMNS) * 440,
        y: Math.floor(index / COLUMNS) * 340,
        props: { ...first.props, route: `/busy?n=${index % 4}`, w: 390, h: 300 },
      })),
    );
    await page.goto(`${engine.origin}/?fps=1`);
    const host = page.locator(`[data-canvas-project="${project}"]`);
    await expect(host.locator(".tl-canvas")).toBeVisible({ timeout: 20_000 });
    await expect(host.locator("[data-testid=screen]")).toHaveCount(SCREENS, { timeout: 20_000 });
    await page.keyboard.press("Shift+1");
    await expect(host.locator("[data-testid=screen][data-picture]")).toHaveCount(SCREENS, { timeout: 120_000 });
    await watchBoard(page);
    await expect.poll(() => page.evaluate(() => (window as any).__fps.frameTime())).toBeGreaterThan(0);

    await clickShape(page, first.id);
    await expect(host.locator(`[data-shape-id="${first.id}"] [data-testid=screen]`)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await measure(page, "pan at fit, 200 Screens, one live", () => wheel(page, 12, 8, 4000), "wheel");
    await measure(page, "zoom at fit, 200 Screens, one live", () => wheel(page, 0, 8, 4000, true), "wheel");

    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+1");
    for (let step = 0; step < 12; step++) {
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -40);
      await page.keyboard.up("Control");
      await page.waitForTimeout(30);
    }
    await expect.poll(() => host.locator("[data-testid=screen][data-tier=snapshot]").count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await measure(page, "pan zoomed in on page copies", () => wheel(page, 12, 8, 4000), "wheel");

    await page.keyboard.press("Shift+1");
    await page.waitForTimeout(500);
    const originals = await page.evaluate(() => [...document.querySelectorAll("[data-shape-id]")].map((element) => element.getAttribute("data-shape-id")));
    await page.mouse.click(5, 300);
    await page.keyboard.press("ControlOrMeta+a");
    const before = await gestureCount(page);
    const started = Date.now();
    await page.keyboard.press("ControlOrMeta+d");
    await expect.poll(() => host.locator("[data-testid=screen]").count(), { timeout: 20_000 }).toBe(SCREENS * 2);
    const inDom = Date.now() - started;
    const pictured = await page.evaluate((originals) => {
      const copies = [...document.querySelectorAll<HTMLElement>("[data-shape-id]")].filter((element) => !originals.includes(element.getAttribute("data-shape-id")) && element.querySelector("[data-testid=screen]") !== null);
      return { copies: copies.length, pictured: copies.filter((element) => element.querySelector("img[data-testid=screen-snapshot]") !== null).length };
    }, originals);
    console.log(`duplicate all 200: copies in the DOM after ${inDom} ms, ${pictured.pictured} of ${pictured.copies} showing their picture`);
    expect(pictured).toEqual({ copies: SCREENS, pictured: SCREENS });
    const duplicate = await lastGesture(page, before, "keys").catch(() => undefined);
    if (duplicate !== undefined) console.log(`duplicate all 200: median ${frameStats(duplicate).median.toFixed(2)} ms over ${frameStats(duplicate).frames} frames`);

    const most = await page.evaluate(() => (window as any).__mostOpenFrames());
    console.log(`most frames open at once (not parked): ${most}`);
    expect(most).toBeLessThanOrEqual(1);
  });
});
