import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { emptyMedia, groupRecord, putRecords } from "./media.ts";

const label = (page: Page, id: string) => shapeOnScreen(page, id).locator(".unframed-shape-label");

/** Zooms one step about the centre of the view and lets the animation finish. */
const zoomStep = async (page: Page, key: "-" | "=") => {
  await page.keyboard.press(key);
  await page.waitForTimeout(450);
};

test("labels always show from 75 %, show only on hover or selection from 50 %, and never below 50 %", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [emptyMedia("shape:image", "image", "150", { x: 440, y: 60 }), groupRecord("shape:group", "160", { x: 440, y: 300 }, { w: 300, h: 200 })]);
  const all = ["shape:starter-subject", "shape:starter-scene", "shape:image", "shape:group"];
  for (const id of all) await expect(label(page, id)).toBeVisible();
  await expect(label(page, "shape:starter-subject")).toHaveText("@100");
  await expect(label(page, "shape:group")).toHaveText("@160");

  await zoomStep(page, "-");
  for (const id of all) await expect(label(page, id)).toBeHidden();
  const scene = await centre(shapeOnScreen(page, "shape:starter-scene"));
  await page.mouse.click(scene.x, scene.y);
  const subject = await centre(shapeOnScreen(page, "shape:starter-subject"));
  await page.mouse.move(subject.x, subject.y);
  await expect(label(page, "shape:starter-subject")).toBeVisible();
  await expect(label(page, "shape:starter-scene")).toBeVisible();
  await expect(label(page, "shape:image")).toBeHidden();

  await zoomStep(page, "-");
  const hovered = await centre(shapeOnScreen(page, "shape:starter-subject"));
  await page.mouse.move(hovered.x, hovered.y);
  for (const id of all) await expect(label(page, id)).toBeHidden();

  await zoomStep(page, "=");
  await zoomStep(page, "=");
  for (const id of all) await expect(label(page, id)).toBeVisible();
});
