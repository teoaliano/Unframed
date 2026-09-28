import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { centre, openCanvas, roomRecords, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { dropFiles, emptyMedia, filledMedia, putRecords } from "./media.ts";

const clipPath = fileURLToPath(new URL("./media/clip.webm", import.meta.url));

test("dropping a picture on an image, or a clip on a video, replaces its media; any other drop on a shape is a canvas drop", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const { assetId } = await filledMedia(engine, {
    id: "shape:photo",
    type: "image",
    ref: "150",
    at: { x: 440, y: 60 },
    bytes: pngBytes(600, 300),
    name: "photo.png",
    mime: "image/png",
    natural: { w: 600, h: 300 },
  });
  await putRecords(engine, [emptyMedia("shape:clip", "video", "151", { x: 440, y: 260 })]);
  const photo = shapeOnScreen(page, "shape:photo").locator(".tl-html-container").first();
  await expect(photo).toBeVisible();

  await dropFiles(page, await centre(photo), [{ name: "square.png", mime: "image/png", bytes: pngBytes(400, 400, 20) }]);
  const replaced = await waitForRoom(engine, "default", (records) => {
    const shape = records.find((record) => record.id === "shape:photo");
    return shape && shape.props.assetId !== assetId ? shape : undefined;
  });
  expect(replaced.props).toMatchObject({ w: 240, h: 240 });
  const asset = (await roomRecords(engine, "default")).find((record) => record.id === replaced.props.assetId)!;
  expect(asset.props.name).toBe("square.png");

  await dropFiles(page, await centre(shapeOnScreen(page, "shape:clip").locator(".unframed-media-empty")), [
    { name: "clip.webm", mime: "video/webm", bytes: await readFile(clipPath) },
  ]);
  await waitForRoom(engine, "default", (records) => records.find((record) => record.id === "shape:clip")?.props.assetId);

  const before = new Set((await roomRecords(engine, "default")).map((record) => record.id));
  await dropFiles(page, await centre(photo), [{ name: "other.webm", mime: "video/webm", bytes: await readFile(clipPath) }]);
  const added = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "video" && !before.has(record.id)));
  expect(added.props.assetId).not.toBeNull();
  expect((await roomRecords(engine, "default")).find((record) => record.id === "shape:photo")!.props.assetId).toBe(replaced.props.assetId);
});
