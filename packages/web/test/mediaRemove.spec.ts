import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { centre, openCanvas, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { filledMedia } from "./media.ts";

test("a selected filled image shows its remove control, which empties the shape at the same width and keeps the file", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const { file } = await filledMedia(engine, {
    id: "shape:photo",
    type: "image",
    ref: "150",
    at: { x: 440, y: 100 },
    bytes: pngBytes(600, 300),
    name: "photo.png",
    mime: "image/png",
    natural: { w: 600, h: 300 },
  });
  const shape = shapeOnScreen(page, "shape:photo");
  const remove = shape.getByRole("button", { name: "Remove photo.png" });
  // The control's wrapper shows it while the shape is selected; the kit button inside keeps its own look.
  const shown = shape.getByTestId("media-remove");
  await expect(shown).toHaveCSS("opacity", "0");

  const middle = await centre(shape.locator(".tl-html-container").first());
  await page.mouse.move(middle.x, middle.y);
  await page.waitForTimeout(300);
  await expect(shown).toHaveCSS("opacity", "0");

  await page.mouse.click(middle.x, middle.y);
  await expect(shown).toHaveCSS("opacity", "1");
  const box = (await remove.boundingBox())!;
  const image = (await shape.locator(".tl-html-container").first().boundingBox())!;
  expect(box.width).toBeCloseTo(20, 0);
  expect(image.x + image.width - (box.x + box.width)).toBeCloseTo(4, 0);
  expect(box.y - image.y).toBeCloseTo(4, 0);

  await remove.click();
  const emptied = await waitForRoom(engine, "default", (records) => {
    const record = records.find((each) => each.id === "shape:photo");
    return record && record.props.assetId === null ? record : undefined;
  });
  expect(emptied.props.w).toBe(240);
  await expect(shape.locator("[data-testid='media-empty']")).toBeVisible();
  expect(await readdir(join(engine.dataDir, "output", "default"))).toContain(file);
});
