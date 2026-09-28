import type { Page } from "@playwright/test";
import { openCanvas, roomRecords, settledRecord, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { artifactRecord, emptyMedia, groupRecord, putRecords } from "./media.ts";

/** Drags a shape by a point near its top-left corner to a screen point, slowly enough for tldraw to reparent. */
const dragShapeTo = async (page: Page, id: string, to: { x: number; y: number }, byLabel = false) => {
  const box = (await shapeOnScreen(page, id).boundingBox())!;
  // A group is picked up by its label; its inside passes clicks through, as a tldraw frame does.
  await page.mouse.move(box.x + 10, byLabel ? box.y - 8 : box.y + 10);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(250);
  await page.mouse.up();
};

test("the frame tool draws an empty group named with the next ref, at least 180 by 96", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const before = new Set((await roomRecords(engine, "default")).map((record) => record.id));

  await page.keyboard.press("f");
  await page.mouse.move(700, 150);
  await page.mouse.down();
  await page.mouse.move(1000, 350, { steps: 8 });
  await page.mouse.up();
  const drawn = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "frame" && !before.has(record.id)));
  const settled = (await settledRecord(engine, "default", drawn.id))!;
  expect(settled.props.name).toBe("102");
  expect(settled.props.w).toBeCloseTo(300, 0);
  expect(settled.props.h).toBeCloseTo(200, 0);
  await expect(shapeOnScreen(page, drawn.id)).toContainText("@102");

  await page.keyboard.press("f");
  await page.mouse.move(700, 450);
  await page.mouse.down();
  await page.mouse.move(740, 470, { steps: 4 });
  await page.mouse.up();
  const small = await waitForRoom(engine, "default", (records) =>
    records.find((record) => record.type === "frame" && !before.has(record.id) && record.id !== drawn.id),
  );
  const smallSettled = (await settledRecord(engine, "default", small.id))!;
  expect(smallSettled.props).toMatchObject({ w: 180, h: 96, name: "103" });
});

test("dragging a prompt or image into a group makes it a member; a page, a motion or a group stays on the page", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [
    groupRecord("shape:group", "160", { x: 440, y: 40 }, { w: 600, h: 600 }),
    emptyMedia("shape:image", "image", "150", { x: 1100, y: 60 }),
    artifactRecord("shape:page", "page", "151", { x: 1100, y: 260 }),
    groupRecord("shape:other", "161", { x: 1100, y: 620 }, { w: 200, h: 120 }),
  ]);
  await expect(shapeOnScreen(page, "shape:other")).toHaveCount(1);
  await page.keyboard.press("Shift+1");
  await expect(shapeOnScreen(page, "shape:other")).toBeVisible();
  await page.waitForTimeout(400);
  const group = (await shapeOnScreen(page, "shape:group").boundingBox())!;
  const inside = (dx: number, dy: number) => ({ x: group.x + group.width * dx, y: group.y + group.height * dy });

  await dragShapeTo(page, "shape:image", inside(0.2, 0.2));
  await dragShapeTo(page, "shape:page", inside(0.2, 0.5));
  await dragShapeTo(page, "shape:other", inside(0.6, 0.6), true);
  await dragShapeTo(page, "shape:starter-subject", inside(0.5, 0.15));

  await expect
    .poll(async () => {
      const records = await roomRecords(engine, "default");
      return Object.fromEntries(["shape:image", "shape:page", "shape:other", "shape:starter-subject"].map((id) => [id, records.find((record) => record.id === id)?.parentId]));
    })
    .toEqual({ "shape:image": "shape:group", "shape:page": "page:page", "shape:other": "page:page", "shape:starter-subject": "shape:group" });
  // The refused shapes did move over the group; they just stayed on the page.
  const records = await roomRecords(engine, "default");
  expect(["shape:page", "shape:other"].map((id) => [id, records.find((record) => record.id === id)!.x < 1040])).toEqual([["shape:page", true], ["shape:other", true]]);
});
