import type { Page } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { groupRecord, putRecords } from "./media.ts";

const looks = (page: Page) =>
  page.evaluate(() => {
    const css = (selector: string, property: string) => getComputedStyle(document.querySelector(selector)!).getPropertyValue(property);
    return {
      body: css("body", "background-color"),
      grid: css(".unframed-dot-grid", "background-color"),
      card: css(".unframed-chrome-left", "background-color"),
      group: css(".unframed-group", "border-top-color"),
      tldraw: document.querySelector(".tl-container")!.classList.contains("tl-theme__dark") ? "dark" : "light",
      theme: document.documentElement.getAttribute("data-unframed-theme"),
    };
  });

test("light and dark tokens follow the OS, and tldraw's scheme follows with them", async ({ page, engine }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openCanvas(page, engine);
  await putRecords(engine, [groupRecord("shape:group", "160", { x: 440, y: 60 })]);
  await expect(page.locator(".unframed-group")).toBeVisible();

  await expect.poll(() => looks(page)).toEqual({
    body: "rgb(247, 247, 247)",
    grid: "rgb(247, 247, 247)",
    card: "color(srgb 1 1 1 / 0.88)",
    group: expect.any(String),
    tldraw: "light",
    theme: "light",
  });
  const lightGroup = (await looks(page)).group;

  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => looks(page)).toMatchObject({
    body: "rgb(26, 26, 26)",
    grid: "rgb(26, 26, 26)",
    card: "color(srgb 0.164706 0.164706 0.164706 / 0.88)",
    tldraw: "dark",
    theme: "dark",
  });
  expect((await looks(page)).group).not.toBe(lightGroup);
});
