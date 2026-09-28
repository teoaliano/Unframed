import { emptyCanvasPoint, openCanvas, roomRecords, settledRecord, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { artifactRecord, dropFiles, putRecords } from "./media.ts";

test("the add menu makes an empty page and an empty motion at the centre of the view, each showing its kind's icon", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const viewport = page.viewportSize()!;

  for (const [label, ref] of [
    ["Page", "102"],
    ["Motion", "103"],
  ] as const) {
    const before = new Set((await roomRecords(engine, "default")).map((record) => record.id));
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByRole("menuitem", { name: label }).click();
    const made = await waitForRoom(engine, "default", (records) => records.find((record) => record.typeName === "shape" && !before.has(record.id)));
    expect(made).toMatchObject({ type: label.toLowerCase(), parentId: "page:page", props: { w: 480, h: 320, file: "", title: "", fileName: "" }, meta: { ref } });

    const card = shapeOnScreen(page, made.id);
    await expect(card.getByLabel(label, { exact: true })).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
    await page.keyboard.press("Escape");
  }
});

test("a dropped .html file becomes a page whose title labels the card", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await dropFiles(page, await emptyCanvasPoint(page), [{ name: "Landing Page.html", mime: "text/html", bytes: Buffer.from("<h1>Hello</h1>") }]);
  const made = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "page"));
  expect(made.props).toMatchObject({ w: 480, h: 320, title: "Landing Page", fileName: "Landing Page.html" });
  await expect(shapeOnScreen(page, made.id).locator(".unframed-shape-label")).toHaveText("Landing Page");
});

test("a page resizes freely between 180 by 96 and 900 by 900", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [artifactRecord("shape:page", "page", "150", { x: 440, y: 60 })]);
  const card = shapeOnScreen(page, "shape:page");
  await expect(card).toBeVisible();
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(300);
  await page.keyboard.press("-");
  await page.waitForTimeout(300);
  await page.keyboard.press("-");
  await page.waitForTimeout(400);

  const dragCorner = async (to: { x: number; y: number }) => {
    const box = (await card.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width, box.y + box.height);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    return box;
  };

  const start = await dragCorner({ x: 1200, y: 700 });
  await expect.poll(async () => (await settledRecord(engine, "default", "shape:page"))?.props).toMatchObject({ w: 900, h: 900 });
  await dragCorner({ x: start.x + 4, y: start.y + 4 });
  await expect.poll(async () => (await settledRecord(engine, "default", "shape:page"))?.props).toMatchObject({ w: 180, h: 96 });
});
