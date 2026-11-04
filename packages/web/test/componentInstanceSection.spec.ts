import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { BRIDGE_TAG, COMPONENT_HELPER_TAG, compiledFileName } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, projectPath, writeProjectFile } from "./artifacts.ts";
import { SHEET_FILE } from "./components.ts";
import { parameters, region } from "./editorHarness.ts";

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

const PAGE = `<!doctype html><html><head><script src="${compiledFileName(SHEET_FILE)}" data-uf-component="uf-price-card"></script></head><body style="margin:0;font:16px sans-serif">
<uf-price-card kind="primary" label="Buy"></uf-price-card>
<uf-price-card label="Pay"></uf-price-card>
<script>document.querySelectorAll("uf-price-card")[1].setAttribute("kind", "secondary");</script>
</body></html>`;

const frame = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const outline = (page: Page, kind: "selected" | "hover") => page.locator(`[data-edit-outline="${kind}"]`);
const firstButton = (page: Page) => frame(page).locator("uf-price-card").first().locator("button");
const secondButton = (page: Page) => frame(page).locator("uf-price-card").nth(1).locator("button");

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

  await clickUntilSelected(page, () => firstButton(page));
  const section = parameters(page).getByTestId("instance-section");
  await expect(section).toBeVisible({ timeout: 20_000 });
  await expect(section.getByText("uf-price-card", { exact: true })).toBeVisible();
  await expect(parameters(page).getByRole("group", { name: "Text", exact: true })).toHaveCount(0);

  await expect(parameters(page).getByRole("combobox", { name: "kind", exact: true })).toHaveText("primary");
  await parameters(page).getByRole("combobox", { name: "kind", exact: true }).click();
  await page.getByRole("option", { name: "secondary", exact: true }).click();
  await expect(firstButton(page)).toHaveCSS("background-color", "rgb(238, 238, 238)");

  await parameters(page).getByRole("textbox", { name: "label", exact: true }).fill("Buy now");
  await expect(firstButton(page)).toHaveText("Buy now");

  await parameters(page).getByRole("switch", { name: "disabled", exact: true }).click();
  await expect(firstButton(page)).toHaveCSS("opacity", "0.5");

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

  await clickUntilSelected(page, () => secondButton(page));
  await expect(parameters(page).getByText("Set by the agent's code.", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(parameters(page).getByRole("combobox", { name: "kind", exact: true })).toBeDisabled();
});
