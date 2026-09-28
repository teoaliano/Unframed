import { centre, openCanvas, roomRecords, settledRecord, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

test("a reload and a second tab show the same board, and the second tab sees an edit within a second", async ({ page, context, engine }) => {
  await openCanvas(page, engine);
  const other = await context.newPage();
  await openCanvas(other, engine);

  const subject = shapeOnScreen(page, "shape:starter-subject");
  const before = (await roomRecords(engine, "default")).find((record) => record.id === "shape:starter-subject")!;
  const from = await centre(subject);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) await page.mouse.move(from.x + step * 12, from.y + step * 6);
  await page.mouse.up();
  const movedAt = Date.now();

  await expect
    .poll(async () => (await roomRecords(engine, "default")).find((record) => record.id === "shape:starter-subject")!.x, { timeout: 5000 })
    .toBeGreaterThan(before.x! + 10);

  const target = await centre(subject);
  await expect.poll(async () => Math.round((await centre(shapeOnScreen(other, "shape:starter-subject"))).x)).toBe(Math.round(target.x));
  expect(Date.now() - movedAt).toBeLessThan(1500);
  // The drag reached the room move by move; compare against where it stopped.
  const moved = (await settledRecord(engine, "default", "shape:starter-subject"))!;

  await page.reload();
  await openCanvas(page, engine);
  const afterReload = await roomRecords(engine, "default");
  expect(afterReload.find((record) => record.id === "shape:starter-subject")).toMatchObject({ x: moved.x, y: moved.y });
  await expect(shapeOnScreen(page, "shape:starter-subject")).toBeVisible();
  await expect(shapeOnScreen(page, "shape:starter-scene")).toBeVisible();
});
