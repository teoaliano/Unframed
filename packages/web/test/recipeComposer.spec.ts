import type { Page } from "@playwright/test";
import { openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { composer, openComposer, selectGroup, toolbar } from "./generation.ts";
import { expectSlot } from "./kit.ts";
import { groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";
import { expect, mediumOption, runsChip, setRuns, test, tray } from "./texting.ts";

type Engine = Parameters<typeof roomRecords>[0];

const recipeLine = (page: Page) => composer(page).getByTestId("recipe-line");
const recipeOf = async (engine: Engine, id = "shape:character") => (await roomRecords(engine, "default")).find((record) => record.id === id)?.meta?.unframed?.recipe;
const chip = (page: Page, id = "shape:character") => shapeOnScreen(page, id).getByTestId("recipe-chip");

const STANDING = { medium: "image", model: "google/gemini-3-pro-image", params: { aspect_ratio: "16:9" }, runs: 2 };

/** A group holding one prompt. */
const board = (id = "shape:character", name = "character", at = { x: 420, y: 40 }, ref = "300") => [
  groupRecord(id, name, at),
  inGroup(promptRecord(`${id}-line`, ref, "a knight in silver armour"), id, { x: 28, y: 56 }),
];

const withRecipe = (records: ReturnType<typeof board>, recipe: unknown) =>
  records.map((record) => (record.type === "frame" ? { ...record, meta: { unframed: { recipe } } } : record));

test("Save as recipe keeps the tray on the group as one undo step, and its chip appears on the label", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await putRecords(engine, board());
  await expect(shapeOnScreen(page, "shape:character-line")).toBeVisible();
  await selectGroup(page, "shape:character");
  await openComposer(page);

  const save = recipeLine(page).getByRole("button", { name: "Save as recipe" });
  await expect(save).toBeVisible();
  await save.hover();
  await expect(page.getByText("Keep these settings on @character. Its Generate uses them.")).toBeVisible();
  await setRuns(page, 3);
  await save.click();

  await expect.poll(() => recipeOf(engine)).toEqual({ medium: "image", model: "openai/gpt-image-2", params: { resolution: "1K", quality: "low", aspect_ratio: "1:1" }, runs: 3 });
  await expect(chip(page)).toHaveText("gpt-image-2 · 1:1 · ×3");
  await expect(recipeLine(page)).toContainText("Recipe of @character");
  await expect(recipeLine(page).getByRole("button", { name: "Clear recipe" })).toBeVisible();

  // Out of the composer, Cmd-Z takes back exactly the save.
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => recipeOf(engine)).toBeUndefined();
  await expect(chip(page)).toHaveCount(0);
  expect((await roomRecords(engine, "default")).find((record) => record.id === "shape:character")?.props?.name).toBe("character");
});

test("the composer opens on the recipe when one recipe group is selected, and on last-used values with two", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await putRecords(engine, [
    ...withRecipe(board(), STANDING),
    ...withRecipe(board("shape:notes", "notes", { x: 420, y: 420 }, "310"), { medium: "text", model: "openai/gpt-5", params: {}, runs: 1 }),
  ]);
  await expect(shapeOnScreen(page, "shape:notes-line")).toBeVisible();

  // Two recipe groups: no recipe applies, the bar is a plain Generate and the tray has last-used values.
  await selectGroup(page, "shape:character");
  const other = (await shapeOnScreen(page, "shape:notes").boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.click(other.x + 10, other.y - 8);
  await page.keyboard.up("Shift");
  await openComposer(page);
  await expect(mediumOption(page, "image")).toHaveAttribute("aria-checked", "true");
  await expect(tray(page).getByTestId("model-chip")).toHaveText("gpt-image-2");
  await expect(runsChip(page)).toHaveCount(0);
  await expect(recipeLine(page)).toHaveCount(0);
  await page.keyboard.press("Escape");

  await selectGroup(page, "shape:character");
  await toolbar(page).getByRole("button", { name: "Recipe" }).click();
  await expect(composer(page)).toBeVisible();
  await expect(mediumOption(page, "image")).toHaveAttribute("aria-checked", "true");
  await expect(tray(page).getByTestId("model-chip")).toHaveText("gemini-3-pro-image");
  await expect(tray(page).locator("[data-prop]")).toHaveText(["16:9", "2×"]);
  await page.keyboard.press("Escape");

  // A text recipe opens the composer on the text medium.
  await selectGroup(page, "shape:notes");
  await toolbar(page).getByRole("button", { name: "Recipe" }).click();
  await expect(mediumOption(page, "text")).toHaveAttribute("aria-checked", "true");
  await expect(tray(page).getByTestId("model-chip")).toHaveText("gpt-5");
});

