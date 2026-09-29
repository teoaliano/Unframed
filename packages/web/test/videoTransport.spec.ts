import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openCanvas, roomRecords, settledRecord, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { filledMedia } from "./media.ts";

const clipPath = fileURLToPath(new URL("./media/clip.webm", import.meta.url));

test("a clip's transport sits below it, outside its bounds; scrubbing never moves the shape, and a press on the clip drags it", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await filledMedia(engine, {
    id: "shape:clip",
    type: "video",
    ref: "150",
    at: { x: 440, y: 100 },
    bytes: await readFile(clipPath),
    name: "clip.webm",
    mime: "video/webm",
    natural: { w: 320, h: 180 },
  });
  const shape = shapeOnScreen(page, "shape:clip");
  const clip = shape.locator("video");
  await expect.poll(() => clip.evaluate((element: HTMLVideoElement) => element.readyState >= 1)).toBe(true);
  await expect(shape.locator("[data-testid='video-time']")).toHaveText("0:00 / 0:04");

  const clipBox = (await clip.boundingBox())!;
  const transport = shape.locator("[data-testid='video-transport']");
  const transportBox = (await transport.boundingBox())!;
  expect(transportBox.y).toBeGreaterThanOrEqual(clipBox.y + clipBox.height);

  await transport.getByRole("button", { name: "Play" }).click();
  await expect(transport.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect.poll(() => clip.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 5000 }).toBeGreaterThan(0.2);
  await transport.getByRole("button", { name: "Pause" }).click();
  await expect(transport.getByRole("button", { name: "Play" })).toBeVisible();

  const before = (await roomRecords(engine, "default")).find((record) => record.id === "shape:clip")!;
  const slider = transport.getByRole("slider", { name: "Position" });
  const sliderBox = (await slider.boundingBox())!;
  await page.mouse.move(sliderBox.x + 4, sliderBox.y + sliderBox.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(sliderBox.x + 4 + step * ((sliderBox.width * 0.7) / 8), sliderBox.y + sliderBox.height / 2 + step);
  await page.mouse.up();
  await expect.poll(() => clip.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(2);
  await expect(shape.locator("[data-testid='video-time']")).toHaveText(/^0:0[23] \/ 0:04$/);
  const afterScrub = await settledRecord(engine, "default", "shape:clip");
  expect({ x: afterScrub!.x, y: afterScrub!.y }).toEqual({ x: before.x, y: before.y });

  await page.mouse.move(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(clipBox.x + clipBox.width / 2 + step * 10, clipBox.y + clipBox.height / 2 + step * 5);
  await page.mouse.up();
  const dragged = await settledRecord(engine, "default", "shape:clip");
  expect(dragged!.x).toBeGreaterThan(before.x! + 40);
  expect(dragged!.y).toBeGreaterThan(before.y! + 20);
});
