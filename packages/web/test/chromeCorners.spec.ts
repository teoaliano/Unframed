import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

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