test("the recipe line: Recipe of @name while the tray matches, Update recipe once it differs; editing the tray alone never writes the group", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await putRecords(engine, withRecipe(board(), STANDING));
  await expect(shapeOnScreen(page, "shape:character-line")).toBeVisible();
  await selectGroup(page, "shape:character");
  await toolbar(page).getByRole("button", { name: "Recipe" }).click();
  await expect(recipeLine(page)).toContainText("Recipe of @character");
  await expect(recipeLine(page).getByRole("button", { name: "Update recipe" })).toHaveCount(0);

  await setRuns(page, 4);
  await expect(recipeLine(page).getByRole("button", { name: "Update recipe" })).toBeVisible();
  await expect(recipeLine(page).getByRole("button", { name: "Clear recipe" })).toBeVisible();
  for (const name of ["Update recipe", "Clear recipe"]) await expectSlot(recipeLine(page).getByRole("button", { name }), "inline-button");
  await expect(recipeLine(page)).not.toContainText("Recipe of @character");
  await page.waitForTimeout(300);
  expect(await recipeOf(engine)).toEqual(STANDING);

  // Back to what the recipe holds, the line says so again.
  await setRuns(page, 2);
  await expect(recipeLine(page)).toContainText("Recipe of @character");
});

test("Update recipe writes the tray, Clear recipe removes it from the composer or the context menu, each one undo step", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await putRecords(engine, withRecipe(board(), STANDING));
  await expect(shapeOnScreen(page, "shape:character-line")).toBeVisible();
  await selectGroup(page, "shape:character");
  await toolbar(page).getByRole("button", { name: "Recipe" }).click();
  await setRuns(page, 4);
  await recipeLine(page).getByRole("button", { name: "Update recipe" }).click();
  await expect.poll(() => recipeOf(engine)).toEqual({ ...STANDING, runs: 4 });
  await expect(chip(page)).toHaveText("gemini-3-pro-image · 16:9 · ×4");
  await expect(recipeLine(page)).toContainText("Recipe of @character");

  await recipeLine(page).getByRole("button", { name: "Clear recipe" }).click();
  await expect.poll(() => recipeOf(engine)).toBeUndefined();
  await expect(chip(page)).toHaveCount(0);
  await expect(recipeLine(page).getByRole("button", { name: "Save as recipe" })).toBeVisible();

  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => recipeOf(engine)).toEqual({ ...STANDING, runs: 4 });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => recipeOf(engine)).toEqual(STANDING);

  // The context menu's Clear recipe, in its Edit section.
  const box = (await shapeOnScreen(page, "shape:character").boundingBox())!;
  await page.mouse.click(box.x + 10, box.y - 8, { button: "right" });
  await page.getByTestId("context-menu").getByRole("menuitem", { name: "Clear recipe" }).click();
  await expect.poll(() => recipeOf(engine)).toBeUndefined();
  const records = await roomRecords(engine, "default");
  expect(records.find((record) => record.id === "shape:character")?.props?.name).toBe("character");
  expect(records.find((record) => record.id === "shape:character-line")?.parentId).toBe("shape:character");
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => recipeOf(engine)).toEqual(STANDING);
});

test("clicking the chip opens the composer on the recipe", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await putRecords(engine, withRecipe(board(), STANDING));
  await expect(chip(page)).toHaveText("gemini-3-pro-image · 16:9 · ×2");
  await chip(page).click();
  await expect(composer(page)).toBeVisible();
  await expect(tray(page).getByTestId("model-chip")).toHaveText("gemini-3-pro-image");
  await expect(tray(page).locator("[data-prop]")).toHaveText(["16:9", "2×"]);
  await expect(recipeLine(page)).toContainText("Recipe of @character");
});
