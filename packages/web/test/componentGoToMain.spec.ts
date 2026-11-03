import type { Page } from "@playwright/test";
import { BRIDGE_TAG, COMPONENT_HELPER_TAG, compiledFileName } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, writeProjectFile } from "./artifacts.ts";
import { componentShape, SHEET_FILE } from "./components.ts";
import { putRecords } from "./media.ts";

/** Spec 20, task 30: Go to main component opens the component's editor; it is disabled when the shape is gone. */

const SHEET = stampElementIds(`<!doctype html><html><head><meta charset="utf-8">${BRIDGE_TAG}${COMPONENT_HELPER_TAG}</head><body style="margin:0">
<script type="application/json" data-uf-component>{"tag":"uf-price-card","variants":{},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; } button { padding: 8px 12px; }</style>
<div data-uf-template hidden><button data-uf-prop="label">Buy</button></div>
</body></html>`);

const PAGE = `<!doctype html><html><head><script src="${compiledFileName(SHEET_FILE)}" data-uf-component="uf-price-card"></script></head><body style="margin:0;font:16px sans-serif"><uf-price-card label="Buy"></uf-price-card></body></html>`;

const region = (page: Page, name: string) => page.getByRole("region", { name: `Editing ${name}` });
const frame = (page: Page) => region(page, "Landing").frameLocator("iframe[data-artifact-frame]");
const design = (page: Page) => page.getByTestId("artifact-editor").locator('[data-editor-column="parameters"]');
const outline = (page: Page) => page.locator('[data-edit-outline="selected"]');

const openPageEditor = async (page: Page) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page, "Landing")).toBeVisible();
};

/** Clicks the instance until the bridge answers with a selection, after the page is swapped in. */
const selectInstance = async (page: Page) => {
  await expect(async () => {
    await frame(page).locator("uf-price-card").first().locator("button").click();
    await expect(outline(page)).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(design(page).getByTestId("instance-section")).toBeVisible({ timeout: 20_000 });
};

test("Go to main component opens the component's editor", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeProjectFile(agent, SHEET_FILE, SHEET);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();

  await openPageEditor(page);
  await selectInstance(page);
  await design(page).getByRole("button", { name: "Go to main component", exact: true }).click();

  // The component's editor opens in place of the page's: its kind word and its title name it.
  await expect(region(page, "Price card").getByTestId("artifact-editor-kind")).toHaveText("component", { timeout: 20_000 });
});

test("Go to main component is disabled, with its tooltip, when no component shape holds the tag", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeProjectFile(agent, SHEET_FILE, SHEET);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();

  await openPageEditor(page);
  await selectInstance(page);
  const button = design(page).getByRole("button", { name: "Go to main component", exact: true });
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await button.hover();
  await expect(page.getByText("The main component was deleted.", { exact: true })).toBeVisible();
});
