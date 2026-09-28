import type { Page } from "@playwright/test";
import { editorFocused, emptyCanvasPoint, openCanvas, plainText, roomRecords, settledRecord, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

const added = async (engine: Parameters<typeof roomRecords>[0], before: Set<string>) =>
  waitForRoom(engine, "default", (records) => records.find((record) => record.typeName === "shape" && !before.has(record.id)));

const idsNow = async (engine: Parameters<typeof roomRecords>[0]) => new Set((await roomRecords(engine, "default")).map((record) => record.id));

const addFromButton = async (page: Page, label: string) => {
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};

test("the add button opens Inputs and Artifacts, 152 px wide, toward the start side", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const button = page.getByRole("button", { name: "Add" });
  await button.click();
  const popup = page.getByRole("menu");
  await expect(popup.getByRole("group")).toHaveText([/^Inputs/, /^Artifacts/]);
  await expect(popup.getByRole("menuitem")).toHaveText(["Prompt", "Image", "Video", "Group", "Page", "Motion"]);
  for (const icon of ["align-left", "image", "square-play", "group", "app-window", "clapperboard"]) await expect(popup.locator(`svg.lucide-${icon}`)).toHaveCount(1);
  // Measured once the opening scale has settled.
  await expect.poll(async () => (await popup.boundingBox())?.width).toBe(152);
  const menuBox = (await popup.boundingBox())!;
  const buttonBox = (await button.boundingBox())!;
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(buttonBox.x);
});

test("from the button a shape lands centred in the view; a new prompt starts editing", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const viewport = page.viewportSize()!;

  let before = await idsNow(engine);
  await addFromButton(page, "Prompt");
  const prompt = await added(engine, before);
  expect(prompt.type).toBe("text");
  await editorFocused(page);
  await page.keyboard.type("a quiet pier");
  await page.keyboard.press("Escape");
  await expect.poll(async () => plainText(await settledRecord(engine, "default", prompt.id))).toBe("a quiet pier");

  for (const [label, type, size] of [
    ["Image", "image", { w: 240, h: 140 }],
    ["Group", "frame", { w: 420, h: 280 }],
  ] as const) {
    before = await idsNow(engine);
    await addFromButton(page, label);
    const made = await added(engine, before);
    expect(made).toMatchObject({ type, props: size });
    const box = (await shapeOnScreen(page, made.id).boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
    await page.keyboard.press("Escape");
  }
});

test("from the context menu a shape lands at the click point", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const at = await emptyCanvasPoint(page);
  const before = await idsNow(engine);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.getByTestId("context-menu").getByRole("menuitem", { name: "Video" }).click();
  const made = await added(engine, before);
  expect(made).toMatchObject({ type: "video", props: { w: 240, h: 180 } });
  const box = (await shapeOnScreen(page, made.id).boundingBox())!;
  expect(Math.abs(box.x - at.x)).toBeLessThan(2);
  expect(Math.abs(box.y - at.y)).toBeLessThan(2);
});
