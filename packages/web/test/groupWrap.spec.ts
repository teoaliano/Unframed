import type { Page } from "@playwright/test";
import { openCanvas, roomRecords, shapeOnScreen, waitForRoom, type AnyRecord } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { artifactRecord, emptyMedia, groupRecord, inGroup, putRecords } from "./media.ts";

/** Clicks a shape near its top-left corner, clear of any button on it. */
const clickShape = async (page: Page, id: string, shift = false) => {
  const box = (await shapeOnScreen(page, id).boundingBox())!;
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 10, box.y + 10);
  if (shift) await page.keyboard.up("Shift");
};

const screenBox = async (page: Page, id: string) => (await shapeOnScreen(page, id).boundingBox())!;

test("Cmd-G wraps the shapes that may be members in a new named group, keeps them in place and selects the group alone", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [
    emptyMedia("shape:a", "image", "150", { x: 440, y: 60 }),
    emptyMedia("shape:b", "image", "151", { x: 440, y: 300 }),
    groupRecord("shape:old", "160", { x: 40, y: 600 }),
    inGroup(emptyMedia("shape:c", "image", "152", { x: 0, y: 0 }), "shape:old", { x: 28, y: 56 }),
    artifactRecord("shape:page", "page", "153", { x: 800, y: 60 }),
  ]);
  await expect(shapeOnScreen(page, "shape:a")).toBeVisible();
  await page.keyboard.press("Shift+1");
  for (const id of ["shape:a", "shape:b", "shape:c", "shape:page"]) await expect(shapeOnScreen(page, id)).toBeVisible();
  await page.waitForTimeout(400);
  const before = await screenBox(page, "shape:a");

  // A page alone may not be a member: nothing happens.
  await clickShape(page, "shape:page");
  await page.keyboard.press("ControlOrMeta+g");
  await page.waitForTimeout(300);
  expect((await roomRecords(engine, "default")).filter((record) => record.type === "frame")).toHaveLength(1);

  await clickShape(page, "shape:a");
  await clickShape(page, "shape:b", true);
  await clickShape(page, "shape:c", true);
  await clickShape(page, "shape:page", true);
  await page.keyboard.press("ControlOrMeta+g");

  const records = await waitForRoom(engine, "default", (all) => (all.some((record) => record.type === "frame" && record.id !== "shape:old") ? all : undefined));
  const byId = (id: string) => records.find((record) => record.id === id)!;
  const group = records.find((record) => record.type === "frame" && record.id !== "shape:old") as AnyRecord;
  // Members span (68, 60) to (680, 796): the box is that plus 28 on the sides and bottom, 56 on top.
  expect(group).toMatchObject({ parentId: "page:page", x: 40, y: 4, props: { w: 668, h: 820, name: "161" } });
  expect(byId("shape:a")).toMatchObject({ parentId: group.id, x: 400, y: 56 });
  expect(byId("shape:b")).toMatchObject({ parentId: group.id, x: 400, y: 296 });
  // A member of another group moves into the new one; the page stays on the page.
  expect(byId("shape:c")).toMatchObject({ parentId: group.id, x: 28, y: 652 });
  expect(byId("shape:page").parentId).toBe("page:page");
  expect(byId("shape:old").parentId).toBe("page:page");
  // tldraw's own group shape is never made.
  expect(records.some((record) => record.type === "group")).toBe(false);

  const after = await screenBox(page, "shape:a");
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  await expect(shapeOnScreen(page, group.id)).toContainText(`@161`);

  // The new group is selected alone: deleting takes it and its members, nothing else.
  await page.keyboard.press("Delete");
  await expect
    .poll(async () => (await roomRecords(engine, "default")).filter((record) => record.typeName === "shape").map((record) => record.id).sort())
    .toEqual(["shape:old", "shape:page", "shape:starter-scene", "shape:starter-subject"]);
});
