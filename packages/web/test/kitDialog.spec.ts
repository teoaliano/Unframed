import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { centre, openCanvas, roomRecords, toast } from "./canvas.ts";
import { dropFiles, putRecords } from "./media.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

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
  await expect(dialog).toBeVisible();
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ tokens: expect.arrayContaining([expect.objectContaining({ values: { light: "#1a73e8", dark: "#000000" } })]) });
});

test("one value for all modes, an easing from the catalogue, and Add token", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await row(dialog, "color/brand/primary").getByRole("button", { name: "Token options color/brand/primary" }).click();
  await page.getByRole("menuitem", { name: "One value for all modes" }).click();
  await expect(row(dialog, "color/brand/primary").locator("[data-mode='all']")).toBeVisible();
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ tokens: expect.arrayContaining([expect.objectContaining({ path: "color/brand/primary", value: "#1a73e8" })]) });

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

test("each kit commit is one undo step on the canvas, and redo brings it back", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);
  await dialog.getByRole("button", { name: "New kit" }).click();
  const name = dialog.getByRole("textbox", { name: "Kit name" });
  await name.fill("Brand");
  await name.press("Enter");
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ name: "Brand" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ name: "Kit" });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => kitOf(engine, project)).toBeUndefined();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ name: "Kit" });
});

test("a kit commit reaches another tab of the same project", async ({ page, context, engine }) => {
  const project = await openCanvas(page, engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  await kitDialog(page).getByRole("button", { name: "New kit" }).click();

  const other = await context.newPage();
  await openCanvas(other, engine, project);
  await other.getByRole("button", { name: "Kit", exact: true }).click();
  await expect(kitDialog(other).getByRole("textbox", { name: "Kit name" })).toHaveValue("Kit");

  const name = kitDialog(page).getByRole("textbox", { name: "Kit name" });
  await name.fill("Brand");
  await name.press("Enter");
  await expect(kitDialog(other).getByRole("textbox", { name: "Kit name" })).toHaveValue("Brand", { timeout: 5000 });
});

const tokenOf = async (engine: TestEngine, project: string, path: string) =>
  (await kitOf(engine, project))?.tokens.find((token) => (token as { path: string }).path === path) as Record<string, unknown> | undefined;

test("a token renames in place, its old name keeps answering until it is forgotten", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await row(dialog, "color/brand/primary").getByRole("button", { name: "Token options color/brand/primary" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const field = dialog.getByRole("textbox", { name: "Rename color/brand/primary" });
  await field.fill("color/brand/accent");
  await field.press("Enter");

  await expect(row(dialog, "color/brand/accent")).toContainText("Also answers to --color-brand-primary");
  await expect.poll(() => tokenOf(engine, project, "color/brand/accent")).toMatchObject({ formerNames: ["--color-brand-primary"] });
  await row(dialog, "color/brand/accent").getByRole("button", { name: "Forget --color-brand-primary" }).click();
  await expect(row(dialog, "color/brand/accent")).not.toContainText("Also answers to");
  await expect.poll(() => tokenOf(engine, project, "color/brand/accent")).not.toHaveProperty("formerNames");
});

test("deleting a token asks with its count, and deleting removes the row", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await row(dialog, "dimension/space/md").getByRole("button", { name: "Token options dimension/space/md" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByRole("heading", { name: "Delete dimension/space/md?" })).toBeVisible();
  await expect(confirm).toContainText("No artifact uses it.");
  await confirm.getByRole("button", { name: "Delete token" }).click();

  await expect(row(dialog, "dimension/space/md")).toHaveCount(0);
  await expect.poll(() => tokenOf(engine, project, "dimension/space/md")).toBeUndefined();
});

test("modes: add, make default, rename, duplicate and delete, the last one kept", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await dialog.getByRole("button", { name: "Add mode" }).click();
  await dialog.getByRole("textbox", { name: "Mode name", exact: true }).fill("night");
  await dialog.getByRole("textbox", { name: "Mode name", exact: true }).press("Enter");
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ modes: ["light", "dark", "night"] });

  await dialog.getByRole("button", { name: "Mode options dark" }).click();
  await page.getByRole("menuitem", { name: "Make default" }).click();
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ modes: ["dark", "light", "night"] });
  await expect(dialog.getByRole("columnheader", { name: /^dark/ })).toContainText("default");

  await dialog.getByRole("button", { name: "Mode options light" }).click();
  await page.getByRole("menuitem", { name: "Rename mode" }).click();
  const rename = dialog.getByRole("textbox", { name: "Mode name light" });
  await rename.fill("day");
  await rename.press("Enter");
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ modes: ["dark", "day", "night"] });

  await dialog.getByRole("button", { name: "Mode options dark" }).click();
  await page.getByRole("menuitem", { name: "Duplicate mode" }).click();
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ modes: ["dark", "day", "night", "dark-copy"] });
  await expect.poll(() => tokenOf(engine, project, "color/brand/primary")).toMatchObject({ values: { day: "#1a73e8", dark: "#8ab4f8", "dark-copy": "#8ab4f8" } });

  await dialog.getByRole("button", { name: "Mode options night" }).click();
  await page.getByRole("menuitem", { name: "Delete mode" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByRole("heading", { name: "Delete the night mode?" })).toBeVisible();
  await expect(confirm).toContainText("No artifact uses this mode.");
  await confirm.getByRole("button", { name: "Delete mode" }).click();
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ modes: ["dark", "day", "dark-copy"] });
});

