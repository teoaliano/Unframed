import type { Page } from "@playwright/test";
import { copySelection, openCanvas, plainText, roomRecords, shapeOnScreen, waitForRoom, type AnyRecord } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const selectGroup = async (page: Page, id: string) => {
  const box = (await shapeOnScreen(page, id).boundingBox())!;
  await page.mouse.click(box.x + 10, box.y - 8);
};

const freshGroups = (records: AnyRecord[], before: Set<string>) => records.filter((record) => record.type === "frame" && !before.has(record.id));

test("a pasted group keeps its name, suffixed when taken, and its prompts follow it; the original is untouched", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [
    groupRecord("shape:fox", "fox", { x: 440, y: 80 }),
    inGroup(promptRecord("shape:line", "300", "@fox under the moon, like @100"), "shape:fox", { x: 28, y: 56 }),
    promptRecord("shape:outside", "301", "a portrait of @fox", { x: 40, y: 480 }),
  ]);
  const before = new Set((await roomRecords(engine, "default")).map((record) => record.id));
  await selectGroup(page, "shape:fox");
  await copySelection(page);
  await page.keyboard.press("ControlOrMeta+v");

  const records = await waitForRoom(engine, "default", (all) => (freshGroups(all, before).length === 1 && all.some((record) => record.type === "text" && !before.has(record.id)) ? all : undefined));
  const [pasted] = freshGroups(records, before);
  expect(pasted!.props.name).toBe("fox-2");
  const member = records.find((record) => record.parentId === pasted!.id && record.type === "text")!;
  // A reference to the pasted group follows it; a reference to a shape that was not pasted stays as typed.
  expect(plainText(member)).toBe("@fox-2 under the moon, like @100");
  expect(member.meta.ref).not.toBe("300");

  expect(records.find((record) => record.id === "shape:fox")!.props.name).toBe("fox");
  expect(plainText(records.find((record) => record.id === "shape:line"))).toBe("@fox under the moon, like @100");
  expect(plainText(records.find((record) => record.id === "shape:outside"))).toBe("a portrait of @fox");

  // A second paste takes the next free suffix.
  await page.keyboard.press("ControlOrMeta+v");
  const again = await waitForRoom(engine, "default", (all) => (freshGroups(all, before).length === 2 ? all : undefined));
  expect(freshGroups(again, before).map((record) => record.props.name).sort()).toEqual(["fox-2", "fox-3"]);
});

test("a pasted group with a minted @id gets a fresh minted one", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [groupRecord("shape:numbered", "160", { x: 440, y: 80 }), inGroup(promptRecord("shape:line", "300", "see @160"), "shape:numbered", { x: 28, y: 56 })]);
  const before = new Set((await roomRecords(engine, "default")).map((record) => record.id));
  await selectGroup(page, "shape:numbered");
  await copySelection(page);
  await page.keyboard.press("ControlOrMeta+v");
  const records = await waitForRoom(engine, "default", (all) => (freshGroups(all, before).length === 1 && all.some((record) => record.type === "text" && !before.has(record.id)) ? all : undefined));
  const [pasted] = freshGroups(records, before);
  expect(pasted!.props.name).toMatch(/^\d+$/);
  expect(pasted!.props.name).not.toBe("160");
  const member = records.find((record) => record.parentId === pasted!.id && record.type === "text")!;
  expect(plainText(member)).toBe(`see @${pasted!.props.name}`);
});
