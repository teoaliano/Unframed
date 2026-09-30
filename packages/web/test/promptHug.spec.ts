import type { Page } from "@playwright/test";
import { editorFocused, emptyCanvasPoint, openCanvas, plainText, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

const zoomReadout = (page: Page) => page.locator(".tlui-navigation-panel").getByRole("button").filter({ hasText: /%$/ }).first();

const zoomLevel = async (page: Page) => Number((await zoomReadout(page).innerText()).replace("%", "")) / 100;

/** The prompt's box in canvas units: its size on screen divided by the zoom. */
const canvasBox = async (page: Page, id: string) => {
  const zoom = await zoomLevel(page);
  const box = (await shapeOnScreen(page, id).locator("[data-testid='prompt']").boundingBox())!;
  return { w: box.width / zoom, h: box.height / zoom, zoom };
};

const makePrompt = async (page: Page, engine: Parameters<typeof openCanvas>[1], text: string) => {
  const point = await emptyCanvasPoint(page);
  await page.mouse.dblclick(point.x, point.y);
  await editorFocused(page);
  if (text) await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  return waitForRoom(engine, "default", (records) =>
    records.find((record) => record.type === "text" && record.id.startsWith("shape:") && !record.id.startsWith("shape:starter") && plainText(record) === text),
  );
};

test("a prompt hugs its text up to 320 canvas px, then wraps and grows down, the same at zoom 0.5 and 2", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const short = await makePrompt(page, engine, "a fox");
  const long = await makePrompt(page, engine, "a very long description of a red fox standing on a windswept cliff at golden hour with the sea below");

  /** The prompt's box at zoom 1, 0.5 and 2, zooming around it. */
  const atZooms = async (id: string) => {
    await shapeOnScreen(page, id).locator(".tl-rich-text").click();
    const boxes: Array<{ w: number; h: number; zoom: number }> = [];
    for (const keys of [["Shift+2", "Shift+0"], ["Minus"], ["Shift+0", "Equal"]]) {
      for (const key of keys) {
        await page.keyboard.press(key);
        await page.waitForTimeout(450);
      }
      boxes.push(await canvasBox(page, id));
    }
    await page.keyboard.press("Shift+0");
    await page.keyboard.press("Escape");
    return boxes;
  };
  const shortBoxes = await atZooms(short.id);
  const longBoxes = await atZooms(long.id);
  expect(shortBoxes.map((box) => box.zoom)).toEqual([1, 0.5, 2]);
  expect(longBoxes.map((box) => box.zoom)).toEqual([1, 0.5, 2]);
  const measured = shortBoxes.map((box, index) => ({ short: box, long: longBoxes[index]! }));

  const [atOne, atHalf, atTwo] = measured;
  expect(atOne!.short.w).toBeGreaterThanOrEqual(40);
  expect(atOne!.short.w).toBeLessThan(120);
  expect(atOne!.long.w).toBeCloseTo(320, 0);
  expect(atOne!.long.h).toBeGreaterThan(atOne!.short.h * 2);
  for (const other of [atHalf!, atTwo!]) {
    expect(other.short.w).toBeCloseTo(atOne!.short.w, 0);
    expect(other.short.h).toBeCloseTo(atOne!.short.h, 0);
    expect(other.long.w).toBeCloseTo(atOne!.long.w, 0);
    expect(other.long.h).toBeCloseTo(atOne!.long.h, 0);
  }

  // The short text is on one line, never wrapped inside its own hug; the long one takes several.
  expect(atOne!.short.h).toBeLessThan(40);
  expect(atOne!.long.h).toBeGreaterThan(60);
});

test("an empty prompt is measured from its hint, fully readable, and never smaller than 40 by 28", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const empty = await makePrompt(page, engine, "");
  await page.keyboard.press("Shift+0");
  const hint = shapeOnScreen(page, empty.id).locator("[data-testid='prompt-hint']");
  await expect(hint).toHaveText("Add text…");
  const fits = await hint.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1);
  expect(fits).toBe(true);
  const box = await canvasBox(page, empty.id);
  expect(box.w).toBeGreaterThanOrEqual(40);
  expect(box.h).toBeGreaterThanOrEqual(28);
});