test("Delete kit asks, and the project is left with no kit", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await dialog.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete kit" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByRole("heading", { name: "Delete this project's kit?" })).toBeVisible();
  await expect(confirm).toContainText("Pages and motions keep their files, and lose every token value. The library is untouched.");
  await confirm.getByRole("button", { name: "Delete kit" }).click();

  await expect(dialog).toContainText("This project has no kit yet.");
  await expect.poll(() => kitOf(engine, project)).toBeUndefined();
});

const libraryKits = async (engine: TestEngine): Promise<Array<Record<string, any>>> => {
  const { presets } = await (await engine.rpc()).call("library.list");
  return [...presets].filter((preset: { kind: string }) => preset.kind === "kit");
};

test("Save to library names the kit's size, saves it and links the project to it", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await dialog.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Save to library" }).click();
  const save = page.getByRole("dialog", { name: "Add to library" });
  await expect(save).toContainText("4 tokens and 2 modes, saved as you have them now.");
  await save.getByRole("textbox", { name: "Name" }).fill("Brand kit");
  await save.getByRole("button", { name: "Save" }).click();

  await expect(toast(page, "Saved “Brand kit” to your library.")).toBeVisible();
  await expect.poll(async () => (await libraryKits(engine)).map((preset) => [preset.name, preset.revision])).toEqual([["Brand kit", 1]]);
  const [preset] = await libraryKits(engine);
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ from: { presetId: preset!.id, revision: 1 } });
});

test("Update in library replaces the library kit, adds to its revision, and keeps the link", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);
  await dialog.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Save to library" }).click();
  const save = page.getByRole("dialog", { name: "Add to library" });
  await save.getByRole("textbox", { name: "Name" }).fill("Brand kit");
  await save.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Saved “Brand kit” to your library.")).toBeVisible();
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ from: { revision: 1 } });
  const dark = row(dialog, "color/brand/primary").locator("[data-mode='dark'] input");
  await dark.fill("#000000");
  await dark.press("Enter");
  await expect.poll(() => tokenOf(engine, project, "color/brand/primary")).toMatchObject({ values: { light: "#1a73e8", dark: "#000000" } });
  await dialog.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Update in library" }).click();

  await expect(toast(page, "Updated “Brand kit” in your library.")).toBeVisible();
  await expect.poll(async () => (await libraryKits(engine)).map((preset) => preset.revision)).toEqual([2]);
  const [preset] = await libraryKits(engine);
  expect(preset!.kit.tokens.find((token: { path: string }) => token.path === "color/brand/primary").values).toEqual({ light: "#1a73e8", dark: "#000000" });
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ from: { presetId: preset!.id, revision: 2 } });
});

