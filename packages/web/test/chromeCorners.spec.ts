import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { emptyMedia, putRecords } from "./media.ts";
import { expectSlot, inBothSchemes, resolvedColor, styleOf, tokenColor } from "./kit.ts";

const HELP = "Reference a prompt or group with @id. Select images to number them, then type “image 1”.";

test("the top-right card ends with Help, whose tooltip explains references", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const card = page.locator(".unframed-chrome-right");
  await expect(card).toHaveCount(1);
  const help = card.getByRole("button", { name: "Help" });
  await expect(help).toBeVisible();
  await help.hover();
  await expect(page.getByText(HELP, { exact: true })).toBeVisible();
});

test("the corner cards are glass with the kit's border and radius, and Help is a kit ghost button with a kit tooltip", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const cards = [page.locator(".unframed-chrome-left"), page.locator(".unframed-chrome-right")];
  const help = page.locator(".unframed-chrome-right").getByRole("button", { name: "Help" });
  // A Button rendered as a kit tooltip's trigger carries the trigger's slot, as in t3code.
  await expectSlot(help, "tooltip-trigger");
  await inBothSchemes(page, async () => {
    const glass = await resolvedColor(page, "color-mix(in srgb, var(--background) var(--glass-opacity), transparent)");
    for (const card of cards) {
      await expect.poll(() => styleOf(card, "background-color")).toBe(glass);
      expect(await styleOf(card, "border-top-color")).toBe(await tokenColor(page, "--color-border"));
      expect(await styleOf(card, "border-top-left-radius")).toBe("14px");
      expect(await styleOf(card, "backdrop-filter")).toMatch(/^blur\(/);
    }
    // A ghost button: transparent until hovered, then the accent fill.
    expect(await styleOf(help, "background-color")).toBe("rgba(0, 0, 0, 0)");
    await help.hover();
    await expect.poll(async () => (await styleOf(help, "background-color")) === (await tokenColor(page, "--accent"))).toBe(true);
    const tip = page.locator("[data-slot='tooltip-popup']").filter({ hasText: HELP });
    await expect(tip).toBeVisible();
    expect(await styleOf(tip, "background-color")).toBe(await tokenColor(page, "--popover"));
    await page.mouse.move(5, 500);
    await expect(tip).toHaveCount(0);
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

test("tldraw's style panel shows below the corner cards, never under them", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const subject = await centre(shapeOnScreen(page, "shape:starter-subject"));
  await page.mouse.click(subject.x, subject.y);
  const panel = page.locator(".tlui-style-panel");
  await expect(panel).toBeVisible();
  const panelBox = (await panel.boundingBox())!;
  const card = (await page.locator(".unframed-chrome-right").boundingBox())!;
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
