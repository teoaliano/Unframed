import type { Locator, Page } from "@playwright/test";
import { openCanvas, roomRecords } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { putRecords } from "./media.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** The Kit dialog (spec 19): the bottom bar's Kit button, the empty state, and New kit. */

const kitDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Kit" });

const kitOf = async (engine: TestEngine, project: string) => {
  const document = (await roomRecords(engine, project)).find((record) => record.typeName === "document") as { meta?: { unframed?: { kit?: unknown } } } | undefined;
  return document?.meta?.unframed?.kit as { name: string; modes: string[]; tokens: unknown[] } | undefined;
};

test("the Kit button in the bottom bar opens the dialog's empty state", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();

  const dialog = kitDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Kit" })).toBeVisible();
  await expect(dialog).toContainText("This project has no kit yet. A kit holds the colours, sizes, fonts and motion values its pages and motions share.");
  await expect(dialog.getByRole("button", { name: "New kit" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "From library" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Import" })).toBeVisible();
});

test("New kit creates a kit named Kit with one mode, default, and shows it", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);
  await dialog.getByRole("button", { name: "New kit" }).click();

  await expect(dialog.getByRole("textbox", { name: "Kit name" })).toHaveValue("Kit");
  await expect(dialog).not.toContainText("This project has no kit yet.");
  await expect.poll(() => kitOf(engine, project)).toEqual({ format: 1, name: "Kit", modes: ["default"], tokens: [] });
});

/** A project kit seeded into the room: two modes, one colour per mode, one dimension, one duration and an easing. */
const seededKit = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [
    { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
    { path: "dimension/space/md", type: "dimension", value: "16px" },
    { path: "duration/motion/fast", type: "duration", value: "200ms" },
    { path: "easing/motion/ease", type: "easing", value: "power2.out" },
  ],
};

const seedKit = (engine: TestEngine) =>
  putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: seededKit } } }]);

const row = (dialog: Locator, path: string): Locator => dialog.locator(`[data-token="${path}"]`);

test("the table lists the kit's tokens by group, with modes as columns and the CSS name under each token", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await expect(dialog.getByRole("textbox", { name: "Kit name" })).toHaveValue("Brand");
  await expect(dialog.getByRole("columnheader", { name: /^light/ })).toContainText("default");
  await expect(dialog.getByRole("columnheader", { name: /^dark/ })).toBeVisible();
  await expect(row(dialog, "color/brand/primary")).toContainText("--color-brand-primary");
  await expect(dialog.getByRole("button", { name: "All" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "color 1" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "dimension 1" })).toBeVisible();

  await dialog.getByRole("button", { name: "color 1" }).click();
  await expect(row(dialog, "color/brand/primary")).toBeVisible();
  await expect(row(dialog, "dimension/space/md")).toHaveCount(0);
  await dialog.getByRole("button", { name: "All" }).click();

  await dialog.getByRole("searchbox", { name: "Search tokens" }).fill("motion");
  await expect(row(dialog, "duration/motion/fast")).toBeVisible();
  await expect(row(dialog, "color/brand/primary")).toHaveCount(0);
  await dialog.getByRole("searchbox", { name: "Search tokens" }).fill("--color-brand");
  await expect(row(dialog, "color/brand/primary")).toBeVisible();
  await expect(row(dialog, "duration/motion/fast")).toHaveCount(0);
  await dialog.getByRole("searchbox", { name: "Search tokens" }).fill("");
});

test("a cell edits its mode's value; a refusal shows under the cell and writes nothing", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  const dark = row(dialog, "color/brand/primary").locator("[data-mode='dark'] input");
  await dark.fill("#000000");
  await dark.press("Enter");
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ tokens: expect.arrayContaining([expect.objectContaining({ path: "color/brand/primary", values: { light: "#1a73e8", dark: "#000000" } })]) });

  await dark.fill("not a colour");
  await dark.press("Enter");
  await expect(row(dialog, "color/brand/primary").getByRole("alert")).toHaveText("not a colour is not a colour. Use a hex value like #1a73e8, or rgb(), hsl() or oklch().");
  await expect(dark).toHaveValue("not a colour");
  await dark.press("Escape");
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ tokens: expect.arrayContaining([expect.objectContaining({ values: { light: "#1a73e8", dark: "#000000" } })]) });
});

test("one value for all modes, an easing from the catalogue, and Add token", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  // A per-mode token collapses to one value for all modes: the default mode's value is kept.
  await row(dialog, "color/brand/primary").getByRole("button", { name: "Token options color/brand/primary" }).click();
  await page.getByRole("menuitem", { name: "One value for all modes" }).click();
  await expect(row(dialog, "color/brand/primary").locator("[data-mode='all']")).toBeVisible();
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ tokens: expect.arrayContaining([expect.objectContaining({ path: "color/brand/primary", value: "#1a73e8" })]) });

  // The easing cell lists the 31 eases with their curves, and a cubic bezier entry.
  await row(dialog, "easing/motion/ease").getByRole("combobox", { name: "easing/motion/ease value" }).click();
  await expect(page.getByRole("option")).toHaveCount(32);
  await expect(page.getByRole("option", { name: "Cubic bezier" })).toBeVisible();
  await page.getByRole("option", { name: "Expo · Out" }).click();
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ tokens: expect.arrayContaining([expect.objectContaining({ path: "easing/motion/ease", value: "expo.out" })]) });

  await dialog.getByRole("button", { name: "Add token" }).click();
  await dialog.getByRole("textbox", { name: "Token path" }).fill("color/accent/hot");
  await dialog.getByRole("combobox", { name: "Token type" }).click();
  await page.getByRole("option", { name: "color", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Token path" }).press("Enter");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ tokens: expect.arrayContaining([expect.objectContaining({ path: "color/accent/hot", type: "color" })]) });
  await expect(row(dialog, "color/accent/hot")).toBeVisible();
});
