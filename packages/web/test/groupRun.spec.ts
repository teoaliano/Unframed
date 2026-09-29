import type { Page } from "@playwright/test";
import { openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { clickShape, composer, expect, openComposer, selectGroup, sendRun, settled, test, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";

const badge = (page: Page, id: string) => page.locator(`.unframed-role-badge[data-role-for="${id}"]`);

/** A filled image inside the group `character`, at a point relative to it. */
const memberImage = async (engine: Parameters<typeof filledMedia>[0], id: string, ref: string, at: { x: number; y: number }, bytes: Buffer) => {
  await filledMedia(engine, { id, type: "image", ref, at: { x: 0, y: 0 }, bytes, name: `${id.slice(6)}.png`, mime: "image/png", natural: { w: 64, h: 40 }, width: 160 });
  const record = (await roomRecords(engine, "default")).find((each) => each.id === id)!;
  await putRecords(engine, [inGroup(record as never, "shape:character", at)]);
};

test("a selected group takes one slot in the order, its members in their own order inside it, with their badges while the composer is open", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  const [first, second, loose] = [pngBytes(64, 40, 1), pngBytes(64, 40, 2), pngBytes(64, 40, 3)];
  await putRecords(engine, [
    groupRecord("shape:character", "character", { x: 420, y: 40 }, { w: 420, h: 480 }),
    inGroup(promptRecord("shape:knight", "300", "a knight in silver armour"), "shape:character", { x: 28, y: 56 }),
    promptRecord("shape:after", "301", "at dusk", { x: 420, y: 700 }),
  ]);
  // The lower image inside the box comes second, whichever was made first.
  await memberImage(engine, "shape:lower", "302", { x: 28, y: 300 }, second);
  await memberImage(engine, "shape:upper", "303", { x: 28, y: 120 }, first);
  await filledMedia(engine, { id: "shape:loose", type: "image", ref: "304", at: { x: 420, y: -200 }, bytes: loose, name: "loose.png", mime: "image/png", natural: { w: 64, h: 40 }, width: 160 });
  for (const id of ["shape:lower", "shape:upper", "shape:loose", "shape:after"]) await expect(shapeOnScreen(page, id)).toHaveCount(1);
  await page.keyboard.press("Shift+1");
  await settled(shapeOnScreen(page, "shape:loose"));
  for (const id of ["shape:lower", "shape:upper", "shape:loose", "shape:after"]) await expect(shapeOnScreen(page, id)).toBeVisible();

  await selectGroup(page, "shape:character");
  await clickShape(page, "shape:loose", ["Shift"]);
  await clickShape(page, "shape:after", ["Shift"]);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("3 selected");
  await openComposer(page);
  await expect(badge(page, "shape:loose")).toHaveText("image 1");
  await expect(badge(page, "shape:upper")).toHaveText("image 2");
  await expect(badge(page, "shape:lower")).toHaveText("image 3");

  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(1);
  const body = generation.requests[0]!.body;
  expect(body.prompt).toBe("a knight in silver armour\n\nat dusk");
  expect(body.input_references.map((ref: any) => ref.image_url.url)).toEqual(
    [loose, first, second].map((bytes) => `data:image/png;base64,${bytes.toString("base64")}`),
  );
});

test("one selected group reads by its name: the hint on the bar, one @name chip in the composer's source band", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await putRecords(generation.engine, [
    groupRecord("shape:character", "character", { x: 420, y: 40 }),
    inGroup(promptRecord("shape:line", "300", "a caption"), "shape:character", { x: 28, y: 56 }),
    inGroup(promptRecord("shape:other", "301", "another line"), "shape:character", { x: 28, y: 120 }),
  ]);
  await expect(shapeOnScreen(page, "shape:line")).toBeVisible();
  await selectGroup(page, "shape:character");
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("@character");
  await openComposer(page);
  const source = composer(page).getByTestId("source-count");
  await expect(source).toHaveText("@character");
  await expect(source).toHaveAttribute("data-chip", "group");

  // Two shapes are a count, not a chip.
  await page.keyboard.press("Escape");
  await clickShape(page, "shape:starter-subject");
  await clickShape(page, "shape:starter-scene", ["Shift"]);
  await openComposer(page);
  await expect(source).toHaveText("2 selected");
  await expect(source).not.toHaveAttribute("data-chip", "group");
});
