import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { compiledFileName } from "@unframed/domain";
import { openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, projectPath, writeProjectFile } from "./artifacts.ts";
import { componentShape, SHEET_FILE, sheetHtml } from "./components.ts";
import { putRecords } from "./media.ts";

const PRICE_CARD = { tag: "uf-price-card", variants: { kind: ["primary", "secondary"] } };
const NEW_SHEET = "1761400005000-price-card.html";

const CARD_PAGE = `<!doctype html><html><head><script src="${compiledFileName(SHEET_FILE)}" data-uf-component="uf-price-card"></script></head><body style="margin:0;font:16px sans-serif"><uf-price-card kind="primary" label="Buy"></uf-price-card></body></html>`;

const editor = (page: Page) => page.getByRole("region", { name: "Editing Landing" });
const frame = (page: Page) => editor(page).frameLocator("iframe[data-artifact-frame]");
const design = (page: Page) => page.getByTestId("artifact-editor").locator('[data-editor-column="parameters"]');
const headerButton = (page: Page) => editor(page).getByRole("button", { name: "Component updates available", exact: true });
const popover = (page: Page) => page.getByRole("dialog", { name: "Component updates", exact: true });
const canvasBadge = (page: Page) => page.getByTestId("component-updates-badge");

const pageFile = async (agent: Parameters<typeof roomShapes>[0]): Promise<string> => {
  const shape = (await roomShapes(agent, "default", "page")).find((record) => record.id === "shape:landing");
  return String(shape?.props?.file ?? "");
};

test("a component edit shows Updates on the page, the editor offers Update and the Instance section says it is older; Update moves the pin and undo brings it back", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeProjectFile(agent, SHEET_FILE, sheetHtml(PRICE_CARD));
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: CARD_PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await expect(canvasBadge(page)).toHaveCount(0);

  await writeProjectFile(agent, NEW_SHEET, sheetHtml({ ...PRICE_CARD, variants: { kind: ["primary", "secondary", "ghost"] } }));
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, file: NEW_SHEET, tag: "uf-price-card", title: "Price card" })]);

  await expect(canvasBadge(page)).toBeVisible({ timeout: 20_000 });
  await canvasBadge(page).click();
  await expect(editor(page)).toBeVisible();
  await expect(popover(page)).toBeVisible({ timeout: 20_000 });
  await expect(popover(page).getByText("Price card", { exact: true })).toBeVisible();
  await expect(popover(page).getByText("1 instance", { exact: true })).toBeVisible();

  await headerButton(page).click();
  await expect(popover(page)).toHaveCount(0);
  await expect(async () => {
    await frame(page).locator("uf-price-card").first().locator("button").click();
    await expect(page.locator('[data-edit-outline="selected"]')).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  const instance = design(page).getByTestId("instance-section");
  await expect(instance.getByText("This instance uses an older version of Price card.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await instance.getByRole("button", { name: "Update Price card", exact: true }).click();

  await expect(headerButton(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(editor(page).getByRole("status")).toHaveText("Updated Price card.", { timeout: 20_000 });
  await expect.poll(() => pageFile(agent).then((file) => readFile(projectPath(agent, file), "utf8")), { timeout: 15_000 }).toContain(compiledFileName(NEW_SHEET));
  await editor(page).getByTestId("artifact-editor-title").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => pageFile(agent).then((file) => readFile(projectPath(agent, file), "utf8")), { timeout: 15_000 }).toContain(compiledFileName(SHEET_FILE));
  await expect(headerButton(page)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await expect(canvasBadge(page)).toBeVisible({ timeout: 20_000 });
});
