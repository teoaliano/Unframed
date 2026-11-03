import type { Page } from "@playwright/test";
import { BRIDGE_TAG, COMPONENT_HELPER_TAG, compiledFileName, TOKENS_TAG, type Kit } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, writeProjectFile } from "./artifacts.ts";
import { componentShape, SHEET_FILE } from "./components.ts";
import { putRecords } from "./media.ts";

/** Spec 20, task 43: a token restyles a component's board and a page's instances; the Kit mode picker switches the instances' look. */

const kitWith = (light: string, dark: string): Kit => ({
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [{ path: "color/brand/primary", type: "color", values: { light, dark } }],
});

const writeKit = (engine: Parameters<typeof putRecords>[0], next: Kit) =>
  putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: next } } }]);

// A button whose colour is the kit's brand token, in a sheet with its tokens tag and the helper.
const SHEET = stampElementIds(`<!doctype html><html><head><meta charset="utf-8">${TOKENS_TAG}${BRIDGE_TAG}${COMPONENT_HELPER_TAG}</head><body style="margin:0">
<script type="application/json" data-uf-component>{"tag":"uf-price-card","variants":{},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; } button { background: var(--color-brand-primary); color: #ffffff; padding: 8px 12px; }</style>
<div data-uf-template hidden><button data-uf-prop="label">Buy</button></div>
</body></html>`);

const PAGE = `<!doctype html><html><head>${TOKENS_TAG}<script src="${compiledFileName(SHEET_FILE)}" data-uf-component="uf-price-card"></script></head><body style="margin:0;font:16px sans-serif"><uf-price-card label="Buy"></uf-price-card></body></html>`;

const region = (page: Page, name: string) => page.getByRole("region", { name: `Editing ${name}` });
const instanceButton = (page: Page) => region(page, "Landing").frameLocator("iframe[data-artifact-frame]").locator("uf-price-card").first().locator("button");

const openEditorOn = async (page: Page, id: string) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, id));
  await page.mouse.dblclick(at.x, at.y);
};

test("a token change restyles a component's board and a page's instances at once", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeKit(agent, kitWith("#1a73e8", "#8ab4f8"));
  await writeProjectFile(agent, SHEET_FILE, SHEET);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();

  await openEditorOn(page, "shape:landing");
  await expect(region(page, "Landing")).toBeVisible();
  await expect(instanceButton(page)).toHaveCSS("background-color", "rgb(26, 115, 232)", { timeout: 20_000 });

  // The person changes the token's light value: the page's instance follows.
  await writeKit(agent, kitWith("#e53935", "#8ab4f8"));
  await expect(instanceButton(page)).toHaveCSS("background-color", "rgb(229, 57, 53)", { timeout: 20_000 });

  // The component's board follows too.
  await page.getByRole("button", { name: "Back to canvas" }).click();
  await openEditorOn(page, "shape:card");
  await expect(region(page, "Price card")).toBeVisible();
  const board = region(page, "Price card").frameLocator("iframe[data-artifact-frame]").locator("uf-price-card").first().locator("button");
  await expect(board).toHaveCSS("background-color", "rgb(229, 57, 53)", { timeout: 20_000 });
});

test("the Kit mode picker on a page switches its instances' look", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeKit(agent, kitWith("#1a73e8", "#8ab4f8"));
  await writeProjectFile(agent, SHEET_FILE, SHEET);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();

  await openEditorOn(page, "shape:landing");
  await expect(instanceButton(page)).toHaveCSS("background-color", "rgb(26, 115, 232)", { timeout: 20_000 });

  await region(page, "Landing").getByRole("combobox", { name: "Kit mode" }).click();
  await page.getByRole("option", { name: "dark", exact: true }).click();
  await expect(instanceButton(page)).toHaveCSS("background-color", "rgb(138, 180, 248)", { timeout: 20_000 });
});
