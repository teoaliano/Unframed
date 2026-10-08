import type { Locator } from "@playwright/test";
import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expectNoLongTasks } from "./board.ts";
import { emptyCanvasPoint, openCanvas, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { dropFiles, filledMedia } from "./media.ts";

const exists = (path: string) => access(path).then(
  () => true,
  () => false,
);

const shownSrc = (image: Locator) => image.evaluate((element: HTMLImageElement) => element.getAttribute("src") ?? "");

test("an upload makes 512 and 2048 WebP previews off the main thread, and the view uses the smallest that covers the image", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const at = await emptyCanvasPoint(page);
  const bytes = pngBytes(3000, 2000);
  await page.evaluate(() => {
    const long: number[] = [];
    (window as any).__long = long;
    new PerformanceObserver((list) => long.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: "longtask" });
  });
  await dropFiles(page, at, [{ name: "harbour.png", mime: "image/png", bytes }]);
  await page.evaluate(() => ((window as any).__long.length = 0));

  const asset = await waitForRoom(engine, "default", (records) => records.find((record) => record.typeName === "asset" && String(record.props.src).startsWith("project-file:")));
  const file = String(asset.props.src).slice("project-file:".length);
  const cache = join(engine.dataDir, "output", "default", ".cache", "previews");
  await expect.poll(async () => (await exists(join(cache, `${file}-512.webp`))) && (await exists(join(cache, `${file}-2048.webp`))), { timeout: 20_000 }).toBe(true);
  // Making them never held the page's main thread. The original is decoded for display while
  // the worker runs, which can cost one task of about 55 ms, so only a task over 100 ms counts.
  // A timing threshold like the frame budgets: enforced on real hardware, reported on CI.
  expectNoLongTasks((await page.evaluate(() => (window as any).__long as number[])).filter((ms) => ms > 100), "making previews");
  // The room keeps the original: previews are only for display, so what is sent anywhere is the file itself.
  expect(asset.props.src).toBe(`project-file:${file}`);
  expect((await readdir(join(engine.dataDir, "output", "default"))).filter((name) => name.endsWith(".webp"))).toEqual([]);

  const shape = await waitForRoom(engine, "default", (records) => records.find((record) => record.typeName === "shape" && record.type === "image"));
  const onScreen = shapeOnScreen(page, shape.id);
  const image = onScreen.locator("img").first();
  // The smallest preview whose longest side covers the image's width on screen, else the original.
  // Measured on the shape, which the uncropped image fills: tldraw swaps in a new <img> when the
  // source changes, so the one `image` found can leave the page before its box is read.
  const expected = async () => {
    const { width } = (await onScreen.boundingBox())!;
    return width <= 512 ? "?preview=512" : width <= 2048 ? "?preview=2048" : "";
  };
  // The shape reaches the room before its <img> renders; on a slow runner the gap is long enough to read no box at all.
  await expect(image).toBeVisible();
  const box = (await onScreen.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Zoom to selection does nothing until the click has selected the image; the toolbar is the sign it has.
  await expect(page.getByTestId("selection-toolbar")).toBeVisible();
  await page.keyboard.press("Shift+2");
  await expect.poll(expected).not.toBe("?preview=512");
  const close = await expected();
  await expect.poll(() => shownSrc(image)).toBe(`/api/file/default/${file}${close}`);
  for (let step = 0; step < 2; step++) {
    await page.keyboard.press("-");
    await page.waitForTimeout(600);
  }
  expect(await expected()).toBe("?preview=512");
  await expect.poll(() => shownSrc(image)).toBe(`/api/file/default/${file}?preview=512`);
});

test("an image with missing or broken previews shows its original while they are made, and uses them next time", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const { file } = await filledMedia(engine, { id: "shape:photo", type: "image", ref: "150", at: { x: 440, y: 60 }, bytes: pngBytes(3000, 2000), name: "photo.png", mime: "image/png", natural: { w: 3000, h: 2000 } });
  const image = shapeOnScreen(page, "shape:photo").locator("img").first();
  await expect.poll(() => shownSrc(image)).toBe(`/api/file/default/${file}`);
  const cache = join(engine.dataDir, "output", "default", ".cache", "previews");
  await expect.poll(() => exists(join(cache, `${file}-512.webp`)), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => exists(join(cache, `${file}-2048.webp`)), { timeout: 20_000 }).toBe(true);

  await openCanvas(page, engine);
  await expect.poll(() => shownSrc(image)).toBe(`/api/file/default/${file}?preview=512`);

  // Previews that went missing: the original again, and they are made again.
  await rm(cache, { recursive: true });
  await openCanvas(page, engine);
  await expect.poll(() => shownSrc(image)).toBe(`/api/file/default/${file}`);
  await expect.poll(() => exists(join(cache, `${file}-512.webp`)), { timeout: 20_000 }).toBe(true);

  // A preview that does not decode: the original again, and a good preview is made in its place.
  await expect.poll(() => exists(join(cache, `${file}-2048.webp`)), { timeout: 20_000 }).toBe(true);
  await writeFile(join(cache, `${file}-512.webp`), "not a picture");
  await openCanvas(page, engine);
  await expect.poll(() => shownSrc(image)).toBe(`/api/file/default/${file}`);
  await expect.poll(async () => (await readFile(join(cache, `${file}-512.webp`))).subarray(8, 12).toString("latin1"), { timeout: 20_000 }).toBe("WEBP");
  await openCanvas(page, engine);
  await expect.poll(() => shownSrc(image)).toBe(`/api/file/default/${file}?preview=512`);
});
