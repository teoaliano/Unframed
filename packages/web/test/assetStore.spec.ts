import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyCanvasPoint, openCanvas, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes, sha } from "./images.ts";

test("the asset store uploads through the engine, keeps the original pixels, and resolves the marker to the project's file URL", async ({ page, engine }) => {
  await openCanvas(page, engine);
  // The upload key only works once tldraw has the keyboard, which a busy machine can delay.
  const at = await emptyCanvasPoint(page);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(".tl-container.tl-container__focused")).toHaveCount(1);
  // Wider than tldraw's own 5000 px import limit, which would scale it down.
  const original = pngBytes(6000, 90);
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("ControlOrMeta+u");
  await (await chooser).setFiles({ name: "Wide Strip.png", mimeType: "image/png", buffer: original });

  const asset = await waitForRoom(engine, "default", (records) =>
    records.find((record) => record.typeName === "asset" && String(record.props?.src ?? "").startsWith("project-file:")),
  );
  const file = String(asset.props.src).slice("project-file:".length);
  expect(file).toMatch(/^\d+-wide-strip\.png$/);
  expect(asset.props).toMatchObject({ w: 6000, h: 90, name: "Wide Strip.png", mimeType: "image/png" });

  const folder = join(engine.dataDir, "output", "default");
  expect(sha(await readFile(join(folder, file)))).toBe(sha(original));
  expect(JSON.parse(await readFile(join(folder, file.replace(/\.png$/, ".json")), "utf8"))).toMatchObject({
    source: "upload",
    fileName: "Wide Strip.png",
    mime: "image/png",
    bytes: original.length,
  });

  const shape = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "image" && record.props.assetId === asset.id));
  const image = shapeOnScreen(page, shape.id).locator("img").first();
  await expect(image).toHaveAttribute("src", new RegExp(`^/api/file/default/${file.replace(".", "\\.")}(\\?preview=\\d+)?$`));
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
});
