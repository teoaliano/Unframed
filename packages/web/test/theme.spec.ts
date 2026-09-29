import type { Page } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { resolvedColor, tokenColor } from "./kit.ts";
import { groupRecord, putRecords } from "./media.ts";

const looks = (page: Page) =>
  page.evaluate(() => {
    const css = (selector: string, property: string) => getComputedStyle(document.querySelector(selector)!).getPropertyValue(property);
    return {
      body: css("body", "background-color"),
      grid: css("[data-testid='dot-grid']", "background-color"),
      card: css(".unframed-chrome-left", "background-color"),
      group: css(".unframed-group", "border-top-color"),
      tldraw: document.querySelector(".tl-container")!.classList.contains("tl-theme__dark") ? "dark" : "light",
      theme: document.documentElement.getAttribute("data-unframed-theme"),
    };
  });

/** What spec 12 says each surface is: the body and grid on --background, the corner card in glass over it. */
const expected = async (page: Page, theme: "light" | "dark") => ({
  body: await tokenColor(page, "--background"),
  grid: await tokenColor(page, "--background"),
  card: await resolvedColor(page, "color-mix(in srgb, var(--background) var(--glass-opacity), transparent)"),
  group: expect.any(String),
  tldraw: theme,
  theme,
});

test("light and dark tokens follow the OS, and tldraw's scheme follows with them", async ({ page, engine }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openCanvas(page, engine);
  await putRecords(engine, [groupRecord("shape:group", "160", { x: 440, y: 60 })]);
  await expect(page.locator(".unframed-group")).toBeVisible();

  await expect.poll(async () => (await looks(page)).theme).toBe("light");
  expect(await looks(page)).toEqual(await expected(page, "light"));
  const light = await looks(page);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => (await looks(page)).tldraw).toBe("dark");
  const dark = await looks(page);
  expect(dark).toEqual(await expected(page, "dark"));
  expect(dark.body).not.toBe(light.body);
  expect(dark.group).not.toBe(light.group);
});
