import { test as base } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { componentShape, writeSheet } from "./components.ts";
import { frameOf, insideFrame } from "./artifacts.ts";
import { expect, startHostedEngine } from "./fixtures.ts";
import { clickShape, toolbar } from "./generation.ts";
import { putRecords } from "./media.ts";

const test = base.extend<{ engine: TestEngine }>({
  engine: async ({}, use) => {
    const engine = await startHostedEngine({ env: { UNFRAMED_TEST_RENDERER: "ok" } });
    await use(engine);
    await engine.dispose();
  },
});

const PRICE_CARD = { tag: "uf-price-card", variants: { kind: ["primary", "secondary"], size: ["sm", "md"] } };

test("a component shape shows its board in its frame when selected, its snapshot when not, under its title", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writeSheet(engine, PRICE_CARD);
  await putRecords(engine, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  const card = shapeOnScreen(page, "shape:card");
  await expect(card.locator("[data-testid='artifact-card']")).toHaveAttribute("data-artifact-kind", "component");
  await expect(card.locator("[data-shape-label]")).toHaveText("Price card");
  await expect(card.locator("img[data-testid='artifact-snapshot']")).toBeVisible({ timeout: 30_000 });

  await clickShape(page, "shape:card");
  await expect(frameOf(page, "shape:card")).toHaveCount(1);
  await expect(insideFrame(page, "shape:card").getByText("primary · sm", { exact: true })).toBeVisible();
  await expect(insideFrame(page, "shape:card").getByText("secondary · md", { exact: true })).toBeVisible();
});

test("a selected component offers Editor and Agent in its toolbar, and neither Render nor Parameters", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writeSheet(engine, PRICE_CARD);
  await putRecords(engine, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await clickShape(page, "shape:card");
  await expect(toolbar(page).getByRole("button")).toHaveText(["", "Editor", "Agent"]);
});

test("a double-click on the label opens its name field under the kind word Component", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writeSheet(engine, PRICE_CARD);
  await putRecords(engine, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await expect(shapeOnScreen(page, "shape:card").locator("[data-shape-label]")).toHaveText("Price card");
  await shapeOnScreen(page, "shape:card").locator("[data-shape-label]").dblclick();
  await expect(page.getByRole("textbox", { name: "Component name" })).toBeVisible();
});
