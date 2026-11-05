import { expectFrameBudget, frameStats, gestureCount, imageRecords, lastGesture, openMetered } from "./board.ts";
import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { test, expect } from "./fixtures.ts";
import { putRecords } from "./media.ts";
import { nodeShape, seedBoard, wireShape } from "./nodes.ts";

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("on a board of 10 nodes and 30 wires, dragging a source image renders only it and its own wires, and panning renders nothing", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const images = await imageRecords(engine, 15, { natural: { w: 512, h: 512 }, width: 160, columns: 1, pitch: { x: 0, y: 190 }, origin: { x: 40, y: 40 } });
  const nodes = Array.from({ length: 10 }, (_, index) => nodeShape(`node-${index}`, String(5000 + index), { medium: "image", instruction: `scene ${index}` }, { x: 600 + (index % 2) * 480, y: 40 + Math.floor(index / 2) * 420 }));
  const wires = Array.from({ length: 30 }, (_, index) => wireShape(`wire-${index}`, `img-${index % 15}`, `node-${index % 10}`, "reference"));
  await seedBoard(engine, []);
  await putRecords(engine, [...images, ...nodes, ...wires]);
  await openMetered(page, engine, 55);

  const dragged = "shape:img-0";
  const own = new Set(wires.filter((wire) => (wire.props as { from: string }).from === dragged).map((wire) => wire.id as string));
  expect(own.size).toBe(2);
  const box = (await shapeOnScreen(page, dragged).boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  let before = await gestureCount(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let move = 1; move <= 50; move++) {
    await page.mouse.move(start.x + move * 2, start.y + move);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const drag = await lastGesture(page, before);
  const dragStats = frameStats(drag);
  console.log(`node drag: median ${dragStats.median.toFixed(2)} ms, over 33 ms ${(dragStats.over33 * 100).toFixed(2)} % of ${dragStats.frames} frames, renders ${JSON.stringify(drag.renders)}`);
  expect(drag.kind).toBe("drag");
  expect(Object.keys(drag.renders).filter((id) => id !== dragged && !own.has(id))).toEqual([]);
  expectFrameBudget(dragStats, "node drag", { median: 16.7, over33: 0.02 });

  before = await gestureCount(page);
  await page.mouse.move(700, 400);
  for (let step = 0; step < 60; step++) {
    await page.mouse.wheel(step < 30 ? 12 : -12, step < 30 ? 8 : -8);
    await page.waitForTimeout(16);
  }
  const pan = await lastGesture(page, before);
  const panStats = frameStats(pan);
  console.log(`node pan: median ${panStats.median.toFixed(2)} ms, over 33 ms ${(panStats.over33 * 100).toFixed(2)} % of ${panStats.frames} frames, renders ${JSON.stringify(pan.renders)}`);
  expect(pan.kind).toBe("wheel");
  expect(pan.renders).toEqual({});
  expectFrameBudget(panStats, "node pan", { median: 16.7, over33: 0.02 });
});
