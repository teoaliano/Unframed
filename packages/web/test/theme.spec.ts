import type { Page } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { resolvedColor, tokenColor, tokenRgb } from "./kit.ts";
import { groupRecord, putRecords } from "./media.ts";
import { openSettings, showSection } from "./settings.ts";

const looks = (page: Page) =>
  page.evaluate(() => {
    const css = (selector: string, property: string) => getComputedStyle(document.querySelector(selector)!).getPropertyValue(property);
    return {
      body: css("body", "background-color"),
      grid: css("[data-testid='dot-grid']", "background-color"),
      card: css("[data-slot='top-bar-body']", "background-color"),
      group: css("[data-testid='group-frame']", "border-top-color"),
      tldraw: document.querySelector(".tl-container")!.classList.contains("tl-theme__dark") ? "dark" : "light",
      theme: document.documentElement.getAttribute("data-unframed-theme"),
    };
  });

/**
 * What spec 12 says each surface is: the body on --surface-background (in sRGB, the format
 * the shell reads), the grid and the top bar opaque on their own surface tokens.
 */
const expected = async (page: Page, theme: "light" | "dark") => ({
  body: await tokenRgb(page, "--surface-background"),
  grid: await tokenColor(page, "--dot-grid-surface"),
  card: await resolvedColor(page, "var(--top-bar-surface)"),
  group: expect.any(String),
  tldraw: theme,
  theme,
});

test("light and dark tokens follow the OS, and tldraw's scheme follows with them", async ({ page, engine }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openCanvas(page, engine);
  await putRecords(engine, [groupRecord("shape:group", "160", { x: 440, y: 60 })]);
  await expect(page.getByTestId("group-frame")).toBeVisible();

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

const shown = (page: Page) =>
  page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-unframed-theme"),
    tldraw: document.querySelector(".tl-container")!.classList.contains("tl-theme__dark") ? "dark" : "light",
    body: getComputedStyle(document.body).backgroundColor,
  }));

test("the General settings' Theme choice overrides the OS until set back to System, and survives a reload", async ({ page, engine }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openCanvas(page, engine);
  const dialog = await openSettings(page);
  await showSection(dialog, "General");
  const select = dialog.getByRole("combobox", { name: "Theme" });
  await expect(select).toHaveText("System");
  await select.click();
  await expect(page.getByRole("option")).toHaveText(["System", "Light", "Dark"]);
  await page.getByRole("option", { name: "Dark" }).click();
  await expect(select).toHaveText("Dark");
  await expect.poll(() => shown(page)).toEqual({ theme: "dark", tldraw: "dark", body: expect.any(String) });
  expect((await shown(page)).body).toBe(await tokenRgb(page, "--surface-background"));
  await expect.poll(async () => (await (await engine.rpc()).call("preferences.get", { keys: ["app.theme"] })).values["app.theme"]).toBe("dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await select.click();
  await page.getByRole("option", { name: "Light" }).click();
  await expect.poll(() => shown(page)).toEqual({ theme: "light", tldraw: "light", body: await tokenRgb(page, "--surface-background") });

  await page.reload();
  await expect(page.locator(".tl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await shown(page)).tldraw).toBe("light");
  expect((await shown(page)).theme).toBe("light");

  const again = await openSettings(page);
  await showSection(again, "General");
  await again.getByRole("combobox", { name: "Theme" }).click();
  await page.getByRole("option", { name: "System" }).click();
  await expect.poll(async () => (await shown(page)).tldraw).toBe("dark");
  expect((await shown(page)).theme).toBe("dark");
});
