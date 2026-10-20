import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { emptyMedia, putRecords } from "./media.ts";
import { expectSlot, inBothSchemes, resolvedColor, styleOf, tokenColor } from "./kit.ts";
import { platformOf } from "./platform.ts";

test("the top-left card holds the logo; Settings sits at the end opposite the window controls; the right hook stays in the page; there is no Help", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const os = await platformOf(page);
  const left = page.locator(".unframed-chrome-left");
  await expect(left.getByRole("img", { name: "Unframed" })).toBeVisible();
  const settings = page.getByRole("button", { name: /^(Settings|Add your API key)$/ });
  await expect(settings).toHaveCount(1);
  // Spec 17: macOS and Linux keep Settings at the far right, Windows at the far left, before the logo.
  expect(await page.locator(os.name === "win32" ? ".unframed-chrome-left" : ".unframed-chrome-right").getByRole("button", { name: /^(Settings|Add your API key)$/ }).count()).toBe(1);
  // Spec 01: the shell's CSS expects exactly one right card.
  await expect(page.locator(".unframed-chrome-right")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Help" })).toHaveCount(0);
});

test("the bar's start sits at the window edge, 48 tall; the lights' zone is 78 px, the logo 20 px into the bar", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const card = page.locator(".unframed-chrome-left");
  const box = (await card.boundingBox())!;
  // The reference (the user's prototype): the bar is 48 px tall, its start is 14 px in from the window edge and the
  // three lights are 52 px wide with 12 px to the bar, so the start region is 78 px before the logo's 20 px padding.
  expect([box.x, box.y, box.height]).toEqual([0, 0, 48]);
  const logo = (await card.getByRole("img", { name: "Unframed" }).boundingBox())!;
  expect([logo.width, logo.height]).toEqual([24, 24]);
  expect(logo.x).toBe(78 + 20);
  const strip = (await page.getByTestId("tab-strip").boundingBox())!;
  expect(strip.height).toBe(48);
  expect(strip.y + strip.height / 2).toBe(24);
  const settings = (await page.getByRole("button", { name: /^(Settings|Add your API key)$/ }).boundingBox())!;
  // The reference's Settings is a 32 px circle, 12 px past the bar's end and 14 px from the window edge.
  expect([settings.width, settings.height]).toEqual([32, 32]);
  expect(settings.y + settings.height / 2).toBe(24);
  const right = await page.locator(".unframed-chrome-right").evaluate((element) => ({ top: getComputedStyle(element).top, right: getComputedStyle(element).right }));
  expect(right).toEqual({ top: "0px", right: "0px" });
});

test("the bar's outline is the reference's flares and corners; Settings is a circle with a kit ghost button and a kit tooltip", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const bar = page.locator("[data-slot=top-bar-body] path").first();
  const cell = page.locator("[data-slot=top-bar-settings]");
  const settings = page.getByRole("button", { name: /^(Settings|Add your API key)$/ });
  await expectSlot(settings, "tooltip-trigger");
  await inBothSchemes(page, async () => {
    expect(await styleOf(bar, "fill")).toBe(await resolvedColor(page, "var(--background)"));
    // A circle: the radius reaches half the 32 px diameter (the browser reports a fully rounded corner as a huge value).
    expect(parseFloat(await styleOf(cell, "border-top-left-radius"))).toBeGreaterThanOrEqual(16);
  });
});

test("the toolbar names text Prompt and frame Group, and the zoom controls sit bottom left", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await expect(page.getByTestId("tools.text")).toHaveAttribute("aria-label", /^Prompt/);
  const frame = page.locator("[data-testid='tools.frame'], [data-testid='tools.more.frame']");
  if ((await frame.count()) === 0) await page.getByTestId("tools.more-button").click();
  await expect(frame.first()).toHaveAttribute("aria-label", /^Group/);
  await page.keyboard.press("Escape");

  const zoom = page.getByTestId("minimap.zoom-menu-button");
  await expect(zoom).toBeVisible();
  const box = (await zoom.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeLessThan(viewport.width / 4);
  expect(box.y).toBeGreaterThan(viewport.height * 0.75);
  await zoom.click();
  for (const item of ["Zoom in", "Zoom out", "Zoom to fit"]) await expect(page.getByRole("menuitem", { name: new RegExp(`^${item}`) })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-testid='main-menu.button'], [data-testid='page-menu.button'], [data-testid='help-menu.button']")).toHaveCount(0);
  await expect(page.locator(".tlui-share-zone, .tlui-debug-panel")).toHaveCount(0);
});

test("tldraw's style panel shows below the top of the page, clear of the corner card", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const subject = await centre(shapeOnScreen(page, "shape:starter-subject"));
  await page.mouse.click(subject.x, subject.y);
  const panel = page.locator(".tlui-style-panel");
  await expect(panel).toBeVisible();
  const panelBox = (await panel.boundingBox())!;
  const card = (await page.locator(".unframed-chrome-left").boundingBox())!;
  expect(panelBox.y).toBeGreaterThanOrEqual(card.y + card.height);
});

test("tldraw's style panel shows only while a drawing tool is on or the selection has styles", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [emptyMedia("shape:still", "image", "180", { x: -400, y: 300 })]);
  const panel = page.locator(".tlui-style-panel");
  await expect(panel).toHaveCount(0);
  // A prompt is tldraw text: its font and size are styles.
  const subject = await centre(shapeOnScreen(page, "shape:starter-subject"));
  await page.mouse.click(subject.x, subject.y);
  await expect(panel).toBeVisible();
  const still = (await shapeOnScreen(page, "shape:still").boundingBox())!;
  await page.mouse.click(still.x + 12, still.y + 12);
  await expect(panel).toHaveCount(0);
  await page.getByTestId("tools.draw").click();
  await expect(panel).toBeVisible();
  await page.getByTestId("tools.select").click();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});
