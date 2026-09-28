import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { frameStats, gestureCount, imageRecords, lastGesture, openMetered } from "./board.ts";
import { openCanvas } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { flatPngBytes } from "./images.ts";
import { putRecords } from "./media.ts";

test.describe.configure({ timeout: 300_000 });

const COLOURS: Array<[number, number, number]> = [
  [200, 90, 60],
  [60, 140, 200],
  [90, 170, 90],
  [210, 180, 60],
  [150, 90, 180],
];

/** The pixels every image on the page holds decoded, counted at four bytes a pixel. */
const decodedBytes = (page: import("@playwright/test").Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>(".tl-shape img")].reduce((sum, image) => sum + image.naturalWidth * image.naturalHeight * 4, 0));

test("40 images of 6000 by 4000 zoom in and out 20 steps within the frame budget, holding previews rather than originals", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const bytes = COLOURS.map((colour) => flatPngBytes(6000, 4000, colour));
  const records = await imageRecords(engine, 40, {
    natural: { w: 6000, h: 4000 },
    width: 240,
    columns: 8,
    pitch: { x: 260, y: 180 },
    bytes: (index) => bytes[index % bytes.length]!,
  });
  await putRecords(engine, records);

  // The first showing makes the previews in the background; wait for all 80.
  await openMetered(page, engine, 42);
  const cache = join(engine.dataDir, "output", "default", ".cache", "previews");
  await expect.poll(async () => (await readdir(cache).catch(() => [])).filter((name) => name.endsWith(".webp")).length, { timeout: 240_000, intervals: [2000] }).toBe(80);

  // Shown again, the board uses them.
  await openMetered(page, engine, 42);
  const budget = 40 * 2048 * Math.round((2048 * 4000) / 6000) * 4 + 6000 * 4000 * 4;
  let peak = await decodedBytes(page);

  const before = await gestureCount(page);
  await page.mouse.move(640, 360);
  await page.keyboard.down("Control");
  const zoomLevel = async () => parseInt((await page.getByTestId("minimap.zoom-menu-button").textContent()) ?? "0", 10);
  const fitted = await zoomLevel();
  let closest = fitted;
  // Twenty wheel steps in, then twenty back out.
  for (let step = 0; step < 40; step++) {
    await page.mouse.wheel(0, step < 20 ? -150 : 150);
    await page.waitForTimeout(60);
    peak = Math.max(peak, await decodedBytes(page));
    closest = Math.max(closest, await zoomLevel());
  }
  await page.keyboard.up("Control");
  const zoom = await lastGesture(page, before, "wheel");
  await page.waitForTimeout(800);
  peak = Math.max(peak, await decodedBytes(page));

  const stats = frameStats(zoom);
  console.log(
    `large images zoom: median ${stats.median.toFixed(2)} ms, over 33 ms ${(stats.over33 * 100).toFixed(2)} % of ${stats.frames} frames, zoom ${fitted}% to ${closest}%, decoded ${(peak / 1_048_576).toFixed(0)} MB of a ${(budget / 1_048_576).toFixed(0)} MB budget, display frame ${zoom.frameTime.toFixed(2)} ms`,
  );
  // The steps in reach close to the 400 % limit, where images want their 2048 previews.
  expect(closest).toBeGreaterThanOrEqual(300);
  expect(stats.median).toBeLessThanOrEqual(16.7);
  expect(stats.over33).toBeLessThanOrEqual(0.02);
  expect(peak).toBeLessThan(budget);
});
