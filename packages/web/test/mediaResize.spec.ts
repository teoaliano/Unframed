import type { Page } from "@playwright/test";
import { openCanvas, settledRecord, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { filledMedia } from "./media.ts";

const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    await page.waitForTimeout(16);
  }
  // tldraw applies pointer moves on its next tick; let the last one land before releasing.
  await page.waitForTimeout(100);
  await page.mouse.up();
};

test("an image resizes with its aspect locked, from 140 to 900 wide and at least 100 high, and tldraw's crop works", async ({ page, engine }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openCanvas(page, engine);
  await filledMedia(engine, {
    id: "shape:photo",
    type: "image",
    ref: "150",
    at: { x: -300, y: 100 },
    bytes: pngBytes(800, 400),
    name: "photo.png",
    mime: "image/png",
    natural: { w: 800, h: 400 },
  });
  const shape = shapeOnScreen(page, "shape:photo");
  const box = async () => (await shape.locator(".tl-html-container").first().boundingBox())!;
  await expect.poll(async () => (await box()).width).toBeGreaterThan(100);
  const start = await box();
  await page.mouse.click(start.x + start.width / 2, start.y + start.height / 2);

  await drag(page, { x: start.x + start.width, y: start.y + start.height }, { x: start.x + start.width + 900, y: start.y + start.height + 20 });
  let record = (await settledRecord(engine, "default", "shape:photo"))!;
  expect(record.props.w).toBeCloseTo(900, 3);
  expect(record.props.h).toBeCloseTo(450, 3);

  const big = await box();
  await drag(page, { x: big.x + big.width, y: big.y + big.height / 2 }, { x: big.x + 20, y: big.y + big.height / 2 });
  record = (await settledRecord(engine, "default", "shape:photo"))!;
  expect(record.props.w).toBeCloseTo(200, 3);
  expect(record.props.h).toBeCloseTo(100, 3);

  const small = await box();
  await drag(page, { x: small.x + small.width / 2, y: small.y + small.height }, { x: small.x + small.width / 2, y: small.y + small.height + 150 });
  record = (await settledRecord(engine, "default", "shape:photo"))!;
  expect(record.props.w / record.props.h).toBeCloseTo(2, 3);
  expect(record.props.h).toBeGreaterThan(150);

  // Double-clicking an image enters tldraw's crop; dragging a crop corner crops it.
  const current = await box();
  await page.mouse.dblclick(current.x + current.width / 2, current.y + current.height / 2);
  await page.waitForTimeout(600);
  await drag(page, { x: current.x + 2, y: current.y + 2 }, { x: current.x + current.width / 3, y: current.y + current.height / 3 });
  await page.keyboard.press("Enter");
  record = (await settledRecord(engine, "default", "shape:photo"))!;
  expect(record.props.crop).not.toBeNull();
  expect(record.props.crop.topLeft.x).toBeGreaterThan(0.1);
});
