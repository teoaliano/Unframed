import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { componentShape, writeSheet } from "./components.ts";
import { putRecords } from "./media.ts";
import { parameters } from "./editorHarness.ts";

const PRICE_CARD = { tag: "uf-price-card", variants: { kind: ["primary", "secondary"], size: ["sm", "md"] } };

const region = (page: Page) => page.getByRole("region", { name: "Editing Price card" });
const frame = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const outline = (page: Page, kind: "selected" | "copy") => page.locator(`[data-edit-outline="${kind}"]`);

const openComponentEditor = async (page: Page) => {
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

  await expect(async () => {
    await frame(page).locator("uf-price-card").nth(3).locator("button").click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  await expect(parameters(page).getByTestId("variant-line")).toHaveText("Editing Price card · secondary · md");
  await expect(parameters(page).getByTestId("variant-line")).toBeVisible();
  await expect(outline(page, "copy")).toHaveCount(3);
});
