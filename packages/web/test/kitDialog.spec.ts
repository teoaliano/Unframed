import type { Locator, Page } from "@playwright/test";
import { openCanvas, roomRecords } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
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
