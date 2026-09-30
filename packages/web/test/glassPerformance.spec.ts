import { openRail, startAgentEngine } from "./agent.ts";
import { busyBoard, expectFrameBudget, frameStats, gestureCount, lastGesture, openMetered } from "./board.ts";
import { centre, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

test.describe.configure({ mode: "serial", timeout: 240_000 });

/*
 * Spec 12's glass rule: a surface over the canvas may blur what is under it only while
 * spec 02's frame budget holds. The corner cards are always there; these pan the 300-shape
 * board under the other surfaces over a moving canvas: the glass selection toolbar with
 * the rail open (solid now, since on glass it crossed the budget), and the glass composer.
 */
test("panning with the rail open under the glass selection toolbar keeps spec 02's frame budget", async ({ page }) => {
  const engine = await startAgentEngine();
  try {
    await page.goto(engine.origin);
    await busyBoard(engine);
    await openMetered(page, engine, 302);
    await openRail(page);
    // An image clear of the rail on the left and the bottom bar.
    let image: { x: number; y: number } | undefined;
    for (let index = 0; index < 100 && !image; index++) {
      const box = await shapeOnScreen(page, `shape:img-${index}`).boundingBox();
      if (box && box.x > 420 && box.x + box.width < 1200 && box.y > 80 && box.y + box.height < 600) image = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    await page.mouse.click(image!.x, image!.y);
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
    expectFrameBudget(stats, "glass pan", { median: 16.7, over33: 0.02 });
  } finally {
    await engine.dispose();
  }
});

test("panning under the glass Generate composer keeps spec 02's frame budget", async ({ page, engine }) => {
  await page.goto(engine.origin);
  await busyBoard(engine);
  await openMetered(page, engine, 302);
  const image = await centre(shapeOnScreen(page, "shape:img-10"));
  await page.mouse.click(image.x, image.y);
  await page.getByTestId("selection-toolbar").getByRole("button", { name: /^Generate/ }).click();
  await expect(page.getByTestId("composer")).toBeVisible();

  const before = await gestureCount(page);
  await page.mouse.move(400, 600);
  for (let step = 0; step < 60; step++) {
    await page.mouse.wheel(step < 30 ? 12 : -12, step < 30 ? 8 : -8);
    await page.waitForTimeout(16);
  }
  const pan = await lastGesture(page, before, "wheel");
  const stats = frameStats(pan);
  console.log(`glass composer pan: median ${stats.median.toFixed(2)} ms, over 33 ms ${(stats.over33 * 100).toFixed(2)} % of ${stats.frames} frames, display frame ${pan.frameTime.toFixed(2)} ms`);
  expectFrameBudget(stats, "glass composer pan", { median: 16.7, over33: 0.02 });
});
