import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { BRIDGE_TAG, COMPONENT_HELPER_TAG, compiledFileName } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, projectPath, writeProjectFile } from "./artifacts.ts";
import { SHEET_FILE } from "./components.ts";

/**
 * Spec 20, task 29: the Instance section in the Design tab. Variant selects and property fields come from the
 * pinned declaration; a change restyles the instance live and commits as one attribute edit through the burst (task 27's allow-list).
 */

// A price card with a variant, a text property and a boolean property, declared as the sheet format asks.
const SHEET = stampElementIds(`<!doctype html><html><head><meta charset="utf-8">${BRIDGE_TAG}${COMPONENT_HELPER_TAG}</head><body style="margin:0">
<script type="application/json" data-uf-component>{"tag":"uf-price-card","variants":{"kind":["primary","secondary"]},"props":{"label":"text","disabled":"boolean"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>
:host { display: inline-block; }
button { background: #111111; color: #ffffff; padding: 8px 12px; }
:host([kind="secondary"]) button { background: #eeeeee; color: #000000; }
:host([disabled]) button { opacity: 0.5; }
</style>
<div data-uf-template hidden><button data-uf-prop="label">Buy</button></div>
</body></html>`);

// Two instances: the first sets its variant in the source, the second gets its variant from a script.
const PAGE = `<!doctype html><html><head><script src="${compiledFileName(SHEET_FILE)}" data-uf-component="uf-price-card"></script></head><body style="margin:0;font:16px sans-serif">
<uf-price-card kind="primary" label="Buy"></uf-price-card>
<uf-price-card label="Pay"></uf-price-card>
<script>document.querySelectorAll("uf-price-card")[1].setAttribute("kind", "secondary");</script>
</body></html>`;

const region = (page: Page) => page.getByRole("region", { name: "Editing Landing" });
const frame = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const design = (page: Page) => page.getByTestId("artifact-editor").locator('[data-editor-column="parameters"]');
const outline = (page: Page, kind: "selected" | "hover") => page.locator(`[data-edit-outline="${kind}"]`);
const firstButton = (page: Page) => frame(page).locator("uf-price-card").first().locator("button");
const secondButton = (page: Page) => frame(page).locator("uf-price-card").nth(1).locator("button");

/** Clicks until the bridge answers with a selection: the page is prepared and swapped in first. */
const clickUntilSelected = async (page: Page, at: () => ReturnType<Page["locator"]>) => {
  await expect(async () => {
    await at().click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
};

test("the Instance section sets an instance's variant, text and boolean live, and a script-set variant is read-only", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeProjectFile(agent, SHEET_FILE, SHEET);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 480, h: 320 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();

  // Selecting the first instance shows its Instance section first, with the tag as its name (no component shape here).
  await clickUntilSelected(page, () => firstButton(page));
  const section = design(page).getByTestId("instance-section");
  await expect(section).toBeVisible({ timeout: 20_000 });
  await expect(section.getByText("uf-price-card", { exact: true })).toBeVisible();
  // The Text and Fill sections are gone: an instance does not edit its insides.
  await expect(design(page).getByRole("group", { name: "Text", exact: true })).toHaveCount(0);

  // A variant select: the current value is the default, and choosing the other restyles the instance at once.
  await expect(design(page).getByRole("combobox", { name: "kind", exact: true })).toHaveText("primary");
  await design(page).getByRole("combobox", { name: "kind", exact: true }).click();
  await page.getByRole("option", { name: "secondary", exact: true }).click();
  await expect(firstButton(page)).toHaveCSS("background-color", "rgb(238, 238, 238)");

  // A text property: typing replaces the button's text in the live instance.
  await design(page).getByRole("textbox", { name: "label", exact: true }).fill("Buy now");
  await expect(firstButton(page)).toHaveText("Buy now");

  // A boolean property: the switch sets the attribute, and the style matches it.
  await design(page).getByRole("switch", { name: "disabled", exact: true }).click();
  await expect(firstButton(page)).toHaveCSS("opacity", "0.5");

  // The burst commits: the page's new version carries the attributes on the first instance.
  await expect
    .poll(
      async () => {
        const file = (await roomShapes(agent, "default", "page")).find((record) => record.id === "shape:landing")?.props?.file;
        if (file === undefined) return "";
        const html = await readFile(projectPath(agent, file), "utf8");
        return html.match(/<uf-price-card\b[^>]*>/)?.[0] ?? "";
      },
      { timeout: 15_000 },
    )
    .toMatch(/^(?=.*kind="secondary")(?=.*label="Buy now")(?=.*\bdisabled\b)/);

  // The second instance's variant comes from a script: it is read-only, with the owner's sentence.
  await clickUntilSelected(page, () => secondButton(page));
  await expect(design(page).getByText("Set by the agent's code.", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(design(page).getByRole("combobox", { name: "kind", exact: true })).toBeDisabled();
});
