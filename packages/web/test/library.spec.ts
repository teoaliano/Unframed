import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { openCanvas, toast } from "./canvas.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";
import { libraryDialog, openLibrary, presetItem, presetsFile, shownNames, userPreset, writePresets } from "./library.ts";

const toggle = (page: Page, group: string, name: string) => libraryDialog(page).getByRole("group", { name: group }).getByRole("button", { name, exact: true });

test("the Library dialog: both rows of controls, the system presets, and the empty message", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const button = page.getByRole("button", { name: "Library" });
  await button.hover();
  await expect(page.getByText("Ready-made flows and styles")).toBeVisible();
  const dialog = await openLibrary(page);
  await expect(dialog.getByRole("heading", { name: "Library" })).toBeVisible();
  const search = dialog.getByRole("textbox", { name: "Search presets" });
  await expect(search).toHaveAttribute("placeholder", "Search presets…");
  await expect(dialog.getByRole("combobox", { name: "Sort" })).toHaveText("Newest");
  await expect(dialog.getByRole("group", { name: "View" }).getByRole("button")).toHaveCount(2);
  await expect(toggle(page, "View", "Cards")).toHaveAttribute("aria-pressed", "true");
  await expect(toggle(page, "View", "List")).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Type" }).getByRole("button")).toHaveText(["All", "Recipes", "Groups"]);
  await expect(dialog.getByRole("group", { name: "Source" }).getByRole("button")).toHaveText(["Any", "Custom", "System"]);
  expect(await shownNames(page)).toEqual(["Layerize", "Prose to JSON"]);
  // Ten presets or fewer need no pages.
  await expect(dialog.getByRole("navigation", { name: "Pages" })).toHaveCount(0);

  await search.fill("nothing like this");
  await expect(dialog).toContainText("Nothing here yet. Try another category or clear the search.");
  await search.fill("");
  await toggle(page, "Type", "Groups").click();
  await expect(dialog).toContainText("Nothing here yet. Try another category or clear the search.");
  await toggle(page, "Type", "All").click();
  await toggle(page, "Source", "Custom").click();
  await expect(dialog).toContainText("Nothing here yet. Try another category or clear the search.");
});

test("user presets come first by the sort, are filtered and searched, and page by 10 past ten", async ({ page, engine }) => {
  const many = Array.from({ length: 13 }, (_, index) =>
    userPreset(`user-${index}`, `Preset ${String(index).padStart(2, "0")}`, { savedAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(), summary: index === 3 ? "Soft light for faces" : "" }),
  );
  await writePresets(engine, [...many, userPreset("user-recipe", "A recipe", { savedAt: "2025-01-01T00:00:00.000Z", recipe: { medium: "video" } })]);
  await openCanvas(page, engine);
  const dialog = await openLibrary(page);
  const names = await shownNames(page);
  expect(names).toHaveLength(10);
  expect(names.slice(0, 3)).toEqual(["Preset 12", "Preset 11", "Preset 10"]);
  const pages = dialog.getByRole("navigation", { name: "Pages" });
  await expect(pages.getByTestId("library-range")).toHaveText("1–10 of 16");
  await pages.getByRole("button", { name: "Next page" }).click();
  await expect(pages.getByTestId("library-range")).toHaveText("11–16 of 16");
  expect(await shownNames(page)).toEqual(["Preset 02", "Preset 01", "Preset 00", "A recipe", "Layerize", "Prose to JSON"]);

  // A new sort goes back to page 1.
  await dialog.getByRole("combobox", { name: "Sort" }).click();
  await page.getByRole("option", { name: "A–Z" }).click();
  await expect(pages.getByTestId("library-range")).toHaveText("1–10 of 16");
  expect((await shownNames(page)).slice(0, 2)).toEqual(["A recipe", "Layerize"]);

  await toggle(page, "Type", "Recipes").click();
  expect(await shownNames(page)).toEqual(["A recipe", "Layerize", "Prose to JSON"]);
  await toggle(page, "Source", "System").click();
  expect(await shownNames(page)).toEqual(["Layerize", "Prose to JSON"]);
  await toggle(page, "Source", "Any").click();
  await toggle(page, "Type", "All").click();
  await dialog.getByRole("textbox", { name: "Search presets" }).fill("SOFT light");
  expect(await shownNames(page)).toEqual(["Preset 03"]);
});

