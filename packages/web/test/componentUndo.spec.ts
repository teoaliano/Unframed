import type { Page } from "@playwright/test";
import { BRIDGE_TAG, COMPONENT_HELPER_TAG, compiledFileName } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, writeProjectFile } from "./artifacts.ts";
import { componentShape, SHEET_FILE } from "./components.ts";
import { putRecords } from "./media.ts";

/**
 * Spec 20: undo after an instance's editor closes. Reproduced, not fixed. Each selection is a step of tldraw's undo history
 * (`setSelectedShapes` records with `record-preserveRedoStack`), and the double-click that opens the editor selects the page
 * first. So Cmd-Z after the close undoes that selection, and the delete comes back only on the next Cmd-Z. Making selection
 * skip the history changes undo for the whole canvas, so it is the person's call (see the build report). Kept as `fixme`.
 */

const SHEET = stampElementIds(`<!doctype html><html><head><meta charset="utf-8">${BRIDGE_TAG}${COMPONENT_HELPER_TAG}</head><body style="margin:0">
<script type="application/json" data-uf-component>{"tag":"uf-price-card","variants":{},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; } button { background: #111111; color: #ffffff; padding: 8px 12px; }</style>
<div data-uf-template hidden><button data-uf-prop="label">Buy</button></div>
</body></html>`);

const PAGE = `<!doctype html><html><head><script src="${compiledFileName(SHEET_FILE)}" data-uf-component="uf-price-card"></script></head><body style="margin:0;font:16px sans-serif"><uf-price-card label="Buy now"></uf-price-card></body></html>`;

const frame = (page: Page) => page.getByRole("region", { name: "Editing Landing" }).frameLocator("iframe[data-artifact-frame]");

test.fixme("after an instance's editor closes, undo still brings a deleted component back", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeProjectFile(agent, SHEET_FILE, SHEET);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();

  // Delete the component shape.
  await page.mouse.click(640, 600);
  const card = await centre(shapeOnScreen(page, "shape:card"));
  await page.mouse.click(card.x, card.y);
  await page.keyboard.press("Delete");
  await expect(shapeOnScreen(page, "shape:card")).toHaveCount(0);

  // Open the instance's page editor, select the instance in it, and close the editor.
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();
  await expect(frame(page).locator("uf-price-card").first().locator("button")).toHaveText("Buy now", { timeout: 20_000 });
  await expect(async () => {
    await frame(page).locator("uf-price-card").first().locator("button").click();
    await expect(page.locator('[data-edit-outline="selected"]')).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await expect(page.getByRole("region", { name: "Editing Landing" })).toHaveCount(0);

  // Cmd-Z on the canvas brings the deleted component back, with no click in between.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible({ timeout: 10_000 });
});
