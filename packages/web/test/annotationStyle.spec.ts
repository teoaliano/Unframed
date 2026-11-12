import type { Page } from "@playwright/test";
import { centre, emptyCanvasPoint, openCanvas, roomShapes, shapeOnScreen, waitForRoom, type AnyRecord } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { selectGroup } from "./generation.ts";
import { artifactRecord, groupRecord, putRecords } from "./media.ts";

const LABEL = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Note" }] }] };

const base = (id: string, type: string, at: { x: number; y: number }, index: string, meta: Record<string, unknown> = {}) => ({
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
  meta,
});

const note = (id: string, at: { x: number; y: number }, index: string, meta: Record<string, unknown> = {}) => ({
  ...base(id, "note", at, index, meta),
  props: { color: "yellow", labelColor: "black", size: "m", font: "draw", fontSizeAdjustment: null, align: "middle", verticalAlign: "middle", growY: 0, url: "", richText: LABEL, scale: 1, textLastEditedBy: null },
});

const rectangle = (id: string, at: { x: number; y: number }, index: string) => ({
  ...base(id, "geo", at, index),
  props: { geo: "rectangle", dash: "draw", url: "", w: 220, h: 140, growY: 0, scale: 1, flipX: false, flipY: false, labelColor: "black", color: "black", fill: "none", size: "m", font: "draw", align: "middle", verticalAlign: "middle", richText: LABEL },
});

const toolbar = (page: Page) => page.getByTestId("selection-toolbar");
const row = (page: Page) => page.getByTestId("style-row");
const tray = (page: Page) => page.getByTestId("tool-tray");
const panel = (page: Page) => page.getByTestId("design-panel");

const controlsIn = (scope: ReturnType<Page["getByTestId"]>) => scope.locator("[data-style-control]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-style-control")));

const expectControls = (scope: ReturnType<Page["getByTestId"]>, controls: string[]) => expect.poll(() => controlsIn(scope)).toEqual(controls);

const put = async (page: Page, engine: Parameters<typeof putRecords>[0], records: Array<{ id: string }>) => {
  await putRecords(engine, records);
  for (const record of records) await expect(shapeOnScreen(page, record.id)).toHaveCount(1);
};

const fit = async (page: Page) => {
  await page.keyboard.press("Shift+1");
  let last: unknown;
  await expect
    .poll(async () => {
      const box = JSON.stringify(await shapeOnScreen(page, "shape:starter-subject").boundingBox());
      const settled = box === last;
      last = box;
      return settled;
    })
    .toBe(true);
};

const drawnShape = async (engine: Parameters<typeof putRecords>[0]) => {
  let id = "";
  await expect.poll(async () => (id = (await roomShapes(engine, "default", "draw"))[0]?.id ?? "")).not.toBe("");
  return id;
};

const shapeNamed = (records: AnyRecord[], id: string) => records.find((record) => record.id === id);

const select = async (page: Page, ...ids: string[]) => {
  await page.keyboard.press("Escape");
  for (const [index, id] of ids.entries()) {
    const at = await centre(shapeOnScreen(page, id));
    if (index > 0) await page.keyboard.down("Shift");
    await page.mouse.click(at.x, at.y);
    if (index > 0) await page.keyboard.up("Shift");
  }
};

const pickSwatch = async (page: Page, control: string, swatch: string) => {
  await row(page).getByRole("button", { name: control, exact: true }).click();
  await page.getByRole("group", { name: `${control} swatches` }).getByRole("button", { name: swatch, exact: true }).click();
};

const openStyle = async (page: Page, scope: ReturnType<Page["getByTestId"]>, control: string) => {
  await scope.getByRole("button", { name: control, exact: true }).click();
  const popup = page.getByRole("dialog", { name: control });
  await expect(popup.locator("[data-unframed-dial-fields]")).toBeVisible();
  return popup;
};

const field = (scope: ReturnType<Page["getByTestId"]>, label: string) => scope.getByLabel(label, { exact: true });

const typeInto = async (scope: ReturnType<Page["getByTestId"]>, label: string, value: string) => {
  const input = field(scope, label);
  await input.fill(value);
  await input.press("Enter");
};

const pickFromMenu = async (page: Page, scope: ReturnType<Page["getByTestId"]>, control: string, item: string) => {
  await scope.getByRole("button", { name: control, exact: true }).click();
  const menu = page.getByRole("menu", { name: control });
  await expect(menu).toBeVisible();
  const choice = menu.getByRole("menuitemradio", { name: item, exact: true });
  await choice.click();
  return choice;
};

