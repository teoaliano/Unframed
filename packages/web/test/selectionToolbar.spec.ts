import { centre, emptyCanvasPoint, openCanvas, shapeOnScreen } from "./canvas.ts";
import { clickShape, expect, selectGroup, test, toolbar } from "./generation.ts";
import { expectSlot, expectToken, inBothSchemes, resolvedColor, styleOf } from "./kit.ts";
import { artifactRecord, emptyMedia, groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";

test("a usable selection gets Generate and its count; a named group reads by its name", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await putRecords(engine, [
    groupRecord("shape:character", "character", { x: 600, y: 40 }),
    inGroup(emptyMedia("shape:inside", "image", "300", { x: 0, y: 0 }), "shape:character", { x: 40, y: 80 }),
    inGroup(promptRecord("shape:line", "301", "a caption"), "shape:character", { x: 40, y: 20 }),
  ]);
  await expect(shapeOnScreen(page, "shape:inside")).toBeVisible();

  await clickShape(page, "shape:starter-subject");
  await expect(toolbar(page).getByRole("button", { name: "Generate" })).toBeVisible();
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("1 selected");
  // The hint, a separator and Agent come before Generate, which ends the bar, once spec 08 registers the Agent tray.
  await expect(toolbar(page).getByRole("button")).toHaveText(["Agent", "Generate"]);
  await expect(toolbar(page).locator("[data-slot='separator']")).toHaveCount(1);

  await page.keyboard.press("ControlOrMeta+a");
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("3 selected");

  await page.mouse.click(10, 400);
  await expect(toolbar(page)).toHaveCount(0);
  await selectGroup(page, "shape:character");
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("@character");
});

const GLASS = "color-mix(in srgb, var(--background) var(--glass-opacity), transparent)";

test("the bar is glass with the kit border and radius; Generate is the kit's primary Button and the hint is muted", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  const bar = toolbar(page);
  const generate = bar.getByRole("button", { name: "Generate" });
  await expectSlot(generate, "button");
  await expectSlot(bar.locator("[data-slot='separator']"), "separator");
  await inBothSchemes(page, async () => {
    await page.mouse.move(5, 500);
    expect(await styleOf(bar, "background-color")).toBe(await resolvedColor(page, GLASS));
    expect(await styleOf(bar, "border-top-left-radius")).toBe("14px");
    await expectToken(bar, "border-top-color", "--color-border");
    await expectToken(generate, "background-color", "--primary");
    await expectToken(bar.getByTestId("selection-hint"), "color", "--color-muted-foreground");
  });
});

test("a selection with nothing to generate from shows Agent only; a filled page offers Open and Agent", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await putRecords(engine, [emptyMedia("shape:empty", "image", "300", { x: 400, y: 60 }), artifactRecord("shape:page", "page", "301", { x: 400, y: 300 }, "hello.html", "hello.html")]);
  await expect(shapeOnScreen(page, "shape:page")).toBeVisible();

  const empty = (await shapeOnScreen(page, "shape:empty").boundingBox())!;
  await page.mouse.click(empty.x + 8, empty.y + 8);
  await expect(page.locator('[data-shape-id="shape:empty"]')).toBeVisible();
  await expect(toolbar(page).getByRole("button")).toHaveText(["Agent"]);

  await clickShape(page, "shape:page");
  await expect(toolbar(page).getByRole("button")).toHaveText(["Open", "Agent"]);
});

test("the bar sits centred above the selection, flips below it at the top edge and stays inside the canvas", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  const subject = shapeOnScreen(page, "shape:starter-subject");
  await clickShape(page, "shape:starter-subject");
  const bar = toolbar(page);
  await expect(bar).toBeVisible();

  const shape = (await subject.boundingBox())!;
  await expect.poll(async () => { const box = (await bar.boundingBox())!; return box.y + box.height; }).toBeCloseTo(shape.y - 12, 0);
  const box = (await bar.boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(shape.x + shape.width / 2, 0);

  // Scroll the canvas until the prompt sits at the top edge: no room above, so the bar flips below.
  const start = await centre(subject);
  await page.mouse.move(start.x, start.y);
  for (let step = 0; step < 40 && ((await subject.boundingBox())!.y > 10); step++) await page.mouse.wheel(0, 40);
  await expect(bar).toHaveAttribute("data-side", "below");
  const moved = (await subject.boundingBox())!;
  await expect.poll(async () => (await bar.boundingBox())!.y).toBeCloseTo(moved.y + moved.height + 12, 0);

  // Scroll it past the left edge: the bar stays 8 px inside.
  for (let step = 0; step < 60 && ((await subject.boundingBox())!.x > -100); step++) await page.mouse.wheel(40, 0);
  const canvas = (await page.locator(".tl-container").boundingBox())!;
  await expect.poll(async () => (await bar.boundingBox())!.x).toBeCloseTo(canvas.x + 8, 0);
});

test("the bar hides while a shape is dragged, the canvas is dragged or a box is drawn, and the wheel over it pans", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  const subject = shapeOnScreen(page, "shape:starter-subject");
  const at = await centre(subject);
  await page.mouse.click(at.x, at.y);
  const bar = toolbar(page);
  await expect(bar).toBeVisible();
  // Far enough apart that the next press is not a double-click, which would start editing.
  await page.waitForTimeout(700);

  // Dragging the shape.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 30, at.y + 10, { steps: 4 });
  await expect(bar).toBeHidden();
  await page.mouse.up();
  await expect(bar).toBeVisible();

  // A box selection, which ends selecting the shapes it covers.
  const box = (await subject.boundingBox())!;
  await page.mouse.move(box.x + box.width + 30, box.y + box.height + 30);
  await page.mouse.down();
  await page.mouse.move(box.x - 20, box.y - 30, { steps: 5 });
  await expect(bar).toBeHidden();
  await page.mouse.up();
  await expect(bar).toBeVisible();

  // Dragging the canvas with the middle button.
  const empty = await emptyCanvasPoint(page);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(empty.x + 40, empty.y + 20, { steps: 4 });
  await expect(bar).toBeHidden();
  await page.mouse.up({ button: "middle" });
  await expect(bar).toBeVisible();
  const settled = async () => {
    let last = -1;
    await expect.poll(async () => {
      const y = (await subject.boundingBox())!.y;
      const still = y === last;
      last = y;
      return still;
    }).toBe(true);
  };
  await settled();

  // The wheel over the bar moves the canvas under it.
  const before = (await subject.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await subject.boundingBox())!.y).toBeLessThan(before.y - 50);
});
