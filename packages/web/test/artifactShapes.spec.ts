import { openCanvas, roomRecords, settledRecord, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape, composer, toolbar } from "./generation.ts";
import { putRecords } from "./media.ts";
import { artifactShape, filledArtifact, frameOf } from "./artifacts.ts";

test("the add menu makes empty pages and motions of 480 by 320 with their kind tab and icon, and no button", async ({ page, engine }) => {
  await openCanvas(page, engine);
  for (const label of ["Page", "Motion"] as const) {
    const before = new Set((await roomRecords(engine, "default")).map((record) => record.id));
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByRole("menuitem", { name: label }).click();
    const made = await waitForRoom(engine, "default", (records) => records.find((record) => record.typeName === "shape" && !before.has(record.id)));
    expect(made).toMatchObject({ type: label.toLowerCase(), props: { w: 480, h: 320, file: "" } });
    const card = shapeOnScreen(page, made.id);
    await expect(card.locator("[data-shape-label]")).toHaveText(label.toLowerCase());
    await expect(card.locator("[data-testid='artifact-card']")).toHaveCSS("border-top-width", "1px");
    await expect(card.getByRole("img", { name: label })).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});

test("an empty artifact, selected, offers Agent in the toolbar, which opens the Agent tray on it", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [artifactShape({ id: "shape:empty", kind: "page", ref: "150", at: { x: 400, y: 80 } })]);
  await expect(shapeOnScreen(page, "shape:empty")).toBeVisible();
  await clickShape(page, "shape:empty");
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(composer(page)).toHaveAttribute("data-tray", "agent");
  await expect(composer(page).getByRole("list", { name: "Context" }).getByRole("listitem")).toHaveCount(1);
  await expect(shapeOnScreen(page, "shape:empty")).toHaveAttribute("data-label-active", "true");
  await expect(shapeOnScreen(page, "shape:starter-subject")).not.toHaveAttribute("data-label-active", "true");
});

test("a filled artifact drops its card, shows its title above the corner, and resizes freely on both axes", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: 420, y: 60 }, title: "Landing", html: "<h1>Hello</h1>" });
  await filledArtifact(engine, { id: "shape:untitled", kind: "page", ref: "151", at: { x: 420, y: 520 }, html: "<h1>Plain</h1>", file: "1700-plain.html" });
  const card = shapeOnScreen(page, "shape:landing");
  await expect(card.locator("[data-shape-label]")).toHaveText("Landing");
  await expect(card.locator("[data-testid='artifact-card']")).toHaveCSS("border-top-width", "0px");
  await expect(card.getByRole("button", { name: "Agent" })).toHaveCount(0);
  // No title and no original name: no label at all.
  await expect(shapeOnScreen(page, "shape:untitled").locator("[data-shape-label]")).toHaveCount(0);

  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(400);
  const box = (await card.boundingBox())!;
  // The title is the handle that selects it.
  await page.mouse.click(box.x + 20, box.y - 8);
  // A selected frame takes the pointer inside the shape: the corner handle is grabbed by its outer half.
  await page.mouse.move(box.x + box.width + 3, box.y + box.height + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 120, box.y + box.height - 60, { steps: 8 });
  await page.mouse.up();
  const resized = await settledRecord(engine, "default", "shape:landing");
  expect(resized?.props.w).toBeGreaterThan(480);
  expect(resized?.props.h).toBeLessThan(320);
  expect(resized!.props.w / resized!.props.h).not.toBeCloseTo(480 / 320, 1);
});

test("the frame takes the pointer only while its shape is selected and not being dragged", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: 420, y: 60 }, title: "Landing", html: "<h1>Hello</h1>" });
  await filledArtifact(engine, { id: "shape:other", kind: "page", ref: "151", at: { x: 940, y: 60 }, size: { w: 300, h: 200 }, title: "Other", html: "<h1>Other</h1>" });
  const card = shapeOnScreen(page, "shape:landing");
  await expect(card).toBeVisible();
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(400);
  // Not selected: nothing runs, a click lands on the canvas and selects the shape.
  await expect(frameOf(page, "shape:landing")).toHaveCount(0);
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const frame = frameOf(page, "shape:landing");
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveCSS("pointer-events", "auto");

  // A press inside a selected frame is the page's own: the shape does not move.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  expect((await settledRecord(engine, "default", "shape:landing"))?.x).toBe(420);

  // Dragged by its title, the handle: the frame lets go of the pointer until the drag ends.
  await page.mouse.move(box.x + 20, box.y - 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 20, { steps: 5 });
  await expect(frame).toHaveCSS("pointer-events", "none");
  await page.mouse.up();
  await expect(frame).toHaveCSS("pointer-events", "auto");
  expect((await settledRecord(engine, "default", "shape:landing"))?.x).not.toBe(420);

  // Selecting another page moves the frame's liveness with it.
  await clickShape(page, "shape:other");
  await expect(frameOf(page, "shape:landing")).toHaveCount(0);
  await expect(frameOf(page, "shape:other")).toHaveCSS("pointer-events", "auto");
});