const setSlider = async (scope: ReturnType<Page["getByTestId"]>, label: string, value: string) => {
  const slider = scope.getByRole("slider", { name: label, exact: true });
  await slider.focus();
  await slider.press("Enter");
  const input = scope.getByRole("textbox", { name: `${label} value` });
  await input.fill(value);
  await input.press("Enter");
};


const draw = async (page: Page, from: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y + 40, { steps: 5 });
  await page.mouse.move(from.x + 100, from.y + 10, { steps: 5 });
  await page.mouse.up();
};

const STICKIES = [note("shape:sticky", { x: -500, y: 300 }, "b21"), note("shape:other", { x: -200, y: 300 }, "b22", { unframed: { design: { fillColor: "#3e63dd", fontSize: 30 } } })];

test("a sticky note's style row comes first in the bar, and the Design panel stays closed", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await put(page, engine, STICKIES);
  await select(page, "shape:sticky");
  await expect(row(page)).toBeVisible();
  await expectControls(row(page), ["fill", "font", "size", "bold", "align"]);
  await expect(row(page).getByRole("button", { name: "Design panel" })).toBeVisible();
  const rowBox = (await row(page).boundingBox())!;
  const hint = (await toolbar(page).getByTestId("selection-hint").boundingBox())!;
  const generate = (await toolbar(page).getByRole("button", { name: "Generate" }).boundingBox())!;
  expect(rowBox.x + rowBox.width).toBeLessThan(hint.x);
  expect(hint.x).toBeLessThan(generate.x);
  await expect(panel(page)).toHaveCount(0);
});

test("each kind shows its own controls, a mixed selection what it shares, and a group none", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await put(page, engine, [STICKIES[0]!, rectangle("shape:box", { x: -500, y: 600 }, "b23"), groupRecord("shape:board", "board", { x: 200, y: 600 }, { w: 200, h: 140 })]);
  await fit(page);

  await select(page, "shape:starter-subject");
  await expectControls(row(page), ["font", "size", "bold", "align", "textColor"]);

  await select(page, "shape:box");
  await expectControls(row(page), ["fill", "stroke", "strokeWidth", "font", "size"]);

  await select(page, "shape:sticky", "shape:box");
  await expectControls(row(page), ["fill", "font", "size"]);

  await page.keyboard.press("Escape");
  await selectGroup(page, "shape:board");
  await expect(toolbar(page).getByRole("button", { name: "Agent" })).toBeVisible();
  await expect(row(page)).toHaveCount(0);

  const sticky = await centre(shapeOnScreen(page, "shape:sticky"));
  await page.keyboard.down("Shift");
  await page.mouse.click(sticky.x, sticky.y);
  await page.keyboard.up("Shift");
  await expectControls(row(page), ["fill", "font", "size", "bold", "align"]);

  await page.keyboard.press("Escape");
  const start = await emptyCanvasPoint(page);
  await page.getByTestId("tools.draw").click();
  await draw(page, { x: start.x - 200, y: start.y });
  await page.getByTestId("tools.select").click();
  const drawing = { id: await drawnShape(engine) };
  await page.mouse.click(start.x - 200, start.y);
  await expectControls(row(page), ["stroke", "strokeWidth", "dash"]);

  await page.mouse.click(start.x - 200, start.y);
  await select(page, "shape:sticky");
  await page.keyboard.down("Shift");
  await page.mouse.click(start.x - 200, start.y);
  await page.keyboard.up("Shift");
  await expect(row(page).locator("[data-style-control]")).toHaveCount(0);
  await expect(row(page).getByRole("button", { name: "Design panel" })).toBeVisible();
});

