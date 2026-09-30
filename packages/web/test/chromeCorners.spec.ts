import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { emptyMedia, putRecords } from "./media.ts";
import { expectSlot, inBothSchemes, resolvedColor, styleOf, tokenColor } from "./kit.ts";

test("the top-left card holds the logo, the project menu and Settings; the right hook stays in the page, empty; there is no Help", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const left = page.locator(".unframed-chrome-left");
  await expect(left.getByRole("img", { name: "Unframed" })).toBeVisible();
  await expect(left.getByRole("button", { name: /^(Settings|Add your API key)$/ })).toBeVisible();
  // Spec 01: the shell's CSS expects exactly one right card; it holds nothing now.
  await expect(page.locator(".unframed-chrome-right")).toHaveCount(1);
  await expect(page.locator(".unframed-chrome-right").locator("*")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Help" })).toHaveCount(0);
});

test("the top-left card sits at 8, 8, is 44 tall with 5 of padding and 8 between items, and centres every item at y 30", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const card = page.locator(".unframed-chrome-left");
  const box = (await card.boundingBox())!;
  expect([box.x, box.y, box.height]).toEqual([8, 8, 44]);
  expect(await styleOf(card, "padding")).toBe("5px");
  expect(await styleOf(card, "column-gap")).toBe("8px");
  const logo = (await card.getByRole("img", { name: "Unframed" }).boundingBox())!;
  expect([logo.width, logo.height]).toEqual([24, 24]);
  expect(logo.x).toBe(8 + 1 + 5);
  const project = (await card.getByRole("button", { name: "Project", exact: true }).boundingBox())!;
  const settings = (await card.getByRole("button", { name: /^(Settings|Add your API key)$/ }).boundingBox())!;
  expect([project.height, settings.width, settings.height]).toEqual([32, 32, 32]);
  for (const item of [logo, project, settings]) expect(item.y + item.height / 2).toBe(30);
  const right = await page.locator(".unframed-chrome-right").evaluate((element) => ({ top: getComputedStyle(element).top, right: getComputedStyle(element).right }));
  expect(right).toEqual({ top: "8px", right: "8px" });
});

test("the top-left card is glass with the kit's border and radius, and Settings is a kit ghost button with a kit tooltip", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const card = page.locator(".unframed-chrome-left");
  const settings = card.getByRole("button", { name: /^(Settings|Add your API key)$/ });
  await expectSlot(settings, "tooltip-trigger");
  await inBothSchemes(page, async () => {
    const glass = await resolvedColor(page, "color-mix(in srgb, var(--background) var(--glass-opacity), transparent)");
    await expect.poll(() => styleOf(card, "background-color")).toBe(glass);
    expect(await styleOf(card, "border-top-color")).toBe(await tokenColor(page, "--color-border"));
    expect(await styleOf(card, "border-top-left-radius")).toBe("14px");
    expect(await styleOf(card, "backdrop-filter")).toMatch(/^blur\(/);
    await page.mouse.move(5, 500);
    await expect.poll(() => styleOf(settings, "background-color")).toBe("rgba(0, 0, 0, 0)");
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
