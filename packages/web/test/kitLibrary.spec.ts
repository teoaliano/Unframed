import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { openCanvas, roomRecords, toast } from "./canvas.ts";
import { libraryDialog, openLibrary, presetItem, writePresets } from "./library.ts";
import { putRecords } from "./media.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** The Library with kits (spec 19 tasks 30 and 31): the Kits filter, Apply, the replace confirm, delete, and Update from kit. */

type KitRecord = { name: string; modes: string[]; tokens: Array<{ path: string; value?: unknown; values?: Record<string, unknown> }>; from?: { presetId: string; revision: number; base: unknown } };

const kitOf = async (engine: TestEngine, project: string): Promise<KitRecord | undefined> => {
  const document = (await roomRecords(engine, project)).find((record) => record.typeName === "document") as { meta?: { unframed?: { kit?: KitRecord } } } | undefined;
  return document?.meta?.unframed?.kit;
};

const libraryKits = async (engine: TestEngine): Promise<Array<Record<string, any>>> => {
  const { presets } = await (await engine.rpc()).call("library.list");
  return [...presets].filter((preset: { kind: string }) => preset.kind === "kit");
};

/** A kit preset as `presets.json` holds it: its values, a name and a revision, and no content. */
const libraryKit = (id: string, name: string, options: { revision?: number; modes?: string[]; tokens?: unknown[] } = {}) => ({
  format: 2,
  id,
  source: "user",
  savedAt: "2026-09-01T10:00:00.000Z",
  name,
  summary: "",
  kind: "kit",
  revision: options.revision ?? 1,
  kit: {
    name,
    modes: options.modes ?? ["light", "dark"],
    tokens: options.tokens ?? [
      { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
      { path: "dimension/space/md", type: "dimension", value: "16px" },
    ],
  },
});

/** A project kit seeded into the room. */
const seedKit = (engine: TestEngine, kit: unknown) => putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit } } }]);

const mine = {
  format: 1,
  name: "Mine",
  modes: ["light", "dark"],
  tokens: [
    { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
    { path: "duration/motion/fast", type: "duration", value: "200ms" },
  ],
};

const openKitsFilter = async (page: Page) => {
  const dialog = await openLibrary(page);
  await dialog.getByRole("button", { name: "Kits", exact: true }).click();
  return dialog;
};

test("the Kits filter lists kit cards with their counts, a Kit chip and Apply", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writePresets(engine, [libraryKit("kit-brand", "Brand")]);
  const dialog = await openKitsFilter(page);

  const card = presetItem(page, "Brand");
  await expect(card).toBeVisible();
  await expect(card).toContainText("2 tokens · 2 modes");
  await expect(card.locator("[data-chip='kit']")).toHaveText("Kit");
  await expect(card.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Recipes", exact: true }).click();
  await expect(card).toHaveCount(0);
});

test("Apply on a project with no kit copies the kit in, linked to its preset, as one undo step", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await writePresets(engine, [libraryKit("kit-brand", "Brand")]);
  await openKitsFilter(page);

  await presetItem(page, "Brand").getByRole("button", { name: "Apply", exact: true }).click();
  await expect(toast(page, "Applied “Brand” to this project.")).toBeVisible();
  await expect(libraryDialog(page)).toHaveCount(0);
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ name: "Brand", modes: ["light", "dark"], from: { presetId: "kit-brand", revision: 1 } });

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => kitOf(engine, project)).toBeUndefined();
});

test("Apply on a project with another kit asks first, then replaces it and keeps the project's own tokens", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await seedKit(engine, mine);
  // The seeded kit has to reach the open canvas before Apply reads it.
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Kit" }).getByRole("textbox", { name: "Kit name" })).toHaveValue("Mine");
  await page.keyboard.press("Escape");
  await writePresets(engine, [
    libraryKit("kit-brand", "Brand", {
      modes: ["light", "night"],
      tokens: [
        { path: "color/brand/primary", type: "color", value: "#0b57d0" },
        { path: "color/brand/accent", type: "color", value: "#ff0000" },
      ],
    }),
  ]);
  await openKitsFilter(page);

  await presetItem(page, "Brand").getByRole("button", { name: "Apply", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByRole("heading", { name: "Replace this project's kit?" })).toBeVisible();
  await expect(confirm).toContainText("“Brand” takes the place of “Mine”. Tokens with the same name take the new values. Tokens only this project has stay, so no page loses a value.");
  await confirm.getByRole("button", { name: "Apply kit" }).click();

  await expect(toast(page, "Applied “Brand” to this project.")).toBeVisible();
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ name: "Brand", modes: ["light", "dark", "night"], from: { presetId: "kit-brand", revision: 1 } });
  await expect.poll(() => kitOf(engine, project)).toMatchObject({
    tokens: expect.arrayContaining([
      expect.objectContaining({ path: "color/brand/primary", value: "#0b57d0" }),
      expect.objectContaining({ path: "color/brand/accent", value: "#ff0000" }),
      expect.objectContaining({ path: "duration/motion/fast", value: "200ms" }),
    ]),
  });
});

test("From library in the empty Kit dialog opens the Library on the Kits filter", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writePresets(engine, [libraryKit("kit-brand", "Brand")]);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const kit = page.getByRole("dialog", { name: "Kit" });
  await kit.getByRole("button", { name: "From library" }).click();

  const dialog = libraryDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Kits", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(presetItem(page, "Brand")).toBeVisible();
  await expect(kit).toHaveCount(0);
});