test("a colour swatch sets a sticky note's colour as one undo step, and Default clears it", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await put(page, engine, STICKIES);
  await select(page, "shape:sticky");
  await pickSwatch(page, "Colour", "Red");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:sticky")?.meta?.unframed?.design?.fillColor === "#e5484d");
  await expect(page.getByRole("dialog", { name: "Colour" })).toHaveCount(0);
  await expect(shapeOnScreen(page, "shape:sticky").locator(".tl-note__container")).toHaveCSS("background-color", "rgb(229, 72, 77)");
  await expect(shapeOnScreen(page, "shape:sticky").locator(".tl-text-content__wrapper").first()).toHaveCSS("color", "rgb(255, 255, 255)");
  await pickSwatch(page, "Colour", "Yellow");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:sticky")?.meta?.unframed?.design?.fillColor === "#ffe066");
  await expect(shapeOnScreen(page, "shape:sticky").locator(".tl-text-content__wrapper").first()).toHaveCSS("color", "rgb(0, 0, 0)");
  await page.keyboard.press("ControlOrMeta+z");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:sticky")?.meta?.unframed?.design?.fillColor === "#e5484d");

  await pickSwatch(page, "Colour", "Green");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:sticky")?.meta?.unframed?.design?.fillColor === "#30a46c");
  await page.keyboard.press("ControlOrMeta+z");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:sticky")?.meta?.unframed?.design?.fillColor === "#e5484d");

  await pickSwatch(page, "Colour", "Default");
  await waitForRoom(engine, "default", (records) => {
    const found = shapeNamed(records, "shape:sticky");
    return found !== undefined && found.meta?.unframed?.design?.fillColor === undefined;
  });
});

test("fill None and solid on a rectangle, a stroke swatch, and a typed text colour on a prompt", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await put(page, engine, [rectangle("shape:box", { x: -500, y: 300 }, "b23")]);
  await fit(page);
  await select(page, "shape:box");

  await pickSwatch(page, "Fill", "Amber");
  await waitForRoom(engine, "default", (records) => {
    const found = shapeNamed(records, "shape:box");
    return found?.props?.fill === "solid" && found.meta?.unframed?.design?.fillColor === "#ffb224";
  });
  await pickSwatch(page, "Fill", "None");
  await waitForRoom(engine, "default", (records) => {
    const found = shapeNamed(records, "shape:box");
    return found?.props?.fill === "none" && found.meta?.unframed?.design?.fillColor === undefined;
  });
  await pickSwatch(page, "Stroke", "Blue");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:box")?.meta?.unframed?.design?.strokeColor === "#3e63dd");

  await select(page, "shape:starter-subject");
  await row(page).getByRole("button", { name: "Text colour", exact: true }).click();
  const hex = page.getByRole("dialog", { name: "Text colour" }).getByRole("textbox", { name: "Custom color value" });
  await hex.fill("#ff0044");
  await hex.press("Enter");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, "shape:starter-subject")?.meta?.unframed?.design?.textColor === "#ff0044");
});

test("stroke width is a number field with a stepper on hover, and the stroke style menu previews each line", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const start = await emptyCanvasPoint(page);
  await page.getByTestId("tools.draw").click();
  await draw(page, { x: start.x - 200, y: start.y });
  await page.getByTestId("tools.select").click();
  const drawing = { id: await drawnShape(engine) };
  await page.mouse.click(start.x - 200, start.y);

  const increase = row(page).getByRole("button", { name: "Increase", exact: true });
  const stepper = row(page).locator("[data-slot=number-field-stepper]");
  await expect(stepper).toHaveCSS("opacity", "0");
  await typeInto(row(page), "Stroke width", "8");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, drawing.id)?.meta?.unframed?.design?.strokeWidth === 8);
  await expect(field(row(page), "Stroke width")).toHaveValue("8");
  await expect(toolbar(page)).toBeVisible();
  await field(row(page), "Stroke width").hover();
  await expect(stepper).toHaveCSS("opacity", "1");
  await increase.click();
  await waitForRoom(engine, "default", (records) => shapeNamed(records, drawing.id)?.meta?.unframed?.design?.strokeWidth === 8.5);

  const dotted = await pickFromMenu(page, row(page), "Stroke style", "Dotted");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, drawing.id)?.props?.dash === "dotted");
  await expect(dotted).toHaveCount(0);
  await row(page).getByRole("button", { name: "Stroke style", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Stroke style" });
  await expect(menu.getByRole("menuitemradio")).toHaveText(["Draw", "Solid", "Dashed", "Dotted"]);
  await expect(menu.getByRole("menuitemradio", { name: "Dotted" })).toHaveAttribute("aria-checked", "true");
  await expect(menu.locator("svg[width=\"32\"]")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(row(page)).toBeVisible();

  await row(page).getByRole("button", { name: "Design panel" }).click();
  await setSlider(panel(page), "Stroke width", "3");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, drawing.id)?.meta?.unframed?.design?.strokeWidth === 3);
  await expect(field(row(page), "Stroke width")).toHaveValue("3");
});