const outputFolder = (engine: TestEngine, project: string) => join(engine.dataDir, "output", project);

test("import pasted CSS: the summary, then Import creates the kit as one undo step", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);
  await dialog.getByRole("button", { name: "Import" }).click();
  const importing = page.getByRole("dialog", { name: "Import" });
  await importing.getByRole("textbox", { name: "Paste" }).fill(":root { --color-brand-primary: #1a73e8; --space-md: 16px; }");

  await expect(importing).toContainText("Adds 2 tokens, changes 0, adds the default mode. Skips 0 it could not read.");
  await importing.getByRole("button", { name: "Import" }).click();

  await expect.poll(() => kitOf(engine, project)).toMatchObject({ name: "Kit", tokens: [expect.objectContaining({ path: "color/brand/primary", type: "color", value: "#1a73e8" }), expect.objectContaining({ path: "space/md", type: "dimension", value: "16px" })] });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => kitOf(engine, project)).toBeUndefined();
});

test("import a DTCG file as a mode: the file name gives the mode, and its tokens change", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);
  await dialog.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Import…" }).click();
  const importing = page.getByRole("dialog", { name: "Import" });

  const file = JSON.stringify({ color: { brand: { primary: { $type: "color", $value: "#000000" } } } });
  await dropFiles(page, await centre(importing.getByTestId("import-drop")), [{ name: "night.tokens.json", mime: "application/json", bytes: Buffer.from(file) }]);
  await expect(importing).toContainText("Adds 0 tokens, changes 1, adds the modes night. Skips 0 it could not read.");
  await importing.getByRole("button", { name: "Import" }).click();

  await expect.poll(() => kitOf(engine, project)).toMatchObject({ modes: ["light", "dark", "night"] });
  await expect.poll(() => tokenOf(engine, project, "color/brand/primary")).toMatchObject({ values: { light: "#1a73e8", dark: "#8ab4f8", night: "#000000" } });
});

test("export writes the kit to the project folder and says so with a Reveal action", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);
  await dialog.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "DTCG JSON" }).click();

  await expect(toast(page, /^Saved .*\.tokens\.json in the project folder\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible();
  const files = await readdir(outputFolder(engine, project));
  const exported = files.find((name) => name.endsWith(".tokens.json"));
  expect(exported).toBeDefined();
  expect(JSON.parse(await readFile(join(outputFolder(engine, project), exported!), "utf8"))).toMatchObject({ color: { brand: { primary: { $type: "color", $value: "#1a73e8" } } } });
});

const editorKit = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [
    { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
    { path: "color/brand/accent", type: "color", value: "#ff0000" },
    { path: "dimension/space/md", type: "dimension", value: "16px" },
    { path: "duration/motion/fast", type: "duration", value: "200ms" },
    { path: "font-weight/type/bold", type: "fontWeight", value: 700 },
    { path: "text-style/type/heading", type: "textStyle", value: { fontFamily: "Inter", fontSize: "32px", fontWeight: 700, lineHeight: 1.2, letterSpacing: "0px" } },
  ],
};

const openEditorKit = async (page: Page, engine: TestEngine, kit: unknown = editorKit) => {
  const project = await openCanvas(page, engine);
  await putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit } } }]);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  return { project, dialog: kitDialog(page) };
};

test("the colour popover edits the colour and its opacity, committed as one value", async ({ page, engine }) => {
  const { project, dialog } = await openEditorKit(page, engine);

  await row(dialog, "color/brand/primary").getByRole("button", { name: "Options color/brand/primary dark" }).click();
  await page.getByLabel("color/brand/primary dark colour").fill("#102030");
  await page.getByLabel("color/brand/primary dark colour").press("Tab");
  await expect.poll(() => tokenOf(engine, project, "color/brand/primary")).toMatchObject({ values: { light: "#1a73e8", dark: "#102030" } });

  await page.getByLabel("color/brand/primary dark opacity").fill("50");
  await page.getByLabel("color/brand/primary dark opacity").press("Enter");
  await expect.poll(() => tokenOf(engine, project, "color/brand/primary")).toMatchObject({ values: { light: "#1a73e8", dark: "#10203080" } });
});

