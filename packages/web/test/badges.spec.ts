import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { clickShape, composer, expect, openComposer, sendRun, test, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { artifactRecord, emptyMedia, filledMedia, putRecords } from "./media.ts";


const badge = (page: Page, id: string) => page.locator(`[data-role-for="${id}"]`);

/** A PNG's pixel size, from its header. */
const pngSize = (dataUrl: string) => {
  const bytes = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
};

const GEO = {
  geo: "rectangle",
  dash: "draw",
  url: "",
  w: 60,
  h: 40,
  growY: 0,
  scale: 1,
  flipX: false,
  flipY: false,
  labelColor: "black",
  color: "red",
  fill: "solid",
  size: "m",
  font: "draw",
  align: "middle",
  verticalAlign: "middle",
  richText: { type: "doc", content: [{ type: "paragraph" }] },
};

const mark = (id: string, at: { x: number; y: number }) => ({
  id,
  typeName: "shape",
  type: "geo",
  x: at.x,
  y: at.y,
  rotation: 0,
  index: "b10",
  parentId: "page:page",
  isLocked: false,
  opacity: 1,
  props: GEO,
  meta: {},
});

test("badges show each selected medium's role only while the Generate tray is open, and match what is sent", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  const a = pngBytes(30, 30, 1);
  const b = pngBytes(30, 30, 60);
  await filledMedia(engine, { id: "shape:a", type: "image", ref: "300", at: { x: 420, y: -60 }, bytes: a, name: "a.png", mime: "image/png", natural: { w: 30, h: 30 }, width: 140 });
  await filledMedia(engine, { id: "shape:b", type: "image", ref: "301", at: { x: 420, y: 150 }, bytes: b, name: "b.png", mime: "image/png", natural: { w: 30, h: 30 }, width: 140 });
  await putRecords(engine, [emptyMedia("shape:empty", "image", "302", { x: 600, y: -60 }, { w: 140, h: 100 }), artifactRecord("shape:page", "page", "303", { x: 600, y: 150 }, "p.html", "p.html")]);
  await expect(shapeOnScreen(page, "shape:page")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator(".unframed-role-badge")).toHaveCount(0);

  await openComposer(page);
  await expect(badge(page, "shape:a")).toHaveText("image 1");
  await expect(badge(page, "shape:b")).toHaveText("image 2");
  await expect(badge(page, "shape:empty")).toHaveText("—");
  await expect(badge(page, "shape:page")).toHaveText("—");
  await expect(page.locator(".unframed-role-badge")).toHaveCount(4);
  // A badge sits above its shape's top-left corner.
  const shape = (await shapeOnScreen(page, "shape:a").boundingBox())!;
  const label = (await badge(page, "shape:a").boundingBox())!;
  expect(label.x).toBeCloseTo(shape.x, 0);
  expect(label.y + label.height).toBeCloseTo(shape.y, 0);

  await page.keyboard.press("Escape");
  await expect(page.locator(".unframed-role-badge")).toHaveCount(0);

  // Moving b above a swaps their numbers live, and the request follows the badges.
  await openComposer(page);
  const current = (await roomRecords(engine, "default")).find((record) => record.id === "shape:b")!;
  await putRecords(engine, [{ ...current, y: -200 }]);
  await expect(badge(page, "shape:b")).toHaveText("image 1");
  await expect(badge(page, "shape:a")).toHaveText("image 2");
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(1);
  expect(generation.requests[0]!.body.input_references.map((ref: any) => ref.image_url.url)).toEqual([
    `data:image/png;base64,${b.toString("base64")}`,
    `data:image/png;base64,${a.toString("base64")}`,
  ]);
});

test("marks on a selected image go as one composite in its slot, loose marks as one sketch; the canvas is left as it was", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  const { file } = await filledMedia(engine, {
    id: "shape:photo",
    type: "image",
    ref: "300",
    at: { x: 420, y: -60 },
    bytes: pngBytes(400, 200),
    name: "photo.png",
    mime: "image/png",
    natural: { w: 400, h: 200 },
    width: 200,
  });
  await putRecords(engine, [mark("shape:on-photo", { x: 470, y: -40 }), mark("shape:loose", { x: 700, y: 150 })]);
  await expect(shapeOnScreen(page, "shape:loose")).toBeVisible();
  const before = (await roomRecords(engine, "default")).filter((record) => ["shape:photo", "shape:on-photo", "shape:loose"].includes(record.id));

  // Clear of the mark that sits on it.
  const photo = (await shapeOnScreen(page, "shape:photo").boundingBox())!;
  await page.mouse.click(photo.x + photo.width - 10, photo.y + photo.height - 10);
  await clickShape(page, "shape:loose", ["Shift"]);
  await openComposer(page);
  await expect(badge(page, "shape:photo")).toHaveText("image 1");
  await expect(badge(page, "sketch")).toHaveText("image 2");
  const looseBox = (await shapeOnScreen(page, "shape:loose").boundingBox())!;
  const sketchBadge = (await badge(page, "sketch").boundingBox())!;
  expect(sketchBadge.x).toBeCloseTo(looseBox.x, 0);

  await page.keyboard.type("make it neon");
  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(1);
  const refs = generation.requests[0]!.body.input_references.map((ref: any) => ref.image_url.url);
  expect(refs).toHaveLength(2);
  // The composite is at the file's own resolution; the sketch's longer side is 1024 pixels.
  expect(pngSize(refs[0])).toEqual({ w: 400, h: 200 });
  const sketch = pngSize(refs[1]);
  expect(Math.max(sketch.w, sketch.h)).toBe(1024);

  const folder = join(engine.dataDir, "output", "default");
  const names = await readdir(folder);
  const composite = names.find((name) => /^\d+-composite-\d+-photo\.png$/.test(name))!;
  const sketchFile = names.find((name) => /^\d+-sketch\.png$/.test(name))!;
  expect(composite).toBeDefined();
  expect(sketchFile).toBeDefined();
  const compositeSidecar = JSON.parse(await readFile(join(folder, composite.replace(/\.png$/, ".json")), "utf8"));
  expect(compositeSidecar).toMatchObject({ source: "composite", of: file, marks: ["shape:on-photo"], crop: null });
  const sketchSidecar = JSON.parse(await readFile(join(folder, sketchFile.replace(/\.png$/, ".json")), "utf8"));
  expect(sketchSidecar).toMatchObject({ source: "sketch", marks: ["shape:loose"], crop: null });
  expect(sketchSidecar.of).toBeUndefined();

  // The recipe records the files that were sent.
  await expect.poll(async () => (await roomRecords(engine, "default")).some((record) => record.meta?.unframed?.result?.sidecar)).toBe(true);
  const result = (await roomRecords(engine, "default")).find((record) => record.meta?.unframed?.result?.sidecar)!;
  const sidecar = JSON.parse(await readFile(join(folder, result.meta.unframed.result.sidecar), "utf8"));
  expect(sidecar.recipe.references).toEqual([
    { kind: "image", file: composite, original: file },
    { kind: "image", file: sketchFile },
  ]);

  // The canvas image stays clean and the marks stay editable shapes.
  const after = (await roomRecords(engine, "default")).filter((record) => ["shape:photo", "shape:on-photo", "shape:loose"].includes(record.id));
  expect(after).toEqual(before);
});