test("font, size, bold and align on a prompt write as the panel writes them", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await select(page, "shape:starter-subject");
  const id = "shape:starter-subject";

  await row(page).getByRole("button", { name: "Font", exact: true }).click();
  const fonts = page.getByRole("menu", { name: "Font" });
  await expect(fonts.getByRole("menuitemradio")).toHaveText(["Draw", "Sans", "Serif", "Mono"]);
  await expect(fonts.getByRole("menuitemradio", { name: "Serif" })).toHaveCSS("font-family", /tldraw_serif/);
  await expect(fonts.getByRole("menuitemradio", { name: "Mono" })).toHaveCSS("font-family", /tldraw_mono/);
  await fonts.getByRole("menuitemradio", { name: "Serif" }).click();
  await waitForRoom(engine, "default", (records) => shapeNamed(records, id)?.props?.font === "serif");
  await expect(row(page).getByRole("button", { name: "Font", exact: true })).toHaveText("Serif");

  await typeInto(row(page), "Size", "40");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, id)?.meta?.unframed?.design?.fontSize === 40);
  await field(row(page), "Size").focus();
  await field(row(page), "Size").press("ArrowUp");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, id)?.meta?.unframed?.design?.fontSize === 41);
  await typeInto(row(page), "Size", "1");
  await waitForRoom(engine, "default", (records) => shapeNamed(records, id)?.meta?.unframed?.design?.fontSize === 4);
  await expect(field(row(page), "Size")).toHaveValue("4");
  await expect(row(page)).toBeVisible();

  await row(page).getByRole("button", { name: "Bold", exact: true }).click();
  await waitForRoom(engine, "default", (records) => shapeNamed(records, id)?.meta?.unframed?.design?.fontWeight === "700");
  await expect(row(page).getByRole("button", { name: "Bold", exact: true })).toHaveAttribute("aria-pressed", "true");

  await (await openStyle(page, row(page), "Align")).getByRole("radio", { name: "Centre" }).click();
  await waitForRoom(engine, "default", (records) => shapeNamed(records, id)?.props?.textAlign === "middle");
});

test("two notes that differ read as Mixed and one choice evens them out", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await put(page, engine, STICKIES);
  await select(page, "shape:sticky", "shape:other");
  await expect(field(row(page), "Size")).toHaveValue("");
  await expect(field(row(page), "Size")).toHaveAttribute("placeholder", "Mixed");
  await row(page).getByRole("button", { name: "Colour", exact: true }).click();
  await expect(page.getByRole("group", { name: "Colour swatches" }).getByRole("button", { pressed: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await pickSwatch(page, "Colour", "Violet");
  await waitForRoom(engine, "default", (records) => ["shape:sticky", "shape:other"].every((id) => shapeNamed(records, id)?.meta?.unframed?.design?.fillColor === "#8e4ec6"));
});

test("Esc closes a swatch popover and keeps the selection, and the row hides while a shape is dragged", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await put(page, engine, STICKIES);
  await select(page, "shape:sticky");
  await row(page).getByRole("button", { name: "Colour", exact: true }).click();
  const swatches = page.getByRole("dialog", { name: "Colour" });
  await expect(swatches).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(swatches).toHaveCount(0);
  await expect(row(page)).toBeVisible();

  const at = await centre(shapeOnScreen(page, "shape:sticky"));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 40, at.y + 30, { steps: 4 });
  await expect(toolbar(page)).toBeHidden();
  await page.mouse.move(at.x + 80, at.y + 60, { steps: 4 });
  await page.mouse.up();
  await expect(row(page)).toBeVisible();

  const empty = await emptyCanvasPoint(page);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x + 30, empty.y + 30, { steps: 4 });
  await expect(toolbar(page)).toBeHidden();
  await page.mouse.up();
});

