import type { Page } from "@playwright/test";
import { editorFocused, emptyCanvasPoint, openCanvas, plainText, roomRecords, settledRecord, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { expectSlot, expectToken, inBothSchemes, resolvedColor, styleOf } from "./kit.ts";

const added = async (engine: Parameters<typeof roomRecords>[0], before: Set<string>) =>
  waitForRoom(engine, "default", (records) => records.find((record) => record.typeName === "shape" && !before.has(record.id)));

const idsNow = async (engine: Parameters<typeof roomRecords>[0]) => new Set((await roomRecords(engine, "default")).map((record) => record.id));

const addFromButton = async (page: Page, label: string) => {
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};

test("the add button opens Inputs and Artifacts, 152 px wide, above the bottom bar", async ({ page, engine }) => {
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
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(buttonBox.y);
});

test("one bottom bar holds tldraw's quick actions and tools, then Library and Add, with no dividers; the add menu is the kit menu", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const bar = page.getByTestId("bottom-toolbar");
  await expect(page.locator(".tlui-main-toolbar__extras")).toHaveCount(0);
  // tldraw's labels carry their shortcut ("Undo — ⌘ Z"): the name before it.
  const buttons = await bar.getByRole("button").evaluateAll((all) => all.map((button) => (button.getAttribute("aria-label") ?? "").split(" — ")[0]!));
  expect(buttons.slice(0, 2)).toEqual(["Undo", "Redo"]);
  expect(buttons.slice(-2)).toEqual(["Library", "Add"]);
  expect(buttons.indexOf("Select")).toBeGreaterThan(buttons.indexOf("Redo"));
  // No Media tool: the tools end at Note; the arrow, the rectangle and the other shapes open from the chevron.
  expect(buttons).not.toContain("Media");
  expect(buttons).toContain("Note");
  await expect(bar.getByTestId("tools.rectangle")).toBeHidden();
  await expect(bar.getByTestId("tools.arrow")).toBeHidden();
  await bar.getByTestId("tools.more-button").click();
  await expect(page.getByTestId("tools.more.arrow")).toBeVisible();
  await expect(page.getByTestId("tools.more.rectangle")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar.locator("[data-slot='separator'], .tlui-toolbar__divider, hr")).toHaveCount(0);
  const add = bar.getByRole("button", { name: "Add" });
  await inBothSchemes(page, async () => {
    await page.mouse.move(5, 500);
    // One panel: the bar carries tldraw's panel fill, mapped onto the kit's popover.
    await expectToken(bar, "background-color", "--popover");
    await add.click();
    const popup = page.locator("[data-slot='menu-popup']");
    await expect(popup).toBeVisible();
    await expect(popup.locator("[data-slot='menu-label']")).toHaveText(["Inputs", "Artifacts"]);
    for (const item of await popup.getByRole("menuitem").all()) {
      await expectSlot(item, "menu-item");
      expect((await item.boundingBox())!.height).toBe(28);
    }
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
  });
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
