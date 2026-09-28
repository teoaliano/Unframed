import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { emptyCanvasPoint, openCanvas, plainText, roomRecords, shapeOnScreen, toast, waitForRoom, type AnyRecord } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { emptyMedia, putRecords } from "./media.ts";

const clipPath = fileURLToPath(new URL("./media/clip.webm", import.meta.url));

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** Puts a PNG (and nothing else) on the system clipboard, as a screenshot tool would. */
const clipboardImage = (page: Page, png: Buffer) =>
  page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
  }, png.toString("base64"));

const clipboardText = (page: Page, text: string) => page.evaluate((value) => navigator.clipboard.writeText(value), text);

/**
 * A file paste the system clipboard API cannot carry (a clip): the paste event holds the
 * file, as when a person copies a file in the OS file manager.
 */
const pasteFileEvent = (page: Page, file: { name: string; mime: string; bytes: Buffer }) =>
  page.evaluate(async ({ name, mime, base64 }) => {
    await navigator.clipboard.writeText(" ");
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], name, { type: mime }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, { name: file.name, mime: file.mime, base64: file.bytes.toString("base64") });

/** Moves the pointer onto a canvas point with a small approach, as a hand would. */
const hover = async (page: Page, point: { x: number; y: number }) => {
  await page.mouse.move(point.x - 30, point.y - 20);
  await page.mouse.move(point.x - 10, point.y - 5, { steps: 3 });
  await page.mouse.move(point.x, point.y, { steps: 2 });
};

/** A click on an empty media card away from its buttons. */
const clickCard = async (page: Page, id: string, shift = false) => {
  const box = (await shapeOnScreen(page, id).locator(".unframed-media-empty").boundingBox())!;
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 12, box.y + 12);
  if (shift) await page.keyboard.up("Shift");
};

const newShapes = async (page: Page, engine: Parameters<typeof roomRecords>[0], before: Set<string>, type: string) =>
  (await roomRecords(engine, "default")).filter((record) => record.typeName === "shape" && record.type === type && !before.has(record.id));

test.describe("pasting from the system clipboard", () => {
  test("a screenshot becomes an image at the pointer, named from its type when it has no name", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const point = await emptyCanvasPoint(page);
    await hover(page, point);
    const ids = new Set((await roomRecords(engine, "default")).map((record) => record.id));
    await clipboardImage(page, pngBytes(300, 150));
    await page.keyboard.press("ControlOrMeta+v");
    const [image] = await waitForRoom(engine, "default", (records) => {
      const found = records.filter((record) => record.typeName === "shape" && record.type === "image" && !ids.has(record.id));
      return found.length === 1 ? found : undefined;
    });
    const shape = image!;
    const asset = (await roomRecords(engine, "default")).find((record) => record.id === shape.props.assetId)!;
    expect(String(asset.props.src)).toMatch(/^project-file:\d+-pasted-image\.png$/);
    expect(shape.props).toMatchObject({ w: 240, h: 120 });
    const box = (await shapeOnScreen(page, shape.id).locator(".tl-html-container").first().boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - point.x)).toBeLessThan(30);
    expect(Math.abs(box.y + box.height / 2 - point.y)).toBeLessThan(30);
  });

  test("a pasted picture replaces the media of every selected image", async ({ page, engine }) => {
    await openCanvas(page, engine);
    await putRecords(engine, [emptyMedia("shape:one", "image", "150", { x: 440, y: 60 }), emptyMedia("shape:two", "image", "151", { x: 440, y: 240 })]);
    await clickCard(page, "shape:one");
    await clickCard(page, "shape:two", true);
    await clipboardImage(page, pngBytes(200, 100));
    await page.keyboard.press("ControlOrMeta+v");
    const filled = await waitForRoom(engine, "default", (records) => {
      const both = ["shape:one", "shape:two"].map((id) => records.find((record) => record.id === id)!);
      return both.every((record) => record.props.assetId) ? both : undefined;
    });
    expect(filled[0]!.props.assetId).toBe(filled[1]!.props.assetId);
    expect(filled.map((record) => [record.props.w, record.props.h])).toEqual([
      [240, 120],
      [240, 120],
    ]);
    expect((await roomRecords(engine, "default")).filter((record) => record.typeName === "shape" && record.type === "image")).toHaveLength(2);
  });

  test("a pasted clip becomes a video, and one over 25 MB is refused with a toast", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const point = await emptyCanvasPoint(page);
    await hover(page, point);
    const ids = new Set((await roomRecords(engine, "default")).map((record) => record.id));
    await pasteFileEvent(page, { name: "waves.webm", mime: "video/webm", bytes: await readFile(clipPath) });
    await waitForRoom(engine, "default", (records) => records.find((record) => record.typeName === "shape" && record.type === "video" && !ids.has(record.id) && record.props.assetId));
    await pasteFileEvent(page, { name: "huge.mp4", mime: "video/mp4", bytes: Buffer.alloc(26_214_401) });
    await expect(toast(page, "Video is too large. Keep it under 25MB.")).toBeVisible();
    expect(await newShapes(page, engine, ids, "video")).toHaveLength(1);
  });

  test("text becomes a prompt at the pointer, a clip link becomes a video, and any other link is text", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const point = await emptyCanvasPoint(page);
    await hover(page, point);
    const ids = new Set((await roomRecords(engine, "default")).map((record) => record.id));

    await clipboardText(page, "  a quiet harbour at dawn  ");
    await page.keyboard.press("ControlOrMeta+v");
    const prompt = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "text" && !ids.has(record.id)));
    expect(plainText(prompt)).toBe("a quiet harbour at dawn");
    expect(prompt.meta.ref).toBe("102");

    await clipboardText(page, "https://cdn.example.com/clips/Fox.MP4?sig=1");
    await page.keyboard.press("ControlOrMeta+v");
    const video = await waitForRoom(engine, "default", (records) => records.find((record) => record.typeName === "shape" && record.type === "video" && !ids.has(record.id)));
    const asset = (await roomRecords(engine, "default")).find((record) => record.id === video.props.assetId)!;
    expect(asset.props).toMatchObject({ src: "https://cdn.example.com/clips/Fox.MP4?sig=1", name: "Fox.MP4" });

    await clipboardText(page, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.keyboard.press("ControlOrMeta+v");
    const link = await waitForRoom(engine, "default", (records) =>
      records.find((record: AnyRecord) => record.type === "text" && !ids.has(record.id) && plainText(record).startsWith("https://www.youtube")),
    );
    expect(link.type).toBe("text");
    expect((await roomRecords(engine, "default")).some((record) => record.type === "embed" || record.type === "bookmark")).toBe(false);
  });
});