test("the row is absent for one artifact and while the composer is open", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await put(page, engine, [
    artifactRecord("shape:site", "page", "site", { x: 200, y: 600 }),
  ]);
  await fit(page);

  await select(page, "shape:starter-subject");
  await expect(row(page)).toBeVisible();
  await toolbar(page).getByRole("button", { name: "Generate" }).click();
  await expect(toolbar(page)).toHaveAttribute("data-expanded", "true");
  await expect(row(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(row(page)).toBeVisible();

  await select(page, "shape:site");
  await expect(toolbar(page)).toBeVisible();
  await expect(row(page)).toHaveCount(0);
});

test("the Design panel toggle opens the panel, which stays open for later selections and across a reload until Close", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await put(page, engine, STICKIES);
  await select(page, "shape:sticky");
  const toggle = () => row(page).getByRole("button", { name: "Design panel", exact: true });
  await toggle().click();
  await expect(panel(page)).toBeVisible();
  await expect(toggle()).toHaveAttribute("aria-pressed", "true");

  await select(page, "shape:other");
  await expect(panel(page).getByText("Sticky note", { exact: true })).toBeVisible();
  await expect(row(page)).toBeVisible();

  await page.reload();
  await expect(shapeOnScreen(page, "shape:sticky")).toHaveCount(1);
  await select(page, "shape:sticky");
  await expect(panel(page)).toBeVisible();

  await panel(page).getByRole("button", { name: "Close design panel" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(toggle()).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(shapeOnScreen(page, "shape:sticky")).toHaveCount(1);
  await select(page, "shape:sticky");
  await expect(row(page)).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(toggle()).toHaveAttribute("aria-pressed", "false");
});

test("the tool tray sits above the Draw tool and sets the next drawings only, across strokes", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await put(page, engine, STICKIES);
  const start = await emptyCanvasPoint(page);
  await page.getByTestId("tools.draw").click();
  await expect(tray(page)).toBeVisible();
  await expectControls(tray(page), ["stroke", "strokeWidth", "dash"]);
  const trayBox = (await tray(page).boundingBox())!;
  const button = (await page.getByTestId("tools.draw").boundingBox())!;
  expect(trayBox.y + trayBox.height).toBeLessThanOrEqual(button.y);
  expect(Math.abs(trayBox.x + trayBox.width / 2 - (button.x + button.width / 2))).toBeLessThan(2);

  await tray(page).getByRole("button", { name: "Stroke", exact: true }).click();
  await page.getByRole("group", { name: "Stroke swatches" }).getByRole("button", { name: "Teal", exact: true }).click();
  await draw(page, { x: start.x - 200, y: start.y });
  await expect(tray(page)).toBeVisible();
  await draw(page, { x: start.x - 200, y: start.y + 80 });
  await expect.poll(async () => (await roomShapes(engine, "default", "draw")).map((shape) => shape.meta?.unframed?.design?.strokeColor)).toEqual(["#12a594", "#12a594"]);
  const notes = await roomShapes(engine, "default", "note");
  expect(notes.map((shape) => shape.meta?.unframed?.design?.strokeColor)).toEqual([undefined, undefined]);
});

test("the tool tray follows the picked tool, closes on Select, and gives way to an open Design panel", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await page.getByTestId("tools.draw").click();
  await expectControls(tray(page), ["stroke", "strokeWidth", "dash"]);
  await page.getByTestId("tools.note").click();
  await expect(tray(page)).toBeVisible();
  await expectControls(tray(page), ["fill", "font", "size", "bold", "align"]);
  const trayBox = (await tray(page).boundingBox())!;
  const button = (await page.getByTestId("tools.note").boundingBox())!;
  expect(Math.abs(trayBox.x + trayBox.width / 2 - (button.x + button.width / 2))).toBeLessThan(2);

  await page.getByTestId("tools.select").click();
  await expect(tray(page)).toHaveCount(0);

  await select(page, "shape:starter-subject");
  await row(page).getByRole("button", { name: "Design panel", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByTestId("tools.draw").click();
  await expect(panel(page).getByText("Next drawing", { exact: true })).toBeVisible();
  await expect(tray(page)).toHaveCount(0);
});

test("a burst of stepper clicks is one undo step", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await select(page, "shape:starter-subject");
  const id = "shape:starter-subject";
  await field(row(page), "Size").hover();
  for (let step = 0; step < 4; step += 1) await row(page).getByRole("button", { name: "Increase", exact: true }).click();
  await waitForRoom(engine, "default", (records) => shapeNamed(records, id)?.meta?.unframed?.design?.fontSize === 22);
  await field(row(page), "Size").press("Escape");
  await expect(row(page)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await waitForRoom(engine, "default", (records) => {
    const found = shapeNamed(records, id);
    return found !== undefined && found.meta?.unframed?.design?.fontSize === undefined;
  });
});
