import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { BRIDGE_TAG } from "@unframed/domain";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { artifactShape, filledArtifact, projectPath, writeBridge } from "./artifacts.ts";
import { filledMedia, putRecords } from "./media.ts";
import { pngBytes } from "./images.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style>${BRIDGE_TAG}</head><body><main><h1 data-hf-id="hf-head">Welcome</h1><img data-hf-id="hf-pic1" alt="Hero picture" src="old.png" width="200" height="120" style="display:block"></main></body></html>`;

const PAGE_AT = { x: -520, y: -40 };
const PHOTO_AT = { x: -120, y: 300 };

const outline = (page: Page): Locator => page.locator("[data-drop-outline]");

const pageFile = async (engine: TestEngine): Promise<string | undefined> => (await roomShapes(engine, "default", "page")).find((record) => record.id === "shape:landing")?.props?.file;

const photoAt = async (engine: TestEngine): Promise<{ x: number; y: number } | undefined> => {
  const record = (await roomShapes(engine, "default", "image")).find((shape) => shape.id === "shape:photo");
  return record === undefined ? undefined : { x: record.x ?? 0, y: record.y ?? 0 };
};

const onBoard = async (page: Page, engine: TestEngine, locked: string[] = []) => {
  await openCanvas(page, engine);
  await writeBridge(engine);
  const { file } = await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: PAGE_AT, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  if (locked.length > 0) {
    const shape = artifactShape({ id: "shape:landing", kind: "page", ref: "150", at: PAGE_AT, size: { w: 400, h: 260 }, title: "Landing", file });
    await putRecords(engine, [{ ...shape, props: { ...shape.props, lockedElements: locked } }]);
  }
  await filledMedia(engine, { id: "shape:photo", type: "image", ref: "160", at: PHOTO_AT, bytes: pngBytes(800, 400), name: "photo.png", mime: "image/png", natural: { w: 800, h: 400 }, width: 160 });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await expect(shapeOnScreen(page, "shape:photo")).toBeVisible();
};

const selectPage = async (page: Page) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.click(at.x, at.y);
  await expect(shapeOnScreen(page, "shape:landing").frameLocator("iframe[data-artifact-frame]").locator("img[alt='Hero picture']")).toBeVisible({ timeout: 20_000 });
};

const pictureCentre = async (page: Page) => {
  const picture = shapeOnScreen(page, "shape:landing").frameLocator("iframe[data-artifact-frame]").locator("img[alt='Hero picture']");
  const box = (await picture.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const dragPhotoTo = async (page: Page, to: { x: number; y: number }) => {
  const from = await centre(shapeOnScreen(page, "shape:photo"));
  await page.mouse.move(from.x - 2, from.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
};

test("dragging an image over a selected page outlines the picture under the pointer; the drop swaps it in one undo step and puts the image back", async ({ page, agent }) => {
  await onBoard(page, agent);
  const before = await pageFile(agent);
  const start = await photoAt(agent);
  await selectPage(page);

  await dragPhotoTo(page, await pictureCentre(page));
  await expect(outline(page)).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
  await expect(outline(page)).toHaveCount(0);

  await expect.poll(() => photoAt(agent), { timeout: 4000 }).toEqual(start);
  await expect.poll(async () => {
    const file = await pageFile(agent);
    return file === undefined || file === before ? "" : await readFile(projectPath(agent, file), "utf8");
  }, { timeout: 8000 }).toMatch(/<img[^>]*src="[^"]*photo[^"]*"/i);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => pageFile(agent), { timeout: 8000 }).toBe(before);
  await expect.poll(() => photoAt(agent), { timeout: 4000 }).toEqual(start);
});

test("a drop off any picture is an ordinary move, and a locked picture is no target", async ({ page, agent }) => {
  await onBoard(page, agent);
  const before = await pageFile(agent);
  const start = await photoAt(agent);
  await selectPage(page);

  const from = await centre(shapeOnScreen(page, "shape:photo"));
  await dragPhotoTo(page, { x: from.x + 600, y: from.y });
  await expect(outline(page)).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(async () => (await photoAt(agent))?.x, { timeout: 4000 }).not.toBe(start?.x);
  expect(await pageFile(agent)).toBe(before);
});

test("a locked picture is no drop target", async ({ page, agent }) => {
  await onBoard(page, agent, ["hf-pic1"]);
  const before = await pageFile(agent);
  const start = await photoAt(agent);
  await selectPage(page);

  await dragPhotoTo(page, await pictureCentre(page));
  await page.waitForTimeout(400);
  await expect(outline(page)).toHaveCount(0);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  expect(await pageFile(agent)).toBe(before);
  expect(await photoAt(agent)).not.toEqual(start);
});
