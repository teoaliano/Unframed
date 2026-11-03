import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { componentShape, writeSheet } from "./components.ts";
import { putRecords } from "./media.ts";

/** Spec 20, task 25: board picking in the editor on a component. */

const PRICE_CARD = { tag: "uf-price-card", variants: { kind: ["primary", "secondary"], size: ["sm", "md"] } };

const region = (page: Page) => page.getByRole("region", { name: "Editing Price card" });
const design = (page: Page) => page.getByTestId("artifact-editor").locator('[data-editor-column="parameters"]');
const frame = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const outline = (page: Page, kind: "selected" | "copy") => page.locator(`[data-edit-outline="${kind}"]`);

const openComponentEditor = async (page: Page) => {
  // Deselect first: a selected shape's frame takes a double-click as its own.
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:card"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
};

test("a click on a board cell picks the element inside it, names its variant, and outlines every copy", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeSheet(agent, PRICE_CARD);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();
  await openComponentEditor(page);

  // The bridge is live once a click in the board selects: the frame may still be preparing its first document.
  await expect(async () => {
    await frame(page).locator("uf-price-card").nth(3).locator("button").click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  // The fourth cell is secondary and md: the variant line names it in the declaration's order.
  await expect(design(page).getByTestId("variant-line")).toHaveText("Editing Price card · secondary · md");
  // On screen, not only in the DOM: a squeezed line has the text and no height.
  await expect(design(page).getByTestId("variant-line")).toBeVisible();
  // The picked copy is outlined, and each of the other three cells shows a fainter outline.
  await expect(outline(page, "copy")).toHaveCount(3);
});
