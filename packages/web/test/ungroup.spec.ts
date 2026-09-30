import type { Page } from "@playwright/test";
import { openCanvas, roomRecords, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { emptyMedia, groupRecord, inGroup, putRecords } from "./media.ts";

const shapeIds = async (engine: Parameters<typeof roomRecords>[0]) =>
  (await roomRecords(engine, "default"))
    .filter((record) => record.typeName === "shape")
    .map((record) => record.id)
    .sort();

/** Selects a group by clicking its label. */
const selectGroup = async (page: Page, id: string) => {
  const box = (await shapeOnScreen(page, id).boundingBox())!;
  await page.mouse.click(box.x + 10, box.y - 8);
};

const board = [
  groupRecord("shape:group", "160", { x: 440, y: 40 }, { w: 320, h: 420 }),
  inGroup(emptyMedia("shape:a", "image", "150", { x: 0, y: 0 }), "shape:group", { x: 28, y: 56 }),
  inGroup(emptyMedia("shape:b", "image", "151", { x: 0, y: 0 }), "shape:group", { x: 28, y: 240 }),
];

test("Cmd-Shift-G removes the group and leaves its members where they are, selected", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, board);
  await expect(shapeOnScreen(page, "shape:b")).toBeVisible();
  const before = (await shapeOnScreen(page, "shape:b").boundingBox())!;

  await selectGroup(page, "shape:group");
  await page.keyboard.press("ControlOrMeta+Shift+g");
  const records = await waitForRoom(engine, "default", (all) => (all.some((record) => record.id === "shape:group") ? undefined : all));
  expect(records.find((record) => record.id === "shape:a")).toMatchObject({ parentId: "page:page", x: 468, y: 96 });
  expect(records.find((record) => record.id === "shape:b")).toMatchObject({ parentId: "page:page", x: 468, y: 280 });
  const after = (await shapeOnScreen(page, "shape:b").boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);

  // The members are selected: deleting takes both and leaves the prompts.
  await page.keyboard.press("Delete");
  await expect.poll(() => shapeIds(engine)).toEqual(["shape:starter-scene", "shape:starter-subject"]);
});

test("deleting a group deletes its members, and one undo brings them all back", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, board);
  await expect(shapeOnScreen(page, "shape:b")).toBeVisible();

  await selectGroup(page, "shape:group");
  await page.keyboard.press("Delete");
  await expect.poll(() => shapeIds(engine)).toEqual(["shape:starter-scene", "shape:starter-subject"]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => shapeIds(engine)).toEqual(["shape:a", "shape:b", "shape:group", "shape:starter-scene", "shape:starter-subject"]);
  const records = await roomRecords(engine, "default");
  expect(records.find((record) => record.id === "shape:a")!.parentId).toBe("shape:group");
});
