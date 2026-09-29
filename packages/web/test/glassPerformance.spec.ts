import { openRail, startAgentEngine } from "./agent.ts";
import { busyBoard, frameStats, gestureCount, lastGesture, openMetered } from "./board.ts";
import { centre, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

test.describe.configure({ mode: "serial", timeout: 240_000 });

/*
 * Spec 12's glass rule: a surface over the canvas may blur what is under it only while
 * spec 02's frame budget holds. The corner cards are always there; this pans the 300-shape
 * board with the rail open and a selection's toolbar showing, the other glass surfaces
 * that sit over a moving canvas.
 */
test("panning under the glass rail and selection toolbar keeps spec 02's frame budget", async ({ page }) => {
  const engine = await startAgentEngine();
  try {
    await page.goto(engine.origin);
    await busyBoard(engine);
    await openMetered(page, engine, 302);
    await openRail(page);
    const image = await centre(shapeOnScreen(page, "shape:img-10"));
    await page.mouse.click(image.x, image.y);
    await expect(page.getByTestId("selection-toolbar")).toBeVisible();

    const before = await gestureCount(page);
    await page.mouse.move(400, 360);
    for (let step = 0; step < 60; step++) {
      await page.mouse.wheel(step < 30 ? 12 : -12, step < 30 ? 8 : -8);
      await page.waitForTimeout(16);
    }
    const pan = await lastGesture(page, before, "wheel");
    const stats = frameStats(pan);
    console.log(`glass pan: median ${stats.median.toFixed(2)} ms, over 33 ms ${(stats.over33 * 100).toFixed(2)} % of ${stats.frames} frames, display frame ${pan.frameTime.toFixed(2)} ms`);
    expect(stats.median).toBeLessThanOrEqual(16.7);
    expect(stats.over33).toBeLessThanOrEqual(0.02);
  } finally {
    await engine.dispose();
  }
});
