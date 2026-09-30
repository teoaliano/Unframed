import type { Page } from "@playwright/test";
import { editorFocused, emptyCanvasPoint, openCanvas, plainText, roomShapes, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

const SUBJECT = "shape:starter-subject";

const editing = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return Boolean(active?.isContentEditable);
  });

const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

test.describe("editing a prompt", () => {
  test("one click selects without a caret, a double-click edits with all text selected, Escape leaves editing and Enter edits again", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const text = shapeOnScreen(page, SUBJECT).locator(".tl-rich-text");

    await text.click();
    await page.waitForTimeout(300);
    expect(await editing(page)).toBe(false);

    await page.mouse.click(5, 400);
    await text.dblclick();
    await editorFocused(page);
    await expect.poll(() => selectedText(page)).toBe("lone red fox");

    await page.keyboard.press("Escape");
    await expect.poll(() => editing(page)).toBe(false);

    await page.keyboard.press("Enter");
    await editorFocused(page);
    await expect.poll(() => selectedText(page)).toBe("lone red fox");
    await page.keyboard.type("a grey wolf");
    await page.keyboard.press("Escape");
    await waitForRoom(engine, "default", (records) => plainText(records.find((record) => record.id === SUBJECT)) === "a grey wolf");
  });

  test("an emptied prompt is kept when editing ends, and says Add text…", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const point = await emptyCanvasPoint(page);
    await page.mouse.dblclick(point.x, point.y);
    await editorFocused(page);
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 400);

    const empty = await waitForRoom(engine, "default", (records) =>
      records.find((record) => record.type === "text" && !record.id.startsWith("shape:starter")),
    );
    await page.waitForTimeout(500);
    expect((await roomShapes(engine, "default", "text")).map((record) => record.id)).toContain(empty.id);
    await expect(shapeOnScreen(page, empty.id).locator("[data-testid='prompt-hint']")).toHaveText("Add text…");

    // Clearing the text of an existing prompt keeps it too.
    await shapeOnScreen(page, SUBJECT).locator(".tl-rich-text").dblclick();
    await editorFocused(page);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");
    await waitForRoom(engine, "default", (records) => plainText(records.find((record) => record.id === SUBJECT)) === "");
    await expect(shapeOnScreen(page, SUBJECT).locator("[data-testid='prompt-hint']")).toHaveText("Add text…");
  });
});
