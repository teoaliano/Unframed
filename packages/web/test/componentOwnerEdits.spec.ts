import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { BRIDGE_TAG, COMPONENT_HELPER_TAG, TOKENS_TAG, type Kit } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { projectPath, writeProjectFile } from "./artifacts.ts";
import { componentShape, SHEET_FILE, writeSheet } from "./components.ts";
import { putRecords } from "./media.ts";
import { parameters } from "./editorHarness.ts";

const PRICE_CARD = { tag: "uf-price-card", variants: { kind: ["primary", "secondary"] } };

const region = (page: Page) => page.getByRole("region", { name: "Editing Price card" });
const frame = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const outline = (page: Page, kind: "selected" | "copy") => page.locator(`[data-edit-outline="${kind}"]`);
const cellButton = (page: Page, cell: number) => frame(page).locator("uf-price-card").nth(cell).locator("button");

const openComponentEditor = async (page: Page) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:card"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
};

test("a background set by a variant rule changes only that variant's cells, and a padding set by the base rule changes every cell", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeSheet(agent, PRICE_CARD);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();
  await openComponentEditor(page);

  await expect(async () => {
    await cellButton(page, 1).click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(parameters(page).getByTestId("variant-line")).toHaveText("Editing Price card · secondary");

  await expect(parameters(page).getByRole("group", { name: "Fill", exact: true }).getByText("kind: secondary", { exact: true })).toBeVisible({ timeout: 20_000 });
  await parameters(page).getByRole("button", { name: "Background", exact: true }).click();
  await page.getByRole("textbox", { name: "Hex", exact: true }).fill("#ff0000");
  await page.getByRole("textbox", { name: "Hex", exact: true }).press("Enter");
  await page.keyboard.press("Escape");

  await expect(cellButton(page, 1)).toHaveCSS("background-color", "rgb(255, 0, 0)", { timeout: 15_000 });
  await expect(cellButton(page, 0)).toHaveCSS("background-color", "rgb(17, 17, 17)");
  await expect
    .poll(async () => {
      const file = (await roomShapes(agent, "default", "component")).find((record) => record.id === "shape:card")?.props?.file;
      return file === undefined ? "" : await readFile(projectPath(agent, file), "utf8");
    }, { timeout: 15_000 })
    .toMatch(/:host\(\[kind="secondary"\]\) button \{[^}]*background-color: #ff0000;/);

  await expect(parameters(page).getByText("All variants", { exact: true }).first()).toBeVisible();
  await parameters(page).getByRole("spinbutton", { name: "Padding top", exact: true }).fill("20");
  await parameters(page).getByRole("spinbutton", { name: "Padding top", exact: true }).press("Enter");
  await expect(cellButton(page, 0)).toHaveCSS("padding-top", "20px", { timeout: 15_000 });
  await expect(cellButton(page, 1)).toHaveCSS("padding-top", "20px");
});

test("a background set by the base rule says it covers all variants except the one its override takes over, and changes only the cells it reaches", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeSheet(agent, PRICE_CARD);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "151", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();
  await openComponentEditor(page);

  await expect(async () => {
    await cellButton(page, 0).click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(parameters(page).getByTestId("variant-line")).toHaveText("Editing Price card · primary");
  await expect(parameters(page).getByRole("group", { name: "Fill", exact: true }).getByText("All variants, except kind: secondary", { exact: true })).toBeVisible({ timeout: 20_000 });
  const fill = parameters(page).getByRole("group", { name: "Fill", exact: true });
  const chipBox = await fill.getByText("All variants, except kind: secondary", { exact: true }).boundingBox();
  const fieldBox = await fill.getByRole("button", { name: "Background", exact: true }).boundingBox();
  expect(chipBox && fieldBox).toBeTruthy();
  const overlap = chipBox!.x < fieldBox!.x + fieldBox!.width && fieldBox!.x < chipBox!.x + chipBox!.width && chipBox!.y < fieldBox!.y + fieldBox!.height && fieldBox!.y < chipBox!.y + chipBox!.height;
  expect(overlap).toBe(false);

  await parameters(page).getByRole("button", { name: "Background", exact: true }).click();
  await page.getByRole("textbox", { name: "Hex", exact: true }).fill("#ff0000");
  await page.getByRole("textbox", { name: "Hex", exact: true }).press("Enter");
  await page.keyboard.press("Escape");

  await expect(cellButton(page, 0)).toHaveCSS("background-color", "rgb(255, 0, 0)", { timeout: 15_000 });
  await expect(cellButton(page, 1)).toHaveCSS("background-color", "rgb(238, 238, 238)");
});

const TOKEN_SHEET = stampElementIds(`<!doctype html><html><head><meta charset="utf-8">${TOKENS_TAG}${BRIDGE_TAG}${COMPONENT_HELPER_TAG}</head><body style="margin:0">
<script type="application/json" data-uf-component>{"tag":"uf-price-card","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; } button { background-color: var(--color-brand-primary); color: #ffffff; padding: 8px 12px; }</style>
<div data-uf-template hidden><button data-uf-prop="label">Buy</button></div>
</body></html>`);

const KIT: Kit = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [
    { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
    { path: "color/brand/accent", type: "color", values: { light: "#ff00aa", dark: "#ff66cc" } },
  ],
};

test("a token declared in a base rule is a token chip, another token writes into that rule, and Detach writes the literal there", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: KIT } } }]);
  await writeProjectFile(agent, SHEET_FILE, TOKEN_SHEET);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();
  await openComponentEditor(page);

  await expect(async () => {
    await cellButton(page, 0).click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  const fill = parameters(page).getByRole("group", { name: "Fill", exact: true });
  await expect(fill.getByTitle("color/brand/primary")).toBeVisible({ timeout: 20_000 });

  await fill.getByTitle("color/brand/primary").click();
  await page.getByRole("dialog", { name: "Use a token" }).getByRole("button", { name: /color\/brand\/accent/ }).click();
  await page.keyboard.press("Escape");
  await expect(cellButton(page, 0)).toHaveCSS("background-color", "rgb(255, 0, 170)", { timeout: 15_000 });
  await expect
    .poll(async () => {
      const file = (await roomShapes(agent, "default", "component")).find((record) => record.id === "shape:card")?.props?.file;
      return file === undefined ? "" : await readFile(projectPath(agent, file), "utf8");
    }, { timeout: 15_000 })
    .toMatch(/background-color: var\(--color-brand-accent\)/);

  await expect(async () => {
    await cellButton(page, 0).click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(fill.getByTitle("color/brand/accent")).toBeVisible({ timeout: 20_000 });
  await fill.getByTitle("color/brand/accent").click();
  await page.getByRole("dialog", { name: "Use a token" }).getByRole("button", { name: "Detach", exact: true }).click();
  await expect
    .poll(async () => {
      const file = (await roomShapes(agent, "default", "component")).find((record) => record.id === "shape:card")?.props?.file;
      return file === undefined ? "" : await readFile(projectPath(agent, file), "utf8");
    }, { timeout: 15_000 })
    .toMatch(/background-color: #ff00aa/);
  await expect(fill.getByTitle("color/brand/accent")).toHaveCount(0);
  await expect(cellButton(page, 0)).toHaveCSS("background-color", "rgb(255, 0, 170)");
});

test("a calc() set by the component's style is read-only, with the owner's sentence", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeProjectFile(
    agent,
    SHEET_FILE,
    stampElementIds(`<!doctype html><html><head><meta charset="utf-8">${BRIDGE_TAG}${COMPONENT_HELPER_TAG}</head><body style="margin:0">
<script type="application/json" data-uf-component>{"tag":"uf-price-card","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; } button { background: #111111; color: #ffffff; padding-top: calc(4px + 4px); }</style>
<div data-uf-template hidden><button data-uf-prop="label">Buy</button></div>
</body></html>`),
  );
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();
  await openComponentEditor(page);

  await expect(async () => {
    await cellButton(page, 0).click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(parameters(page).getByText("Set by the component's style.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(parameters(page).getByRole("spinbutton", { name: "Padding top", exact: true })).toBeDisabled();
});