test("a colour cell takes an alias from the Use a token list, and shows the target as a chip", async ({ page, engine }) => {
  const { project, dialog } = await openEditorKit(page, engine);

  await row(dialog, "color/brand/accent").getByRole("button", { name: "Options color/brand/accent", exact: true }).click();
  await expect(page.getByText("Use a token", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "color/brand/primary", exact: true }).click();

  await expect.poll(() => tokenOf(engine, project, "color/brand/accent")).toMatchObject({ value: "{color/brand/primary}" });
  await expect(row(dialog, "color/brand/accent").locator("[data-alias='color/brand/primary']")).toBeVisible();
});

test("a dimension is a number and a unit, and a duration takes its unit", async ({ page, engine }) => {
  const { project, dialog } = await openEditorKit(page, engine);

  const number = row(dialog, "dimension/space/md").getByLabel("dimension/space/md number");
  await number.fill("2");
  await number.press("Enter");
  await expect.poll(() => tokenOf(engine, project, "dimension/space/md")).toMatchObject({ value: "2px" });

  await row(dialog, "dimension/space/md").getByLabel("dimension/space/md unit").click();
  await page.getByRole("option", { name: "rem", exact: true }).click();
  await expect.poll(() => tokenOf(engine, project, "dimension/space/md")).toMatchObject({ value: "2rem" });

  await row(dialog, "duration/motion/fast").getByLabel("duration/motion/fast unit").click();
  await page.getByRole("option", { name: "s", exact: true }).click();
  await expect.poll(() => tokenOf(engine, project, "duration/motion/fast")).toMatchObject({ value: "200s" });
});

test("a font weight is a select of 100 to 900 and the keywords", async ({ page, engine }) => {
  const { project, dialog } = await openEditorKit(page, engine);

  await row(dialog, "font-weight/type/bold").getByLabel("font-weight/type/bold weight").click();
  await expect(page.getByRole("option")).toHaveCount(13);
  await page.getByRole("option", { name: "600", exact: true }).click();
  await expect.poll(() => tokenOf(engine, project, "font-weight/type/bold")).toMatchObject({ value: 600 });
});

test("a text style opens a popover with its five fields, each committed on its own", async ({ page, engine }) => {
  const { project, dialog } = await openEditorKit(page, engine);

  await row(dialog, "text-style/type/heading").getByRole("button", { name: "Options text-style/type/heading", exact: true }).click();
  const size = page.getByLabel("text-style/type/heading text style fontSize");
  await size.fill("40px");
  await size.press("Enter");
  await expect.poll(() => tokenOf(engine, project, "text-style/type/heading")).toMatchObject({ value: { fontFamily: "Inter", fontSize: "40px", fontWeight: 700, lineHeight: 1.2, letterSpacing: "0px" } });
  await expect(page.getByLabel("text-style/type/heading text style lineHeight")).toHaveValue("1.2");
});

