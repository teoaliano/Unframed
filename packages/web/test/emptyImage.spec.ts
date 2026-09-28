import { openCanvas, roomRecords, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { emptyMedia, putRecords } from "./media.ts";

test("an empty image asks for a file, fills from the picker, and is then bare, keeping its width with the picture's aspect", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [emptyMedia("shape:empty-image", "image", "150", { x: 440, y: 150 })]);
  const shape = shapeOnScreen(page, "shape:empty-image");
  await expect(shape.locator(".unframed-media-empty")).toBeVisible();
  await expect(shape.locator(".unframed-shape-label")).toHaveText("Image");
  await expect(shape.locator(".unframed-shape-label")).toHaveCSS("text-transform", "uppercase");
  const empty = (await shape.locator(".unframed-media-empty").boundingBox())!;
  expect(empty.width / empty.height).toBeCloseTo(240 / 140, 1);

  const chooser = page.waitForEvent("filechooser");
  await shape.getByRole("button", { name: "Choose file" }).click();
  const picker = await chooser;
  expect(await picker.element().getAttribute("accept")).toBe("image/*");
  await picker.setFiles({ name: "wide.png", mimeType: "image/png", buffer: pngBytes(800, 400) });

  const filled = await waitForRoom(engine, "default", (records) => {
    const record = records.find((each) => each.id === "shape:empty-image");
    return record?.props.assetId ? record : undefined;
  });
  expect(filled.props).toMatchObject({ w: 240, h: 120 });
  await expect(shape.locator(".unframed-media-empty")).toHaveCount(0);
  await expect(shape.locator(".unframed-shape-label")).toHaveCount(0);
  const image = shape.locator("img").first();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  const container = shape.locator(".tl-html-container").first();
  await expect(container).toHaveCSS("border-top-width", "0px");
  await expect(container).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const box = (await container.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(2, 1);

  // The asset keeps the picture's own size; only the shape is scaled to it.
  const asset = (await roomRecords(engine, "default")).find((record) => record.id === filled.props.assetId)!;
  expect(asset.props).toMatchObject({ w: 800, h: 400 });
});
