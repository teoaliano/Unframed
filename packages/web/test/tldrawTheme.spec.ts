import type { Locator } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { expectToken, inBothSchemes, styleOf, tokenColor } from "./kit.ts";

const afterStyle = (locator: Locator, property: string) =>
  locator.evaluate((element, name) => getComputedStyle(element, "::after").getPropertyValue(name), property);

test("tldraw's toolbar, the Design panel, zoom controls, menus and shortcuts dialog take the kit's tokens, font and radii", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const subject = await centre(shapeOnScreen(page, "shape:starter-subject"));
  await page.mouse.click(subject.x, subject.y);
  // tldraw's tools sit in Unframed's one bottom bar, which carries the panel fill.
  const toolbar = page.getByTestId("bottom-toolbar");
  const selectTool = page.getByTestId("tools.select");
  const stylePanel = page.getByTestId("design-panel");
  await expect(stylePanel).toBeVisible();

  await inBothSchemes(page, async () => {
    await expectToken(toolbar, "background-color", "--bottom-toolbar-surface");
    await expect(selectTool).toHaveAttribute("aria-pressed", "true");
    expect(await afterStyle(selectTool, "background-color")).toBe(await tokenColor(page, "--tldraw-selected"));
    expect(await afterStyle(selectTool, "border-top-left-radius")).toBe("8px");
    await expectToken(stylePanel, "background-color", "--design-panel-surface");
    expect(await styleOf(stylePanel, "border-top-left-radius")).toBe("0px");
    // tldraw's UI chrome is in the kit's system font; the canvas keeps tldraw's shape font.
    const kitFont = await styleOf(page.locator("body"), "font-family");
    expect(await styleOf(page.getByTestId("tools.select"), "font-family")).toBe(kitFont);
    expect((await styleOf(page.locator(".tl-container"), "--tl-font-sans")).trim()).toBe('"tldraw_sans", sans-serif');

    await page.getByTestId("minimap.zoom-menu-button").click();
    const zoomMenu = page.locator(".tlui-menu").filter({ has: page.getByRole("menuitem", { name: /^Zoom in/ }) });
    await expectToken(zoomMenu, "background-color", "--tldraw-panel");
    const row = zoomMenu.getByRole("menuitem", { name: /^Zoom in/ });
    await row.hover();
    expect(await afterStyle(row, "background-color")).toBe(await tokenColor(page, "--tldraw-muted-2"));
    await page.keyboard.press("Escape");

    await page.mouse.click(5, 400);
    await page.keyboard.press("ControlOrMeta+Alt+/");
    const dialog = page.locator(".tlui-dialog__content");
    await expect(dialog).toBeVisible();
    await expectToken(dialog, "background-color", "--tldraw-panel");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.mouse.click(subject.x, subject.y);
  });
});

test("tldraw's toolbar and menu icons are Lucide's", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const maskOf = (locator: import("@playwright/test").Locator) => locator.locator(".tlui-icon").first().evaluate((icon) => (icon as HTMLElement).style.mask || (icon as HTMLElement).style.webkitMask);
  for (const [tool, lucide] of [["select", "mouse-pointer-2"], ["hand", "hand"], ["draw", "pencil"], ["eraser", "eraser"], ["text", "type"]] as const) {
    expect(await maskOf(page.getByTestId(`tools.${tool}`))).toContain(encodeURIComponent(`lucide-${lucide}`));
  }
});
