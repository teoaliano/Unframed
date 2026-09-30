import { expect, test } from "./fixtures.ts";
import { openCanvas } from "./canvas.ts";

test("the frame meter loads only with ?fps=1, learns the frame time, and reports each settled gesture", async ({ page, engine }) => {
  const scripts: string[] = [];
  page.on("request", (request) => request.resourceType() === "script" && scripts.push(new URL(request.url()).pathname));
  await openCanvas(page, engine);
  await page.waitForTimeout(1000);
  await expect(page.locator("[data-fps-meter]")).toHaveCount(0);
  expect(await page.evaluate(() => "__fps" in window)).toBe(false);
  const withoutMeter = new Set(scripts);

  await page.goto(`${engine.origin}/?fps=1`);
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible();
  const meter = page.locator("[data-fps-meter]");
  await expect(meter).toHaveText(/^fps: frame \d+(\.\d)? ms$/);
  expect(scripts.some((script) => !withoutMeter.has(script))).toBe(true);
  const frameTime = await page.evaluate(() => (window as any).__fps.frameTime());
  expect(frameTime).toBeGreaterThan(4);
  expect(frameTime).toBeLessThan(40);
  expect(await page.evaluate(() => (window as any).__fps.dump())).toEqual([]);

  await page.mouse.move(700, 500);
  await page.mouse.down();
  await page.mouse.move(900, 600, { steps: 20 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__fps.dump().length)).toBe(1);
  const [gesture] = await page.evaluate(() => (window as any).__fps.dump());
  expect(gesture).toMatchObject({ kind: "drag", frameTime, median: expect.any(Number), overOne: expect.any(Number), overTwo: expect.any(Number) });
  expect(gesture.gaps.length).toBeGreaterThan(5);
  expect(gesture.overTwo).toBeLessThanOrEqual(gesture.overOne);
  await expect(meter).toHaveText(/^drag: median \d+\.\d ms · over 1 frame \d+ · over 2 \d+ · \d+ frames$/);
});
