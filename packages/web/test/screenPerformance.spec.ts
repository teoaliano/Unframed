import { expectFrameBudget, expectNoLongTasks, frameStats, gestureCount, lastGesture } from "./board.ts";
import { expect, test } from "./fixtures.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";

test.describe.configure({ timeout: 180_000 });

const SCREENS = 24;

test("a board of 24 live Screens of one dev server pans for 4 s within the frame budget once they have loaded", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(
      engine,
      project,
      Array.from({ length: SCREENS }, (_, index) => ({
        ...first,
        id: index === 0 ? first.id : `shape:perf-${index}`,
        index: `a${String.fromCharCode(66 + index)}`,
        x: (index % 6) * 440,
        y: Math.floor(index / 6) * 340,
        props: { ...first.props, route: `/app?n=${index}`, w: 390, h: 300 },
      })),
    );
    await page.addInitScript(() => {
      (window as any).__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) (window as any).__longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    });
    await page.goto(`${engine.origin}/?fps=1`);
    const host = page.locator(`[data-canvas-project="${project}"]`);
    await expect(host.locator(".tl-canvas")).toBeVisible({ timeout: 20_000 });
    await expect(host.locator("[data-testid=screen]")).toHaveCount(SCREENS, { timeout: 20_000 });
    await page.keyboard.press("Shift+1");
    await expect
      .poll(() => page.evaluate(() => (window as any).__fps.screens()), { timeout: 90_000 })
      .toMatchObject({ live: SCREENS, loading: 0, queued: 0, failed: 0 });
    await expect(host.locator("[data-testid=screen][data-painted=true]")).toHaveCount(SCREENS);
    await expect(page.locator("[data-fps-screens]")).toHaveText(`screens: live ${SCREENS} · loading 0 · queued 0 · replays 0 · retries 0 · failed 0`);
    await expect.poll(() => page.evaluate(() => (window as any).__fps.frameTime())).toBeGreaterThan(0);
    await page.evaluate(() => ((window as any).__longTasks = []));

    const before = await gestureCount(page);
    await page.mouse.move(640, 360);
    const started = Date.now();
    for (let step = 0; Date.now() - started < 4000; step++) {
      const direction = Math.floor(step / 60) % 2 === 0 ? 1 : -1;
      await page.mouse.wheel(10 * direction, 6 * direction);
      await page.waitForTimeout(16);
    }
    const pan = await lastGesture(page, before, "wheel");
    const longTasks = (await page.evaluate(() => (window as any).__longTasks as number[])).filter((ms) => ms > 50);
    const stats = frameStats(pan);
    console.log(`screen pan with ${SCREENS} live Screens: median ${stats.median.toFixed(2)} ms, over 33 ms ${(stats.over33 * 100).toFixed(2)} % of ${stats.frames} frames, long tasks over 50 ms ${longTasks.length}, display frame ${pan.frameTime.toFixed(2)} ms`);
    expect(pan.kind).toBe("wheel");
    expectFrameBudget(stats, "screen pan, 24 live", { median: 16.7, over33: 0.02 });
    expectNoLongTasks(longTasks, "screen pan, 24 live");
  });
});
