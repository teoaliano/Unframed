import { emptyCanvasPoint, openCanvas, toast } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { inBothSchemes, resolvedColor, styleOf } from "./kit.ts";
import { dropFiles } from "./media.ts";

const MENU_GLASS = "color-mix(in srgb, var(--popover) 18%, color-mix(in srgb, var(--popover) var(--glass-opacity), transparent))";

test("an error is the kit's toast at the bottom start corner, clear of tldraw's zoom controls, with its error icon and a close button", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const point = await emptyCanvasPoint(page);
  await inBothSchemes(page, async () => {
    await dropFiles(page, point, [{ name: "huge.mp4", mime: "video/mp4", size: 26_214_401 }]);
    const title = toast(page, "Video is too large. Keep it under 25MB.");
    await expect(title).toBeVisible();
    const card = page.locator("[data-slot='toast-viewport'] > *").filter({ has: title });
    await expect.poll(() => styleOf(card, "background-color")).toBe(await resolvedColor(page, MENU_GLASS));
    await expect(card.locator("[data-slot='toast-icon'] svg")).toHaveClass(/lucide-circle-alert/);

    // Measured once the slide-in has settled.
    const zoom = (await page.getByTestId("minimap.zoom-menu-button").boundingBox())!;
    await expect.poll(async () => { const box = (await card.boundingBox())!; return box.y + box.height <= zoom.y && box.x < page.viewportSize()!.width / 4; }).toBe(true);

    await card.locator("[data-slot='toast-close']").click();
    await expect(title).toHaveCount(0);
  });
});
