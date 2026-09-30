import type { Page } from "@playwright/test";
import { centre, emptyCanvasPoint, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { inBothSchemes, styleOf, tokenColor } from "./kit.ts";
import { filledMedia, groupRecord, putRecords } from "./media.ts";
import { platformOf } from "./platform.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const menu = (page: Page) => page.getByTestId("context-menu");

/** Right-clicks a screen point and answers the menu's section headings and item texts, in order. */
const rightClick = async (page: Page, at: { x: number; y: number }) => {
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  await page.waitForTimeout(200);
  const headings = await menu(page).getByTestId("context-menu-heading").allTextContents();
  const items = await menu(page)
    .locator(":scope > * [role='menuitem'], :scope > [role='menuitem']")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const label = element.querySelector(".tlui-button__label")?.textContent ?? element.textContent ?? "";
        const kbd = element.querySelector(".tlui-kbd")?.textContent;
        return kbd ? `${label} ${kbd}` : label;
      }),
    );
  return { headings, items };
};

/** An edit row: Cut, Copy, Paste, Group or Ungroup, bare or with its shortcut on any platform. */
const editRow = (item: string) => /^(Cut|Copy|Paste|Group|Ungroup)( (⌘|⇧|Ctrl\+).*)?$/.test(item);

const closeMenu = async (page: Page) => {
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
};

/**
 * A page whose clipboard reads as empty, whatever this machine's clipboard holds, for the
 * menus that must show no Paste. Another worker, or another program, may copy at any time.
 */
const withEmptyClipboard = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "read", { configurable: true, value: async () => [] });
  });

const photo = { type: "image" as const, bytes: pngBytes(300, 150), name: "photo.png", mime: "image/png", natural: { w: 300, h: 150 } };

test("on empty canvas the menu offers the add items, then tldraw's own groups; nothing that would do nothing", async ({ page, engine }) => {
  await withEmptyClipboard(page);
  await openCanvas(page, engine);
  const { shortcut } = await platformOf(page);
  const { headings, items } = await rightClick(page, await emptyCanvasPoint(page));
  expect(headings).toEqual(["Inputs", "Artifacts"]);
  expect(items.slice(0, 6)).toEqual(["Prompt", "Image", "Video", "Group", "Page", "Motion"]);
  // tldraw's groups follow, without its cut, copy, paste, group and ungroup.
  expect(items.slice(6)).toContain(`Select all ${shortcut("A")}`);
  expect(items.filter(editRow)).toEqual(["Group"]);
  expect((await menu(page).boundingBox())!.width).toBe(188);
  await closeMenu(page);

  // Text on the clipboard brings Paste: the real clipboard, from here on.
  await page.evaluate(async () => {
    delete (navigator.clipboard as { read?: unknown }).read;
    await navigator.clipboard.writeText("a misty harbour");
  });
  const withText = await rightClick(page, await emptyCanvasPoint(page));
  expect(withText.headings).toEqual(["Edit", "Inputs", "Artifacts"]);
  expect(withText.items[0]).toBe(`Paste ${shortcut("V")}`);
});

test("a right-clicked prompt is selected alone and offers its reference and the edit items", async ({ page, engine }) => {
  await withEmptyClipboard(page);
  await openCanvas(page, engine);
  const scene = shapeOnScreen(page, "shape:starter-scene");
  await page.mouse.click(...Object.values(await centre(scene)) as [number, number]);

  const { shortcut } = await platformOf(page);
  const { headings, items } = await rightClick(page, await centre(shapeOnScreen(page, "shape:starter-subject")));
  // A selection always gets the Library section, whose Add to library the canvas registers.
  expect(headings).toEqual(["Reference", "Edit", "Library"]);
  const edits = [`Cut ${shortcut("X")}`, `Copy ${shortcut("C")}`, `Group ${shortcut("G")}`];
  expect(items.slice(0, 5)).toEqual(["Copy @100", ...edits, expect.not.stringMatching(/^(Paste|Ungroup)/)]);
  // Each edit item once: tldraw's own cut, copy and group are gone.
  expect(items.filter(editRow)).toEqual(edits);
  await closeMenu(page);

  // The subject alone is selected now: deleting it leaves the scene.
  await page.keyboard.press("Delete");
  await expect(shapeOnScreen(page, "shape:starter-subject")).toHaveCount(0);
  await expect(scene).toHaveCount(1);
});

