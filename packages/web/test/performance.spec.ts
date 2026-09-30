import { busyBoard, expectFrameBudget, frameStats, gestureCount, lastGesture, openMetered } from "./board.ts";
import { expect, test } from "./fixtures.ts";
import { openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("on a 300-shape board, dragging one image renders only it and keeps frames; panning renders no shape", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await busyBoard(engine);
  await openMetered(page, engine, 302);

  const dragged = "shape:img-55";
  const box = (await shapeOnScreen(page, dragged).boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  let before = await gestureCount(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let move = 1; move <= 50; move++) {
    await page.mouse.move(start.x + move * 3, start.y + move * 2);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const drag = await lastGesture(page, before);
  const dragStats = frameStats(drag);
  console.log(`drag: median ${dragStats.median.toFixed(2)} ms, over 33 ms ${(dragStats.over33 * 100).toFixed(2)} % of ${dragStats.frames} frames, renders ${JSON.stringify(drag.renders)}, display frame ${drag.frameTime.toFixed(2)} ms`);
  expect(drag.kind).toBe("drag");
  expect(Object.keys(drag.renders).filter((id) => id !== dragged)).toEqual([]);
  expect(drag.renders[dragged] ?? 0).toBeLessThanOrEqual(50);
  expectFrameBudget(dragStats, "drag", { median: 16.7, over33: 0.02 });

  before = await gestureCount(page);
  await page.mouse.move(640, 360);
  for (let step = 0; step < 60; step++) {
    await page.mouse.wheel(step < 30 ? 12 : -12, step < 30 ? 8 : -8);
    await page.waitForTimeout(16);
  }
  const pan = await lastGesture(page, before);
  const panStats = frameStats(pan);
  console.log(`pan: median ${panStats.median.toFixed(2)} ms, over 33 ms ${(panStats.over33 * 100).toFixed(2)} % of ${panStats.frames} frames, renders ${JSON.stringify(pan.renders)}`);
  expect(pan.kind).toBe("wheel");
  expect(pan.renders).toEqual({});

  // The drag did move the image, and the meter does see renders: resizing it changes its props.
  const moved = (await roomRecords(engine, "default")).find((record) => record.id === dragged)!;
  expect(moved.x).toBeGreaterThan(40 + 5 * 260 + 100);
  const now = (await shapeOnScreen(page, dragged).boundingBox())!;
  before = await gestureCount(page);
  await page.mouse.move(now.x + now.width, now.y + now.height);
  await page.mouse.down();
  await page.mouse.move(now.x + now.width + 20, now.y + now.height + 20, { steps: 5 });
  await page.mouse.up();
  const resize = await lastGesture(page, before);
  expect(Object.keys(resize.renders)).toEqual([dragged]);
});
