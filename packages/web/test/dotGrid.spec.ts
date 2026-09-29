import type { Page } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

const grid = async (page: Page) =>
  page.locator("[data-testid='dot-grid']").evaluate((element) => {
    const style = getComputedStyle(element);
    return { size: style.backgroundSize, image: style.backgroundImage, position: style.backgroundPosition };
  });

const zoomStep = async (page: Page, key: "-" | "=") => {
  await page.keyboard.press(key);
  await page.waitForTimeout(450);
};

test("the dot grid doubles its gap while it is under 16 screen px, never shrinks it zooming in, and keeps 1.1 px dots", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await expect(page.locator("[data-testid='dot-grid']")).toHaveCount(1);
  const atOne = await grid(page);
  expect(atOne.size).toBe("26px 26px");
  expect(atOne.image).toContain("0.55px");

  await zoomStep(page, "-"); // 50 %: 13 px would be too tight, so 52 canvas px, 26 on screen
  expect((await grid(page)).size).toBe("26px 26px");
  await zoomStep(page, "-"); // 25 %: 104 canvas px
  expect((await grid(page)).size).toBe("26px 26px");
  await zoomStep(page, "-"); // 10 %: 208 canvas px, 20.8 on screen
  expect(parseFloat((await grid(page)).size)).toBeCloseTo(20.8, 1);

  for (let step = 0; step < 3; step++) await zoomStep(page, "=");
  await zoomStep(page, "="); // 200 %: the gap stays 26 canvas px
  expect((await grid(page)).size).toBe("52px 52px");
  expect((await grid(page)).image).toContain("0.55px");

  // Panning moves the dots with the canvas.
  const before = (await grid(page)).position;
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 30);
  await expect.poll(async () => (await grid(page)).position).not.toBe(before);
});
