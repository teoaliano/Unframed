import type { Page } from "@playwright/test";
import { BRIDGE_TAG, COMPONENT_HELPER_TAG } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";
import { compiledFileName } from "@unframed/domain";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, writeProjectFile } from "./artifacts.ts";
import { writeSheet } from "./components.ts";
import { putRecords } from "./media.ts";
import { componentShape } from "./components.ts";

/** Spec 20, task 28: instances in a page. Hover and click pick the instance; a slotted child is picked as itself. */

const CARD_FILE = "1761400000001-card.html";
const BUTTON_FILE = "1761400000000-price-card.html";

// A card with a default slot and a named slot "action", declared as the sheet format asks.
const CARD_SHEET = stampElementIds(`<!doctype html><html><head><meta charset="utf-8">${BRIDGE_TAG}${COMPONENT_HELPER_TAG}</head><body style="margin:0">
<script type="application/json" data-uf-component>{"tag":"uf-card","variants":{},"props":{"label":"text"},"slots":["","action"]}</script>
<style type="text/x-uf-component" data-uf-component-style>
:host { display: block; padding: 16px; background: #f4f4f4; }
h3 { margin: 0 0 8px; }
</style>
<div data-uf-template hidden><h3 data-uf-prop="label">Card</h3><slot></slot><slot name="action"></slot></div>
</body></html>`);

// A page with one button instance, a card holding a span and a button instance in its action slot, and both pins.
const PAGE = `<!doctype html><html><head>
<script src="${compiledFileName(BUTTON_FILE)}" data-uf-component="uf-price-card"></script>
<script src="${compiledFileName(CARD_FILE)}" data-uf-component="uf-card"></script>
</head><body style="margin:0;font:16px sans-serif">
<uf-price-card label="Buy"></uf-price-card>
<uf-card label="Card"><span slot="action">Slotted span</span><uf-price-card slot="action" label="Go"></uf-price-card></uf-card>
</body></html>`;

const region = (page: Page) => page.getByRole("region", { name: "Editing Landing" });
const frame = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const design = (page: Page) => page.getByTestId("artifact-editor").locator('[data-editor-column="parameters"]');
const outline = (page: Page, kind: "selected" | "hover") => page.locator(`[data-edit-outline="${kind}"]`);
/** The tag a selected element's Design header names (its name and tag both show; either one is the element's). */
const headerTag = (page: Page, tag: string) => design(page).getByTestId("design-tab").getByText(tag, { exact: true }).first();

/** Clicks until the bridge answers with a selection: the page is prepared and swapped in first. */
const clickUntilSelected = async (page: Page, at: () => ReturnType<Page["locator"]>) => {
  await expect(async () => {
    await at().click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
};

test("hover and click pick an instance, never its insides, and a slotted child is picked as itself", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeSheet(agent, { tag: "uf-price-card", variants: {} }, BUTTON_FILE);
  await writeProjectFile(agent, CARD_FILE, CARD_SHEET);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 480, h: 320 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();

  // Hovering the button inside an instance outlines the instance.
  await expect(async () => {
    await frame(page).locator("uf-price-card").first().locator("button").hover();
    await expect(outline(page, "hover")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  // A click on the button inside the instance picks the instance: the Design tab names the instance's tag, not the button's.
  await clickUntilSelected(page, () => frame(page).locator("uf-price-card").first().locator("button"));
  await expect(headerTag(page, "uf-price-card")).toBeVisible();
  await expect(design(page).getByText("button", { exact: true })).toHaveCount(0);

  // A slotted child is picked as itself.
  await clickUntilSelected(page, () => frame(page).getByText("Slotted span", { exact: true }));
  await expect(headerTag(page, "span")).toBeVisible();

  // A slotted instance of another component is picked as itself.
  await clickUntilSelected(page, () => frame(page).locator("uf-price-card").nth(1).locator("button"));
  await expect(headerTag(page, "uf-price-card")).toBeVisible();

  // Layers: one row per instance, and no rows for the instance's insides.
  await design(page).getByRole("tab", { name: "Layers" }).click();
  const layers = design(page).getByRole("list", { name: "Layers" });
  await expect(layers.getByRole("button", { name: "Hidden uf-price-card" })).toHaveCount(2);
  await expect(layers.getByRole("button", { name: "Hidden button" })).toHaveCount(0);
});
