import { openCanvas, roomRecords, settledRecord, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

const SCENE = "shape:starter-scene";

test("dragging a prompt's edge pins its size, a still press does not, and double-clicking the edge makes it hug again", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const box = shapeOnScreen(page, SCENE).locator(".unframed-prompt");
  const hugged = (await box.boundingBox())!;
  await shapeOnScreen(page, SCENE).locator(".tl-rich-text").click();

  const edge = { x: hugged.x + hugged.width, y: hugged.y + hugged.height / 2 };

  // A press on the edge with no movement is not a resize.
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await box.boundingBox())!.width).toBe(hugged.width);
  expect((await settledRecord(engine, "default", SCENE))!.meta.sized).toBeUndefined();

  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x + 3, edge.y);
  for (let step = 1; step <= 10; step++) await page.mouse.move(edge.x + 3 + step * 25, edge.y);
  await page.mouse.up();

  // The prompt shows its pinned width at once; the room holds it once the tab has sent it.
  await expect.poll(async () => (await box.boundingBox())!.width).toBeCloseTo(hugged.width + 253, -1);
  const wider = (await box.boundingBox())!;
  expect(wider.height).toBeLessThan(hugged.height);
  const pinned = (await settledRecord(engine, "default", SCENE))!;
  expect(pinned.meta.sized).toBe(true);
  expect(pinned.props.w).toBeCloseTo(wider.width, 0);

  // Double-clicking the edge makes it hug its text again.
  const after = { x: wider.x + wider.width, y: wider.y + wider.height / 2 };
  await page.mouse.dblclick(after.x, after.y);
  await expect.poll(async () => (await roomRecords(engine, "default")).find((record) => record.id === SCENE)!.meta.sized).toBe(false);
  const rehugged = (await box.boundingBox())!;
  expect(rehugged.width).toBeCloseTo(hugged.width, 0);
  expect(rehugged.height).toBeCloseTo(hugged.height, 0);
});
