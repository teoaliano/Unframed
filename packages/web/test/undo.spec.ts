import type { Page } from "@playwright/test";
import { centre, openCanvas, roomRecords, settledRecord, shapeOnScreen, type AnyRecord } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

const dragBy = async (page: Page, id: string, dx: number, dy: number) => {
  const from = await centre(shapeOnScreen(page, id));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(from.x + (dx * step) / 8, from.y + (dy * step) / 8);
  await page.mouse.up();
};

const record = async (engine: Parameters<typeof roomRecords>[0], id: string) =>
  (await roomRecords(engine, "default")).find((each) => each.id === id);

test("Cmd-Z undoes only this tab's edit: another tab's edit and an engine-side change stay, and both redo keys redo", async ({ page, context, engine }) => {
  await openCanvas(page, engine);
  const other = await context.newPage();
  await openCanvas(other, engine);
  const scene = (await record(engine, "shape:starter-scene"))!;
  const subject = (await record(engine, "shape:starter-subject"))!;

  await dragBy(page, "shape:starter-scene", 80, 0);
  await expect.poll(async () => (await record(engine, "shape:starter-scene"))!.x).toBeGreaterThan(scene.x! + 5);
  const movedScene = (await settledRecord(engine, "default", "shape:starter-scene"))!;

  await dragBy(other, "shape:starter-subject", 0, 60);
  await expect.poll(async () => (await record(engine, "shape:starter-subject"))!.y).toBeGreaterThan(subject.y! + 5);
  const movedSubject = (await settledRecord(engine, "default", "shape:starter-subject"))!;

  const placeholder: AnyRecord = {
    ...subject,
    id: "shape:from-engine",
    index: "a9",
    x: subject.x! + 400,
    meta: { ref: "150" },
  } as AnyRecord;
  await (await engine.rpc()).call("testCanvas.apply", {
    project: "default",
    change: { put: [placeholder], remove: [] },
    origin: { kind: "server", id: "run:undo-test" },
  });
  await expect(shapeOnScreen(page, "shape:from-engine")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await record(engine, "shape:starter-scene"))!.x).toBe(scene.x);
  expect((await record(engine, "shape:starter-subject"))!.y).toBe(movedSubject.y);
  expect(await record(engine, "shape:from-engine")).toBeDefined();

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await record(engine, "shape:starter-scene"))!.x).toBe(movedScene.x);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await record(engine, "shape:starter-scene"))!.x).toBe(scene.x);
  await page.keyboard.press("ControlOrMeta+y");
  await expect.poll(async () => (await record(engine, "shape:starter-scene"))!.x).toBe(movedScene.x);
});
