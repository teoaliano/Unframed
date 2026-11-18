import type { Page } from "@playwright/test";
import { expect, test } from "./agent.ts";
import { roomRecords } from "./canvas.ts";
import { editor, leaveEditor, onBoard, openEditor, parameters, preparedFile, selectByText } from "./editorHarness.ts";
import { libraryDialog, presetItem, writePresets } from "./library.ts";
import { putRecords } from "./media.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px Georgia, serif}main{padding:16px}</style></head><body><main><h1 style="font-size: 32px">Welcome</h1><p>Lead text</p></main></body></html>`;

const BRAND = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [{ path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }],
};

const kitOf = async (engine: TestEngine): Promise<{ name: string } | undefined> => {
  const document = (await roomRecords(engine, "default")).find((record) => record.typeName === "document") as { meta?: { unframed?: { kit?: { name: string } } } } | undefined;
  return document?.meta?.unframed?.kit;
};

const kitDialog = (page: Page) => page.getByRole("dialog", { name: "Kit" });

const noTldraw = async (page: Page) => {
  await expect(page.locator(".tl-container")).toHaveCount(0);
  await expect(page.locator(".tl-watermark_SEE-LICENSE")).toHaveCount(0);
};

const editingWelcome = async (page: Page, engine: TestEngine) => {
  await onBoard(page, engine, PAGE);
  await openEditor(page);
  await selectByText(page, "Welcome");
  await preparedFile(engine);
};

test("the Kit line in the Design tab opens the Kit dialog over the editor, with tldraw unmounted, and its edits land in the project", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await putRecords(agent, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: BRAND } } }]);
  await openEditor(page);
  await selectByText(page, "Welcome");
  await preparedFile(agent);

  await parameters(page).getByRole("button", { name: "Kit: Brand", exact: true }).click();
  const dialog = kitDialog(page);
  await expect(dialog).toBeVisible();
  await expect(editor(page)).toBeVisible();
  await noTldraw(page);

  const name = dialog.getByRole("textbox", { name: "Kit name" });
  await name.fill("Brand two");
  await name.press("Enter");
  await expect.poll(async () => (await kitOf(agent))?.name).toBe("Brand two");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
  await expect(parameters(page).getByRole("button", { name: "Kit: Brand two", exact: true })).toBeVisible();
  await noTldraw(page);

  await leaveEditor(page);
  await expect(page.locator(".tl-watermark_SEE-LICENSE")).toBeVisible();
  await expect(kitDialog(page)).toHaveCount(0);
});

test("From library on the editor page offers kits only, and applying one gives the project its kit without leaving the editor", async ({ page, agent }) => {
  await writePresets(agent, [
    { format: 2, id: "kit-brand", source: "user", savedAt: "2026-09-01T10:00:00.000Z", name: "Library brand", summary: "", kind: "kit", revision: 1, kit: { name: "Library brand", modes: ["light"], tokens: [{ path: "color/brand/primary", type: "color", value: "#1a73e8" }] } },
  ]);
  await editingWelcome(page, agent);

  await parameters(page).getByRole("group", { name: "Fill", exact: true }).getByRole("button", { name: /^Use a token/ }).first().click();
  await page.getByRole("button", { name: "Edit kit", exact: true }).click();
  await kitDialog(page).getByRole("button", { name: "From library" }).click();

  const library = libraryDialog(page);
  await expect(library).toBeVisible();
  await expect(library.getByRole("group", { name: "Type" })).toHaveCount(0);
  await expect(library.getByRole("button", { name: "Recipes", exact: true })).toHaveCount(0);
  await presetItem(page, "Library brand").getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(async () => (await kitOf(agent))?.name).toBe("Library brand");
  await expect(library).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
  await noTldraw(page);
});

test("the canvas's own Kit button still opens the Kit dialog over the canvas, watermark and all", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  await expect(kitDialog(page)).toBeVisible();
  await expect(page.locator(".tl-container")).toHaveCount(1);
  await expect(page.locator(".tl-watermark_SEE-LICENSE")).toBeVisible();
});
