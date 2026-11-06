import type { Page } from "@playwright/test";
import { BRIDGE_TAG, COMPONENT_HELPER_TAG, compiledFileName } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, writeProjectFile } from "./artifacts.ts";
import { componentShape, SHEET_FILE } from "./components.ts";
import { putRecords } from "./media.ts";
import { parameters } from "./editorHarness.ts";

const SHEET = stampElementIds(`<!doctype html><html><head><meta charset="utf-8">${BRIDGE_TAG}${COMPONENT_HELPER_TAG}</head><body style="margin:0">
<script type="application/json" data-uf-component>{"tag":"uf-price-card","variants":{},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; } button { background: #111111; color: #ffffff; padding: 8px 12px; }</style>
<div data-uf-template hidden><button data-uf-prop="label">Buy</button></div>
</body></html>`);

const PAGE = `<!doctype html><html><head><script src="${compiledFileName(SHEET_FILE)}" data-uf-component="uf-price-card"></script></head><body style="margin:0;font:16px sans-serif"><uf-price-card label="Buy now"></uf-price-card></body></html>`;

const frame = (page: Page) => page.getByRole("region", { name: "Editing Landing" }).frameLocator("iframe[data-artifact-frame]");
const goToMain = (page: Page) => parameters(page).getByRole("button", { name: "Go to main component", exact: true });

test("a deleted component leaves its instances working, offers no update, and undo brings it back", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeProjectFile(agent, SHEET_FILE, SHEET);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();

  const deleteCard = async () => {
    await page.mouse.click(640, 600);
    const card = (await shapeOnScreen(page, "shape:card").boundingBox())!;
    await page.mouse.click(card.x + 40, card.y + card.height / 2);
    await page.keyboard.press("Delete");
    await expect(shapeOnScreen(page, "shape:card")).toHaveCount(0);
  };
  await deleteCard();
  await page.mouse.click(640, 600);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();

  await deleteCard();
  await expect(page.getByText("Updates", { exact: true })).toHaveCount(0);
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();
  await expect(frame(page).locator("uf-price-card").first().locator("button")).toHaveText("Buy now", { timeout: 20_000 });
  await expect(async () => {
    await frame(page).locator("uf-price-card").first().locator("button").click();
    await expect(page.locator('[data-edit-outline="selected"]')).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(goToMain(page)).toHaveAttribute("aria-disabled", "true");
  await goToMain(page).hover();
  await expect(page.getByText("The main component was deleted.", { exact: true })).toBeVisible();
});