test("cards and rows show the name, summary, needs and chips, Add, and delete only on user presets", async ({ page, engine }) => {
  await writePresets(engine, [userPreset("user-a", "Portrait retouch", { summary: "Soft light for faces", recipe: { medium: "image" } })]);
  await openCanvas(page, engine);
  await openLibrary(page);

  const mine = presetItem(page, "Portrait retouch");
  await expect(mine).toContainText("Soft light for faces");
  await expect(mine.getByTestId("preset-chips").locator("[data-chip]")).toHaveText(["Recipe", "Image", "Custom"]);
  await expect(mine.getByRole("button", { name: "Add" })).toBeVisible();
  await expect(mine.getByRole("button", { name: "Delete Portrait retouch" })).toBeVisible();

  const layerize = presetItem(page, "Layerize");
  await expect(layerize).toContainText("Split an image into its parts as separate generations");
  await expect(layerize.getByTestId("preset-needs")).toHaveText(
    "Drop your picture into the image, then Generate to write the plan. Then select the plan with your picture, set Runs to Free and Generate.",
  );
  await expect(layerize.getByTestId("preset-chips").locator("[data-chip]")).toHaveText(["Recipe", "Text", "System"]);
  await expect(layerize.getByRole("button", { name: /^Delete/ })).toHaveCount(0);

  await toggle(page, "View", "List").click();
  await expect(libraryDialog(page)).toHaveAttribute("data-view", "list");
  const row = presetItem(page, "Portrait retouch");
  await expect(row.getByTestId("preset-chips").locator("[data-chip]")).toHaveText(["Recipe", "Image", "Custom"]);
  await expect(row.getByText("Soft light for faces")).toHaveAttribute("title", "Soft light for faces");
  await expect(row.getByRole("button", { name: "Add" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Delete Portrait retouch" })).toBeVisible();
  await expect(presetItem(page, "Prose to JSON").getByRole("button", { name: /^Delete/ })).toHaveCount(0);
});

test("the view choice is remembered across reloads and an engine restart, and opens as cards when the preference cannot be read", async ({ page }) => {
  const engine = await startHostedEngine();
  try {
    await openCanvas(page, engine);
    await openLibrary(page);
    await toggle(page, "View", "List").click();
    await expect(libraryDialog(page)).toHaveAttribute("data-view", "list");
    await expect.poll(async () => (await (await engine.rpc()).call("preferences.get", { keys: ["library.view"] })).values).toEqual({ "library.view": "list" });

    await page.reload();
    await openCanvas(page, engine);
    await openLibrary(page);
    await expect(libraryDialog(page)).toHaveAttribute("data-view", "list");
    await expect(toggle(page, "View", "List")).toHaveAttribute("aria-pressed", "true");
  } finally {
    await engine.stop();
  }
  const again = await startHostedEngine({ dataDir: engine.dataDir });
  try {
    expect(again.port).not.toBe(engine.port);
    await openCanvas(page, again);
    await openLibrary(page);
    await expect(libraryDialog(page)).toHaveAttribute("data-view", "list");
    await page.keyboard.press("Escape");

    await (await again.rpc()).call("preferences.set", { key: "library.view", value: { not: "a view" } });
    await openLibrary(page);
    await expect(libraryDialog(page)).toHaveAttribute("data-view", "card");
  } finally {
    await again.dispose();
    await engine.dispose();
  }
});

test("delete asks first, removes the preset, and says so when it fails", async ({ page, engine }) => {
  await writePresets(engine, [userPreset("user-a", "Keep me"), userPreset("user-b", "Drop me")]);
  await openCanvas(page, engine);
  await openLibrary(page);
  await presetItem(page, "Drop me").getByRole("button", { name: "Delete Drop me" }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert.getByRole("heading", { name: "Delete preset?" })).toBeVisible();
  await expect(alert).toContainText("This removes “Drop me” from your library. Shapes already on the canvas are untouched. This can't be undone.");
  await alert.getByRole("button", { name: "Cancel" }).click();
  await expect(alert).toHaveCount(0);
  expect(await shownNames(page)).toContain("Drop me");

  await presetItem(page, "Drop me").getByRole("button", { name: "Delete Drop me" }).click();
  await alert.getByRole("button", { name: "Delete preset" }).click();
  await expect.poll(() => shownNames(page)).toEqual(["Keep me", "Layerize", "Prose to JSON"]);
  expect(JSON.parse(await readFile(presetsFile(engine), "utf8")).map((entry: any) => entry.id)).toEqual(["user-a"]);

  // The file goes bad behind the dialog's back: the engine refuses, and the dialog says so.
  await writePresets(engine, "[ not json");
  await presetItem(page, "Keep me").getByRole("button", { name: "Delete Keep me" }).click();
  await alert.getByRole("button", { name: "Delete preset" }).click();
  await expect(toast(page, "Could not delete that preset. Is the local server running?")).toBeVisible();
});

test("the dialog reads the file every time it opens, and says so, keeping the system presets, when it cannot", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await openLibrary(page);
  expect(await shownNames(page)).toEqual(["Layerize", "Prose to JSON"]);
  await page.keyboard.press("Escape");
  await expect(libraryDialog(page)).toHaveCount(0);

  // Saved in another tab, or written by another engine.
  await writePresets(engine, [userPreset("user-a", "From elsewhere")]);
  await openLibrary(page);
  expect(await shownNames(page)).toEqual(["From elsewhere", "Layerize", "Prose to JSON"]);
  await page.keyboard.press("Escape");

  await writePresets(engine, "[ not json");
  await openLibrary(page);
  await expect(libraryDialog(page).getByRole("alert")).toHaveText("Your presets could not be read: presets.json is not valid JSON.");
  expect(await shownNames(page)).toEqual(["Layerize", "Prose to JSON"]);
});
