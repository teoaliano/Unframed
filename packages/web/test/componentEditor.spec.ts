import type { Locator, Page } from "@playwright/test";
import type { Kit } from "@unframed/domain";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { componentShape, writeSheet } from "./components.ts";
import { filledArtifact } from "./artifacts.ts";
import { putRecords } from "./media.ts";

/** Spec 20, task 21: the editor on a component. */

const PRICE_CARD = { tag: "uf-price-card", variants: { kind: ["primary", "secondary"], size: ["sm", "md"] } };

const kit: Kit = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [{ path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }],
};

/** A page that pins the price card and uses one instance of it. */
const CARD_PAGE = `<!doctype html><html><head><script src="1761400000000-price-card.component.js" data-uf-component="uf-price-card"></script></head><body><uf-price-card label="Buy"></uf-price-card></body></html>`;

const region = (page: Page) => page.getByRole("region", { name: "Editing Price card" });
const column = (page: Page, name: "rail" | "centre" | "parameters") => page.getByTestId("artifact-editor").locator(`[data-editor-column="${name}"]`);
const modeGroup = (page: Page): Locator => region(page).getByRole("group", { name: "Mode" });

const openComponentEditor = async (page: Page) => {
  // Deselect first: a selected shape's frame takes a double-click as its own.
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:card"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
};

const writeKit = (engine: Parameters<typeof putRecords>[0]) =>
  putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit } } }]);

test("the editor on a component shows its use count, the Mode toggle and Kit mode, only the Design and Layers tabs, and the read-only Component section", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeKit(agent);
  await writeSheet(agent, PRICE_CARD);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: CARD_PAGE });
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();

  await openComponentEditor(page);
  await expect(region(page).getByTestId("artifact-editor-kind")).toHaveText("component");
  await expect(region(page).getByText("Used in 1 artifact", { exact: true })).toBeVisible();
  await expect(modeGroup(page).getByRole("button", { name: "Edit", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(region(page).getByRole("combobox", { name: "Kit mode" })).toBeVisible();

  const tabs = column(page, "parameters").getByRole("tablist");
  await expect(tabs.getByRole("tab")).toHaveText(["Design", "Layers"]);

  // The Component section names the tag, each variant with its values (the default first, marked), each property with its type, and the slots.
  const design = column(page, "parameters");
  await expect(design.getByText("uf-price-card", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(design.getByText("kind", { exact: true })).toBeVisible();
  await expect(design.getByText("primary", { exact: true })).toBeVisible();
  // One default per variant: `kind` and `size`.
  await expect(design.getByText("default", { exact: true })).toHaveCount(2);
  await expect(design.getByText("secondary", { exact: true })).toBeVisible();
  await expect(design.getByText("md", { exact: true })).toBeVisible();
  await expect(design.getByText("label", { exact: true })).toBeVisible();
  await expect(design.getByText("text", { exact: true })).toBeVisible();
  await expect(design.getByText("Slots", { exact: true })).toBeVisible();

  // The action puts the component's chip into the rail's composer.
  await design.getByRole("button", { name: "Ask the agent to change this", exact: true }).click();
  await expect(column(page, "rail").getByText("uf-price-card · Price card", { exact: true })).toBeVisible();
});

test("a component nothing uses shows no use count", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeSheet(agent, PRICE_CARD);
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();

  await openComponentEditor(page);
  await expect(column(page, "parameters").getByText("uf-price-card", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(region(page).getByText(/Used in/)).toHaveCount(0);
});
