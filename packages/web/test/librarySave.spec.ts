import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { emptyCanvasPoint, openCanvas, roomRecords, shapeOnScreen, toast } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { expectSlot, expectToken } from "./kit.ts";
import { presetsFile, writePresets } from "./library.ts";
import { artifactRecord, emptyMedia, groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";

const menu = (page: Page) => page.getByTestId("context-menu");
const addToLibrary = (page: Page) => menu(page).getByTestId("context-menu.unframed-add-to-library");
const saveDialog = (page: Page) => page.getByTestId("add-to-library");

const rightClickLabel = async (page: Page, id: string) => {
  const box = (await shapeOnScreen(page, id).boundingBox())!;
  // A person's pointer arrives before it clicks. tldraw updates the hovered shape at most every
  // 32 ms and a right click selects the hovered shape, so a click in the same instant as the move
  // can select whatever was under the pointer before (here, under a dialog that just closed).
  await page.mouse.move(box.x + 10, box.y - 8);
  await page.waitForTimeout(50);
  await page.mouse.click(box.x + 10, box.y - 8, { button: "right" });
};

const rightClickShape = async (page: Page, id: string) => {
  const box = (await shapeOnScreen(page, id).boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + 12, { button: "right" });
};

const savedPresets = async (engine: Parameters<typeof presetsFile>[0]) => JSON.parse(await readFile(presetsFile(engine), "utf8")) as any[];

const RECIPE = { medium: "image", model: "openai/gpt-image-2", params: { quality: "high" }, runs: 2 };

const board = [
  { ...groupRecord("shape:character", "character", { x: 440, y: 80 }), meta: { unframed: { recipe: RECIPE } } },
  inGroup(promptRecord("shape:line", "300", "a knight in silver armour"), "shape:character", { x: 28, y: 56 }),
  groupRecord("shape:set", "set", { x: 440, y: 440 }),
  inGroup(promptRecord("shape:set-a", "301", "a beach"), "shape:set", { x: 28, y: 56 }),
  inGroup(emptyMedia("shape:set-b", "image", "302", { x: 0, y: 0 }), "shape:set", { x: 28, y: 110 }),
  promptRecord("shape:loose", "303", "a loose line", { x: 40, y: 80 }),
  artifactRecord("shape:page", "page", "304", { x: 40, y: 440 }),
];

test("Add to library: enabled for one group or loose shapes, disabled with the reason for two groups, disabled for nothing groupable, gone on empty canvas", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, board);
  const ids = ["shape:character", "shape:set", "shape:loose", "shape:page"];
  for (const id of ids) await expect(shapeOnScreen(page, id)).toHaveCount(1);
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(400);
  for (const id of ids) await expect(shapeOnScreen(page, id)).toBeVisible();

  await rightClickLabel(page, "shape:character");
  await expect(addToLibrary(page)).toBeVisible();
  await expect(addToLibrary(page)).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await rightClickShape(page, "shape:loose");
  await expect(addToLibrary(page)).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  // Two groups cannot become one preset.
  await page.mouse.click(10, 400);
  const character = (await shapeOnScreen(page, "shape:character").boundingBox())!;
  const set = (await shapeOnScreen(page, "shape:set").boundingBox())!;
  await page.mouse.click(character.x + 10, character.y - 8);
  await page.keyboard.down("Shift");
  await page.mouse.click(set.x + 10, set.y - 8);
  await page.keyboard.up("Shift");
  await page.mouse.click(set.x + 10, set.y - 8, { button: "right" });
  await expect(addToLibrary(page)).toHaveAttribute("aria-disabled", "true");
  await expect(addToLibrary(page)).toHaveAttribute("title", "A preset is one group. Select one group, or shapes outside any group.");
  // The kit's disabled look: the row's own text colour at 64 %.
  expect(await addToLibrary(page).evaluate((element) => getComputedStyle(element).opacity)).toBe("0.64");
  await page.keyboard.press("Escape");

  // A page alone holds nothing a group may.
  await page.mouse.click(10, 400);
  await rightClickShape(page, "shape:page");
  await expect(addToLibrary(page)).toHaveAttribute("aria-disabled", "true");
  await expect(addToLibrary(page)).not.toHaveAttribute("title");
  await page.keyboard.press("Escape");

  await page.mouse.click(10, 400);
  const empty = await emptyCanvasPoint(page);
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  await expect(addToLibrary(page)).toHaveCount(0);
});

