import { centre, copySelection, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { filledMedia } from "./media.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const clickAt = (page: import("@playwright/test").Page, at: { x: number; y: number }) => page.mouse.click(at.x, at.y);

const clipboardPicture = (page: import("@playwright/test").Page) =>
  page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((candidate) => candidate.types.includes("image/png"));
    if (!item) return { types: items.flatMap((candidate) => candidate.types) };
    const bitmap = await createImageBitmap(await item.getType("image/png"));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const [red, green] = context.getImageData(bitmap.width - 1, bitmap.height - 1, 1, 1).data;
    return { types: item.types, width: bitmap.width, height: bitmap.height, corner: [red, green] };
  });

test("copying one filled image also puts its picture on the clipboard as a PNG", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const photo = { type: "image" as const, bytes: pngBytes(300, 150), name: "photo.png", mime: "image/png", natural: { w: 300, h: 150 } };
  await filledMedia(engine, { ...photo, id: "shape:photo", ref: "150", at: { x: 440, y: 60 } });
  await filledMedia(engine, { ...photo, id: "shape:other", ref: "151", at: { x: 440, y: 300 } });
  await expect(shapeOnScreen(page, "shape:other").locator("img")).toBeVisible();

  await clickAt(page, await centre(shapeOnScreen(page, "shape:photo")));
  await copySelection(page, ["text/html", "image/png"]);
  const picture = await clipboardPicture(page);
  expect(picture.types).toEqual(expect.arrayContaining(["text/html", "image/png"]));
  expect(picture).toMatchObject({ width: 300, height: 150 });
  // The test picture's bottom-right corner is full red and full green.
  expect(picture.corner![0]).toBeGreaterThan(240);
  expect(picture.corner![1]).toBeGreaterThan(240);

  // Two images copy as shapes only.
  await page.keyboard.down("Shift");
  await clickAt(page, await centre(shapeOnScreen(page, "shape:other")));
  await page.keyboard.up("Shift");
  await copySelection(page);
  expect((await clipboardPicture(page)).types).not.toContain("image/png");
});
