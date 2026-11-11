import type { Page } from "@playwright/test";
import { centre, emptyCanvasPoint, openCanvas, roomShapes, shapeOnScreen, waitForRoom, type AnyRecord } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { emptyMedia, putRecords } from "./media.ts";

const LABEL = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Box" }] }] };

const base = (id: string, type: string, at: { x: number; y: number }, index: string) => ({
  id,
  typeName: "shape",
  type,
  x: at.x,
  y: at.y,
  rotation: 0,
  index,
  parentId: "page:page",
  isLocked: false,
  opacity: 1,
  meta: {},
});

const rectangle = (id: string, at: { x: number; y: number }) => ({
  ...base(id, "geo", at, "b20"),
  props: {
    geo: "rectangle",
    dash: "draw",
    url: "",
    w: 220,
    h: 140,
    growY: 0,
    scale: 1,
    flipX: false,
    flipY: false,
    labelColor: "black",
    color: "black",
    fill: "none",
    size: "m",
    font: "draw",
    align: "middle",
    verticalAlign: "middle",
    richText: LABEL,
  },
});

const note = (id: string, at: { x: number; y: number }) => ({
  ...base(id, "note", at, "b21"),
  props: {
    color: "yellow",
    labelColor: "black",
    size: "m",
    font: "draw",
    fontSizeAdjustment: null,
    align: "middle",
    verticalAlign: "middle",
    growY: 0,
    url: "",
    richText: LABEL,
    scale: 1,
    textLastEditedBy: null,
  },
});

const panel = (page: Page) => page.getByTestId("design-panel");

const typeNumber = async (page: Page, label: string, value: string) => {
  const field = panel(page).getByRole("spinbutton", { name: label, exact: true });
  await field.fill(value);
  await field.press("Enter");
};

const pickColour = async (page: Page, label: string, hex: string) => {
  await panel(page).getByRole("button", { name: label, exact: true }).click();
  const field = page.getByRole("textbox", { name: "Hex" });
  await field.fill(hex);
  await field.press("Enter");
  await page.keyboard.press("Escape");
};

const shapeNamed = (records: AnyRecord[], id: string) => records.find((record) => record.id === id) as (AnyRecord & { opacity?: number }) | undefined;

const select = async (page: Page, id: string) => {
  const at = await centre(shapeOnScreen(page, id));
  await page.mouse.click(at.x, at.y);
};

const openPanel = async (page: Page) => {
  await page.getByTestId("selection-toolbar").getByRole("button", { name: "Design panel", exact: true }).click();
  await expect(panel(page)).toBeVisible();
};

test("the Design panel replaces tldraw's style panel and sets a prompt's font, size, weight, align, colour and opacity exactly", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await expect(panel(page)).toHaveCount(0);
  await select(page, "shape:starter-subject");
  await expect(page.getByTestId("style-row")).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await openPanel(page);
  await expect(page.locator(".tlui-style-panel")).toHaveCount(0);
  await expect(panel(page).getByRole("group", { name: "Text" })).toBeVisible();

  await typeNumber(page, "Size", "40");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:starter-subject")?.meta?.unframed?.design?.fontSize === 40);
  await expect(shapeOnScreen(page, "shape:starter-subject").locator(".tl-rich-text").first()).toHaveCSS("font-size", "40px");

  const font = panel(page).getByRole("combobox", { name: "Font" });
  await font.fill("Georgia");
  await font.press("Enter");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:starter-subject")?.meta?.unframed?.design?.fontFamily === "Georgia");

  await panel(page).getByRole("combobox", { name: "Weight" }).click();
  await page.getByRole("option", { name: "700" }).click();
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:starter-subject")?.meta?.unframed?.design?.fontWeight === "700");
  await expect(shapeOnScreen(page, "shape:starter-subject").locator(".tl-rich-text-wrapper").first()).toHaveCSS("font-weight", "700");

  await panel(page).getByRole("button", { name: "Center", exact: true }).click();
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:starter-subject")?.props?.textAlign === "middle");

  await pickColour(page, "Colour", "#ff0044");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:starter-subject")?.meta?.unframed?.design?.textColor === "#ff0044");

  await typeNumber(page, "Opacity", "50");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:starter-subject")?.opacity === 0.5);
});

test("a rectangle's label, fill, border and corners, and a sticky note's background, are set from the Design panel", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [rectangle("shape:box", { x: -500, y: 300 }), note("shape:sticky", { x: -200, y: 300 })]);
  await expect(shapeOnScreen(page, "shape:sticky")).toHaveCount(1);
  await page.keyboard.press("Shift+1");
  await select(page, "shape:box");
  await openPanel(page);
  await expect(panel(page).getByText("Rectangle", { exact: true })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Background", exact: true })).toHaveText("None");

  await typeNumber(page, "Size", "32");
  await typeNumber(page, "Corner radius", "24");
  await typeNumber(page, "Border width", "6");
  await pickColour(page, "Background", "#ff0000");
  const box = await waitForRoom(engine, "default", (records) => {
    const found = shapeNamed(records, "shape:box");
    const design = found?.meta?.unframed?.design;
    return design?.fontSize === 32 && design.cornerRadius === 24 && design.strokeWidth === 6 && design.fillColor === "#ff0000" ? found : undefined;
  });
  expect(box.props.fill).toBe("solid");

  await panel(page).getByRole("button", { name: "None", exact: true }).click();
  await waitForRoom(engine, "default", (records) => {
    const found = shapeNamed(records, "shape:box");
    return found?.props?.fill === "none" && found.meta?.unframed?.design?.fillColor === undefined;
  });

  await panel(page).getByRole("button", { name: "Top", exact: true }).click();
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:box")?.props?.verticalAlign === "start");

  await select(page, "shape:sticky");
  await expect(panel(page).getByText("Sticky note", { exact: true })).toBeVisible();
  await pickColour(page, "Background", "#22aa66");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:sticky")?.meta?.unframed?.design?.fillColor === "#22aa66");
});

test("the Design panel hides for media and sets a drawing tool's next stroke before it is drawn", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [emptyMedia("shape:still", "image", "180", { x: -400, y: 300 })]);
  await select(page, "shape:starter-subject");
  await openPanel(page);
  await page.keyboard.press("Escape");
  await select(page, "shape:still");
  await expect(panel(page)).toHaveCount(0);

  const start = await emptyCanvasPoint(page);
  await page.getByTestId("tools.draw").click();
  await expect(panel(page).getByText("Next drawing", { exact: true })).toBeVisible();
  await typeNumber(page, "Stroke width", "12");
  await page.mouse.move(start.x - 200, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 150, start.y + 40, { steps: 5 });
  await page.mouse.move(start.x - 100, start.y + 10, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await roomShapes(engine, "default", "draw")).map((shape) => shape.meta?.unframed?.design?.strokeWidth)).toEqual([12]);

  await page.getByTestId("tools.select").click();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});