test("the save dialog counts the shapes and names the recipe, asks for a name, and saves what was selected when it opened", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, board);
  await expect(shapeOnScreen(page, "shape:line")).toBeVisible();

  await rightClickLabel(page, "shape:set");
  await addToLibrary(page).click();
  await expect(saveDialog(page).getByRole("heading", { name: "Add to library" })).toBeVisible();
  await expect(saveDialog(page)).toContainText("2 shapes, saved as you have them now.");
  await saveDialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(saveDialog(page)).toHaveCount(0);

  await rightClickLabel(page, "shape:character");
  await addToLibrary(page).click();
  const dialog = saveDialog(page);
  await expect(dialog).toContainText("1 shape and its recipe, saved as you have them now.");
  const name = dialog.getByRole("textbox", { name: "Name" });
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("placeholder", "e.g. Portrait retouch");
  await expect(dialog.getByRole("textbox", { name: "Description" })).toHaveAttribute("placeholder", "What it does, in a line");
  // The kit's Dialog at 420 px, its Inputs and its Buttons.
  await expectSlot(dialog, "dialog-popup");
  await expect.poll(async () => Math.round((await dialog.boundingBox())!.width)).toBe(420);
  await expectSlot(name, "input");
  await expectSlot(dialog.getByRole("textbox", { name: "Description" }), "input");
  await expectSlot(dialog.getByRole("button", { name: "Cancel" }), "dialog-close");
  await expectToken(dialog.getByRole("button", { name: "Save" }), "background-color", "--primary");

  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Give it a name.");

  // An edit made while the dialog is open is not saved: the content was captured at the click.
  const line = (await roomRecords(engine, "default")).find((record) => record.id === "shape:line")!;
  await putRecords(engine, [{ ...line, props: { ...line.props, richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "changed later" }] }] } } }]);
  await name.fill("Knight");
  await dialog.getByRole("textbox", { name: "Description" }).fill("A knight in silver");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page, "Saved “Knight” to your library.")).toBeVisible();

  const [saved] = await savedPresets(engine);
  expect(saved).toMatchObject({ format: 2, source: "user", name: "Knight", summary: "A knight in silver", kind: "recipe", medium: "image" });
  const shapes = saved.content.shapes;
  expect(saved.content.rootShapeIds).toHaveLength(1);
  expect(shapes.find((shape: any) => shape.id === saved.content.rootShapeIds[0])).toMatchObject({ type: "frame", props: { name: "character" }, meta: { unframed: { recipe: RECIPE } } });
  expect(JSON.stringify(shapes)).toContain("a knight in silver armour");
  expect(JSON.stringify(shapes)).not.toContain("changed later");
});

test("loose shapes are saved as a group named after the preset, pages left out", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, board);
  await expect(shapeOnScreen(page, "shape:loose")).toBeVisible();
  await page.mouse.click(10, 400);
  const loose = (await shapeOnScreen(page, "shape:loose").boundingBox())!;
  const pageShape = (await shapeOnScreen(page, "shape:page").boundingBox())!;
  await page.mouse.click(loose.x + 12, loose.y + 12);
  await page.keyboard.down("Shift");
  await page.mouse.click(pageShape.x + 12, pageShape.y + 12);
  await page.keyboard.up("Shift");
  await page.mouse.click(loose.x + 12, loose.y + 12, { button: "right" });
  await addToLibrary(page).click();
  await expect(saveDialog(page)).toContainText("1 shape, saved as you have them now.");
  await saveDialog(page).getByRole("textbox", { name: "Name" }).fill("Red Fox");
  await page.keyboard.press("Enter");
  await expect(saveDialog(page)).toHaveCount(0);
  const [saved] = await savedPresets(engine);
  expect(saved).toMatchObject({ kind: "group", name: "Red Fox" });
  expect(saved).not.toHaveProperty("medium");
  const root = saved.content.shapes.find((shape: any) => shape.id === saved.content.rootShapeIds[0]);
  expect(root).toMatchObject({ type: "frame", props: { name: "red-fox" } });
  expect(saved.content.shapes.map((shape: any) => shape.type).sort()).toEqual(["frame", "text"]);
});

test("a save that fails says so under the name and keeps the dialog open", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, board);
  await expect(shapeOnScreen(page, "shape:line")).toBeVisible();
  // A damaged presets.json: the engine refuses to write over it.
  await writePresets(engine, "[ not json");
  await rightClickLabel(page, "shape:character");
  await addToLibrary(page).click();
  await saveDialog(page).getByRole("textbox", { name: "Name" }).fill("Knight");
  await saveDialog(page).getByRole("button", { name: "Save" }).click();
  await expect(saveDialog(page).getByRole("alert")).toHaveText("Could not save. Is the local server running?");
  await expect(saveDialog(page)).toBeVisible();
  expect(await readFile(presetsFile(engine), "utf8")).toBe("[ not json");
});