test("the row menu's Description writes the token's description, and an empty one removes it", async ({ page, engine }) => {
  const { project, dialog } = await openEditorKit(page, engine);

  await row(dialog, "dimension/space/md").getByRole("button", { name: "Token options dimension/space/md" }).click();
  await page.getByRole("menuitem", { name: "Description", exact: true }).click();
  const field = dialog.getByRole("textbox", { name: "Description dimension/space/md" });
  await field.fill("Gap between cards");
  await field.press("Enter");
  await expect.poll(() => tokenOf(engine, project, "dimension/space/md")).toMatchObject({ value: "16px", description: "Gap between cards" });

  await row(dialog, "dimension/space/md").getByRole("button", { name: "Token options dimension/space/md" }).click();
  await page.getByRole("menuitem", { name: "Description", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Description dimension/space/md" }).fill("");
  await dialog.getByRole("textbox", { name: "Description dimension/space/md" }).press("Enter");
  await expect.poll(() => tokenOf(engine, project, "dimension/space/md")).not.toHaveProperty("description");
});

test("past 200 rows the table draws only the rows in view, and scrolling reaches the rest", async ({ page, engine }) => {
  const many = {
    ...editorKit,
    tokens: Array.from({ length: 260 }, (_, index) => ({ path: `dimension/space/t${String(index).padStart(3, "0")}`, type: "dimension", value: `${index}px` })),
  };
  const { dialog } = await openEditorKit(page, engine, many);

  await expect(row(dialog, "dimension/space/t000")).toBeVisible();
  await expect(dialog.locator("[data-token]")).not.toHaveCount(260);
  expect(await dialog.locator("[data-token]").count()).toBeLessThan(60);
  await expect(row(dialog, "dimension/space/t259")).toHaveCount(0);

  await dialog.locator('[data-slot="table-container"]').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(row(dialog, "dimension/space/t259")).toBeVisible();
});

const addToken = async (page: Page, dialog: Locator, path: string, type: string) => {
  await dialog.getByRole("button", { name: "Add token" }).click();
  await dialog.getByRole("textbox", { name: "Token path" }).fill(path);
  await dialog.getByRole("combobox", { name: "Token type" }).click();
  await page.getByRole("option", { name: type, exact: true }).click();
  await dialog.getByRole("textbox", { name: "Token path" }).press("Enter");
};

test("Add token with a path a token already has is refused in the same words as a rename, and the token keeps its value", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await addToken(page, dialog, "dimension/space/md", "color");
  await expect(dialog.getByRole("alert")).toHaveText("There is already a token dimension/space/md.");
  await expect.poll(() => tokenOf(engine, project, "dimension/space/md")).toMatchObject({ type: "dimension", value: "16px" });
});

test("Add token takes a text style, which starts with a valid line height", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await addToken(page, dialog, "text/lead", "textStyle");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(row(dialog, "text/lead")).toBeVisible();
  await expect.poll(() => tokenOf(engine, project, "text/lead")).toMatchObject({ type: "textStyle", value: { lineHeight: 1.5 } });
});

test("a font family that would write CSS is refused under its cell, and the token keeps its value", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await addToken(page, dialog, "font/body", "fontFamily");
  const cell = row(dialog, "font/body").getByRole("textbox", { name: "font/body" });
  await cell.fill("Inter; } body { display:none } .x {");
  await cell.press("Enter");
  await expect(row(dialog, "font/body").getByRole("alert")).toHaveText("Inter; } body { display:none } .x { is not a font family. Use a list of family names, like Inter, sans-serif.");
  await expect.poll(() => tokenOf(engine, project, "font/body")).toMatchObject({ value: "sans-serif" });
});

test("a refusal goes when Escape closes the Add token row, and does not follow to the next edit", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await dialog.getByRole("button", { name: "Add token" }).click();
  await dialog.getByRole("textbox", { name: "Token path" }).fill("Bad Name");
  await dialog.getByRole("textbox", { name: "Token path" }).press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("A token name is words joined by slashes, like color/brand/primary.");
  await dialog.getByRole("textbox", { name: "Token path" }).press("Escape");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Add token" })).toBeVisible();
});

test("a kit with one mode offers no Delete mode", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);
  await dialog.getByRole("button", { name: "New kit" }).click();

  await dialog.getByRole("button", { name: "Mode options default" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename mode" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete mode" })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("the table's header row stays on screen while the rows scroll", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await expect(dialog.locator("thead")).toHaveCSS("position", "sticky");
});

test("after Delete token, focus goes to the table's search field inside the dialog", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await seedKit(engine);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = kitDialog(page);

  await row(dialog, "dimension/space/md").getByRole("button", { name: "Token options dimension/space/md" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete token" }).click();

  await expect(row(dialog, "dimension/space/md")).toHaveCount(0);
  await expect(dialog.getByRole("searchbox", { name: "Search tokens" })).toBeFocused();
});
