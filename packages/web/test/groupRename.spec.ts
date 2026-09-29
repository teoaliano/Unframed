import type { Page } from "@playwright/test";
import { openCanvas, plainText, roomRecords, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";

const nameField = (page: Page) => page.getByRole("textbox", { name: "Group name" });

/** A point on a group's label, above its top-left corner. */
const labelPoint = async (page: Page, id: string) => {
  const box = (await shapeOnScreen(page, id).boundingBox())!;
  return { x: box.x + 12, y: box.y - 8 };
};

const groupName = async (engine: Parameters<typeof roomRecords>[0], id = "shape:fox") =>
  (await roomRecords(engine, "default")).find((record) => record.id === id)?.props?.name;

const board = [
  groupRecord("shape:fox", "fox", { x: 440, y: 80 }),
  inGroup(promptRecord("shape:line", "300", "a red fox in the snow"), "shape:fox", { x: 28, y: 56 }),
];

test("double-clicking the label opens the name field with a fixed @ and the name selected; Enter commits", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, board);
  await expect(shapeOnScreen(page, "shape:fox")).toContainText("@fox");

  const at = await labelPoint(page, "shape:fox");
  await page.mouse.dblclick(at.x, at.y);
  const field = nameField(page);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("fox");
  expect(await field.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 3]);
  // The @ is fixed in front of the field, not part of what is typed.
  await expect(shapeOnScreen(page, "shape:fox").getByTestId("group-rename-prefix")).toHaveText("@");

  await page.keyboard.type("Red Fox");
  await page.keyboard.press("Enter");
  await expect(field).toHaveCount(0);
  await expect.poll(() => groupName(engine)).toBe("red-fox");
  await expect(shapeOnScreen(page, "shape:fox")).toContainText("@red-fox");
  // Double-clicking the label made no prompt.
  expect((await roomRecords(engine, "default")).filter((record) => record.type === "text")).toHaveLength(3);
});

test("F2 opens the field for the one selected group; Escape abandons the draft; blur commits", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, board);
  const at = await labelPoint(page, "shape:fox");
  await page.mouse.click(at.x, at.y);

  await page.keyboard.press("F2");
  const field = nameField(page);
  await expect(field).toBeFocused();
  await page.keyboard.type("vixen");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await groupName(engine)).toBe("fox");
  // Escape leaves the group selected, so F2 opens the field again.
  await page.keyboard.press("F2");
  await expect(field).toBeFocused();
  await page.keyboard.type("den");
  // Clicking elsewhere commits what was typed.
  await page.mouse.click(120, 520);
  await expect(field).toHaveCount(0);
  await expect.poll(() => groupName(engine)).toBe("den");
});

test("F2 does nothing unless exactly one group is selected", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [...board, groupRecord("shape:den", "den", { x: 440, y: 440 })]);
  await page.keyboard.press("F2");
  await page.waitForTimeout(200);
  await expect(nameField(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("F2");
  await page.waitForTimeout(200);
  await expect(nameField(page)).toHaveCount(0);
});

test("Backspace in the field edits the name and never deletes the box", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, board);
  const at = await labelPoint(page, "shape:fox");
  await page.mouse.dblclick(at.x, at.y);
  const field = nameField(page);
  await expect(field).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await expect(field).toHaveValue("fo");
  await page.keyboard.press("Enter");
  await expect.poll(() => groupName(engine)).toBe("fo");
  const shapes = (await roomRecords(engine, "default")).map((record) => record.id);
  expect(shapes).toEqual(expect.arrayContaining(["shape:fox", "shape:line"]));
});

test("a rename takes a suffix when the name is used, rewrites every prompt that references it, and one Cmd-Z undoes it all", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [
    ...board,
    groupRecord("shape:vixen", "vixen", { x: 440, y: 440 }),
    promptRecord("shape:uses", "301", "@fox runs past @fox-2 and @foxes", { x: 40, y: 80 }),
    promptRecord("shape:also", "302", "a portrait of @fox", { x: 40, y: 200 }),
    promptRecord("shape:answer", "303", "the model said @fox", { x: 40, y: 320 }, { unframed: { result: { sidecar: "1-a.json", medium: "text", model: "x/y", batchId: "b-1", runIndex: 1, runCount: 1, cost: null, sources: [] } } }),
  ]);
  const at = await labelPoint(page, "shape:fox");
  await page.mouse.dblclick(at.x, at.y);
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.type("Vixen");
  await page.keyboard.press("Enter");

  const renamed = await waitForRoom(engine, "default", (all) => (all.find((record) => record.id === "shape:fox")?.props?.name === "vixen-2" ? all : undefined));
  const text = (id: string) => plainText(renamed.find((record) => record.id === id));
  expect(text("shape:uses")).toBe("@vixen-2 runs past @fox-2 and @foxes");
  expect(text("shape:also")).toBe("a portrait of @vixen-2");
  // A text result is a model's answer: never rewritten.
  expect(text("shape:answer")).toBe("the model said @fox");

  await page.keyboard.press("ControlOrMeta+z");
  const undone = await waitForRoom(engine, "default", (all) => (all.find((record) => record.id === "shape:fox")?.props?.name === "fox" ? all : undefined));
  expect(plainText(undone.find((record) => record.id === "shape:uses"))).toBe("@fox runs past @fox-2 and @foxes");
  expect(plainText(undone.find((record) => record.id === "shape:also"))).toBe("a portrait of @fox");
});

test("an empty name or the current one changes nothing", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, board);
  const at = await labelPoint(page, "shape:fox");
  await page.mouse.dblclick(at.x, at.y);
  await page.keyboard.type("!!!");
  await page.keyboard.press("Enter");
  await page.mouse.dblclick(at.x, at.y);
  await page.keyboard.type("FOX");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  expect(await groupName(engine)).toBe("fox");
});