test("Delete on a kit card asks with the kit's own body, and removes it", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writePresets(engine, [libraryKit("kit-brand", "Brand")]);
  await openKitsFilter(page);

  await page.getByRole("button", { name: "Delete Brand" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("This removes “Brand” from your library. Projects that use it keep their copy. This can't be undone.");
  await confirm.getByRole("button", { name: "Delete preset" }).click();

  await expect(presetItem(page, "Brand")).toHaveCount(0);
  await expect.poll(() => libraryKits(engine)).toEqual([]);
});

const tokenOf = async (engine: TestEngine, project: string, path: string) =>
  (await kitOf(engine, project))?.tokens.find((token) => token.path === path) as Record<string, any> | undefined;

/** The project's kit as it took the library kit at revision 1: primary, a space token it changed, and one it added. */
const linkedKit = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [
    { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
    { path: "dimension/space/md", type: "dimension", value: "18px" },
    { path: "dimension/space/lg", type: "dimension", value: "24px" },
  ],
  from: {
    presetId: "kit-brand",
    revision: 1,
    base: {
      modes: ["light", "dark"],
      tokens: [
        { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
        { path: "dimension/space/md", type: "dimension", value: "16px" },
      ],
    },
  },
};

/** The library kit at revision 2: primary's light value changed, space md changed, and a colour added. */
const newerLibraryKit = libraryKit("kit-brand", "Brand", {
  revision: 2,
  tokens: [
    { path: "color/brand/primary", type: "color", values: { light: "#0b57d0", dark: "#8ab4f8" } },
    { path: "dimension/space/md", type: "dimension", value: "20px" },
    { path: "color/brand/accent", type: "color", value: "#ff0000" },
  ],
});

/** Seeds a project kit into the open canvas, opens the Kit dialog on it, and returns the dialog. */
const openSeededKit = async (page: Page, engine: TestEngine, kit: { name: string }) => {
  await seedKit(engine, kit);
  await page.getByRole("button", { name: "Kit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Kit" });
  await expect(dialog.getByRole("textbox", { name: "Kit name" })).toHaveValue(kit.name);
  return dialog;
};

test("the source line names the library kit, and a newer library revision offers Update from kit", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await writePresets(engine, [newerLibraryKit]);
  const dialog = await openSeededKit(page, engine, linkedKit);

  await expect(dialog).toContainText("From “Brand” in your library.");
  await dialog.getByRole("button", { name: "Update from kit", exact: true }).click();

  const update = page.getByRole("dialog", { name: "Update from “Brand”" });
  await expect(update).toContainText("1 updated, 1 added, 2 kept as you changed them here, 0 no longer in the kit");
  const conflict = update.locator('[data-conflict="dimension/space/md|light"]');
  await expect(conflict).toContainText("Here: 18px");
  await expect(conflict).toContainText("Kit: 20px");
  await expect(conflict.getByRole("button", { name: "Keep mine", exact: true })).toHaveAttribute("aria-pressed", "true");
  await conflict.getByRole("button", { name: "Take the kit's", exact: true }).click();
  await update.getByRole("button", { name: "Update", exact: true }).click();

  await expect(update).toHaveCount(0);
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ from: { presetId: "kit-brand", revision: 2 } });
  await expect.poll(() => tokenOf(engine, project, "color/brand/accent")).toMatchObject({ value: "#ff0000" });
  await expect.poll(() => tokenOf(engine, project, "color/brand/primary")).toMatchObject({ values: { light: "#0b57d0", dark: "#8ab4f8" } });
  await expect.poll(() => tokenOf(engine, project, "dimension/space/md")).toMatchObject({ values: { light: "20px", dark: "18px" } });
  await expect.poll(() => tokenOf(engine, project, "dimension/space/lg")).toMatchObject({ value: "24px" });

  // One undo step takes the whole update back.
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ from: { revision: 1 } });
  await expect.poll(() => tokenOf(engine, project, "dimension/space/md")).toMatchObject({ value: "18px" });
});

test("a library kit that is gone is said so, and the project keeps its copy", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writePresets(engine, []);
  const dialog = await openSeededKit(page, engine, linkedKit);

  // The dialog never read the library kit, so its name is not known; the project's kit name is not used in its place.
  await expect(dialog).toContainText("The library kit is gone. This project keeps its copy.");
  await expect(dialog.getByRole("button", { name: "Update from kit", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Update in library" })).toHaveCount(0);
});

test("Update in library refused for a newer library revision says so, and offers Update from kit", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writePresets(engine, [newerLibraryKit]);
  const dialog = await openSeededKit(page, engine, linkedKit);

  await dialog.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Update in library" }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("The library kit changed since this project took it. Update from kit first, so you do not overwrite those changes.");
  await expect(toast(page, "Updated “Brand” in your library.")).toHaveCount(0);
  await alert.getByRole("button", { name: "Update from kit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Update from “Brand”" })).toBeVisible();
});

test("Apply on the kit a project came from acts as Update from kit", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await writePresets(engine, [newerLibraryKit]);
  const dialog = await openSeededKit(page, engine, linkedKit);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await openKitsFilter(page);
  await presetItem(page, "Brand").getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Update from “Brand”" })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect.poll(() => kitOf(engine, project)).toMatchObject({ from: { presetId: "kit-brand", revision: 1 } });
});

test("with no differences from the library kit, Update from kit is not offered", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const same = libraryKit("kit-brand", "Brand", {
    revision: 2,
    tokens: [
      { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
      { path: "dimension/space/md", type: "dimension", value: "16px" },
    ],
  });
  await writePresets(engine, [same]);
  const dialog = await openSeededKit(page, engine, linkedKit);

  await expect(dialog).toContainText("From “Brand” in your library.");
  await expect(dialog.getByRole("button", { name: "Update from kit", exact: true })).toHaveCount(0);
});
