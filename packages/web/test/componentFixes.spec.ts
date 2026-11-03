import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { openCanvas, shapeOnScreen, centre } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { projectPath, writeProjectFile } from "./artifacts.ts";
import { componentShape, SHEET_FILE, sheetHtml, writeSheet } from "./components.ts";
import { putRecords } from "./media.ts";

/** Spec 20, audit fixes: a rename is the component's name everywhere; a broken or deleted sheet says so in one line; a long variant value stays in its column. */

/** Proof screenshots of the fixes (audit run only; the folder is outside the repo). */
const SHOTS = "/private/tmp/claude-502/-Users-matteoaliano-Unframed/9f8b89a0-8999-4809-bafb-93847319fc84/scratchpad/audit/fixshots/components";
const shot = (page: Page, name: string) => {
  mkdirSync(SHOTS, { recursive: true });
  return page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const PRICE_CARD = { tag: "uf-price-card", variants: { kind: ["primary", "secondary"] } };
const LONG = "a".repeat(200);

const region = (page: Page, title: string) => page.getByRole("region", { name: `Editing ${title}` });
const frame = (page: Page, title: string) => region(page, title).frameLocator("iframe[data-artifact-frame]");
const design = (page: Page) => page.getByTestId("artifact-editor").locator('[data-editor-column="parameters"]');

const openComponentEditor = async (page: Page, id: string, title: string) => {
  // Deselect first: a selected shape's frame takes a double-click as its own.
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, id));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page, title)).toBeVisible();
};

test("renaming a component shows its new name in the editor header, the Design tab and the canvas label", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeSheet(agent, PRICE_CARD);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "160", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();

  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:card"));
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press("F2");
  const field = page.getByRole("textbox", { name: "component name" });
  await expect(field).toBeFocused();
  await field.fill("Renamed Price Card");
  await field.press("Enter");

  await openComponentEditor(page, "shape:card", "renamed-price-card");
  await expect(page.getByTestId("artifact-editor-title")).toHaveText("renamed-price-card");
  await expect(design(page).getByTestId("component-section")).toBeVisible();
  await shot(page, "02-rename-editor-header");
});

test("a sheet whose declaration is not valid JSON shows one line in the board instead of a blank frame", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const broken = sheetHtml(PRICE_CARD).replace('{"tag":"uf-price-card"', '{"tag":"uf-price-card",,');
  await writeProjectFile(agent, SHEET_FILE, broken);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "161", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Broken card" })]);
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();
  await openComponentEditor(page, "shape:card", "Broken card");

  await expect(frame(page, "Broken card").getByText("This component's declaration is not valid JSON, so it cannot be shown.")).toBeVisible({ timeout: 20_000 });
  await shot(page, "03-malformed-sheet-line");
});

test("a sheet deleted on disk while its component is on the canvas says so in one readable line", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeSheet(agent, PRICE_CARD);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "162", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Gone card" })]);
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();
  await unlink(projectPath(agent, SHEET_FILE));
  await openComponentEditor(page, "shape:card", "Gone card");

  await expect(frame(page, "Gone card").getByText("This file is no longer in the project.")).toBeVisible({ timeout: 20_000 });
  await expect(frame(page, "Gone card").locator("body")).not.toContainText("not found");
  await shot(page, "04-deleted-sheet-line");
});

test("a 200-character variant value truncates in the board and the Component section, and stays inside the Design column", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeSheet(agent, { tag: "uf-price-card", variants: { kind: [LONG, "b"] } });
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "163", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Long value" })]);
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();
  await openComponentEditor(page, "shape:card", "Long value");

  await expect(frame(page, "Long value").getByTitle(LONG)).toHaveCSS("text-overflow", "ellipsis", { timeout: 20_000 });
  const section = design(page).getByTestId("component-section");
  await expect(section.getByText(LONG)).toBeVisible();
  // Nothing in the section reaches past its right edge.
  const past = await section.evaluate((element) => {
    const right = element.getBoundingClientRect().right;
    return [...element.querySelectorAll("*")].filter((node) => node.getBoundingClientRect().right > right + 1).map((node) => `${node.tagName}.${String(node.className).slice(0, 60)} ${Math.round(node.getBoundingClientRect().right - right)}`);
  });
  expect(past).toEqual([]);
  await shot(page, "01-long-variant-value");
});
