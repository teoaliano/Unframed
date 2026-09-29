import type { Locator } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { expectToken, inBothSchemes, styleOf, tokenColor } from "./kit.ts";

const afterStyle = (locator: Locator, property: string) =>
  locator.evaluate((element, name) => getComputedStyle(element, "::after").getPropertyValue(name), property);

test("tldraw's toolbar, style panel, zoom controls, menus and shortcuts dialog take the kit's tokens, font and radii", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const subject = await centre(shapeOnScreen(page, "shape:starter-subject"));
  await page.mouse.click(subject.x, subject.y);
  const toolbar = page.locator(".tlui-main-toolbar__tools");
  const selectTool = page.getByTestId("tools.select");
  const stylePanel = page.locator(".tlui-style-panel__wrapper");
  await expect(stylePanel).toBeVisible();

  await inBothSchemes(page, async () => {
    await expectToken(toolbar, "background-color", "--popover");
    await expect(selectTool).toHaveAttribute("aria-pressed", "true");
    expect(await afterStyle(selectTool, "background-color")).toBe(await tokenColor(page, "--primary"));
    expect(await afterStyle(selectTool, "border-top-left-radius")).toBe("8px");
    await expectToken(stylePanel, "background-color", "--popover");
    // The style panel's buttons share the kit control radius with the toolbar's.
    expect(await afterStyle(stylePanel.locator(".tlui-button").first(), "border-top-left-radius")).toBe("8px");
    expect(await styleOf(stylePanel, "border-top-left-radius")).toBe("14px");
    // tldraw's UI chrome is in the kit's system font; the canvas keeps tldraw's shape font.
    const kitFont = await styleOf(page.locator("body"), "font-family");
    expect(await styleOf(page.getByTestId("tools.select"), "font-family")).toBe(kitFont);
    expect((await styleOf(page.locator(".tl-container"), "--tl-font-sans")).trim()).toBe('"tldraw_sans", sans-serif');

    await page.getByTestId("minimap.zoom-menu-button").click();
    const zoomMenu = page.locator(".tlui-menu").filter({ has: page.getByRole("menuitem", { name: /^Zoom in/ }) });
    await expectToken(zoomMenu, "background-color", "--popover");
    const row = zoomMenu.getByRole("menuitem", { name: /^Zoom in/ });
    await row.hover();
    expect(await afterStyle(row, "background-color")).toBe(await tokenColor(page, "--accent"));
    await page.keyboard.press("Escape");

    await page.mouse.click(5, 400);
    await page.keyboard.press("ControlOrMeta+Alt+/");
    const dialog = page.locator(".tlui-dialog__content");
    await expect(dialog).toBeVisible();
    await expectToken(dialog, "background-color", "--popover");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.mouse.click(subject.x, subject.y);
  });
});