test("a filled image offers reveal and copy as image; inside a selection of two it reveals both", async ({ page, engine }) => {
  await withEmptyClipboard(page);
  await openCanvas(page, engine);
  await filledMedia(engine, { ...photo, id: "shape:one", ref: "150", at: { x: 440, y: 60 } });
  await filledMedia(engine, { ...photo, id: "shape:two", ref: "151", at: { x: 440, y: 260 } });
  await expect(shapeOnScreen(page, "shape:two").locator("img")).toBeVisible();

  const { shortcut, reveal } = await platformOf(page);
  const one = await centre(shapeOnScreen(page, "shape:one"));
  const single = await rightClick(page, one);
  expect(single.headings).toEqual(["Image", "Edit", "Library"]);
  expect(single.items.slice(0, 5)).toEqual([reveal(), "Copy as image", `Cut ${shortcut("X")}`, `Copy ${shortcut("C")}`, `Group ${shortcut("G")}`]);
  await closeMenu(page);

  await page.mouse.click(one.x, one.y);
  await page.keyboard.down("Shift");
  const two = await centre(shapeOnScreen(page, "shape:two"));
  await page.mouse.click(two.x, two.y);
  await page.keyboard.up("Shift");
  const both = await rightClick(page, two);
  expect(both.items[0]).toBe(reveal(2));
  await closeMenu(page);
});

test("a right-clicked group offers its reference and Ungroup, not Group", async ({ page, engine }) => {
  await withEmptyClipboard(page);
  await openCanvas(page, engine);
  await putRecords(engine, [groupRecord("shape:group", "160", { x: 440, y: 60 })]);
  const { shortcut } = await platformOf(page);
  const box = (await shapeOnScreen(page, "shape:group").boundingBox())!;
  const { headings, items } = await rightClick(page, { x: box.x + 10, y: box.y - 8 });
  expect(headings).toEqual(["Reference", "Edit", "Library"]);
  expect(items.slice(0, 4)).toEqual(["Copy @160", `Cut ${shortcut("X")}`, `Copy ${shortcut("C")}`, `Ungroup ${shortcut("G", { shift: true })}`]);
  expect(items).not.toContain(`Group ${shortcut("G")}`);
});

test("the menu has the kit's label and disabled looks, at 188 px, and its rows highlight like the kit's", async ({ page, engine }) => {
  await withEmptyClipboard(page);
  await openCanvas(page, engine);
  await inBothSchemes(page, async () => {
    await rightClick(page, await emptyCanvasPoint(page));
    expect((await menu(page).boundingBox())!.width).toBe(188);
    const heading = menu(page).getByTestId("context-menu-heading").first();
    expect(await styleOf(heading, "font-size")).toBe("12px");
    expect(await styleOf(heading, "font-weight")).toBe("500");
    expect(await styleOf(heading, "color")).toBe(await tokenColor(page, "--color-muted-foreground"));
    const row = menu(page).getByRole("menuitem", { name: "Prompt" });
    await row.hover();
    expect(await row.evaluate((element) => getComputedStyle(element, "::after").backgroundColor)).toBe(await tokenColor(page, "--accent"));
    await closeMenu(page);
  });
});

test.describe("in a browser set to Italian", () => {
  test.use({ locale: "it-IT" });
  test("tldraw's own rows are in English, like Unframed's", async ({ page, engine }) => {
    await withEmptyClipboard(page);
    await openCanvas(page, engine);
    const { shortcut } = await platformOf(page);
    const { items } = await rightClick(page, await emptyCanvasPoint(page));
    expect(items).toContain(`Select all ${shortcut("A")}`);
    await closeMenu(page);
  });
});
